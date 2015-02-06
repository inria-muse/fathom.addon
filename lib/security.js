/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew All Fathom security mechanisms are implemented in this module.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const os = require("sdk/system").platform;
const data = require("sdk/self").data;
const ss = require("sdk/simple-storage");
const _ = require('underscore');

const {error, FathomException} = require("error");

// module stats (not counted for addon manifests but to track API use)
if (!ss.storage['security']) {
    ss.storage['security'] = {
	'parse_manifest' : 0,
	'parse_manifest_error' : 0,
	'check_dst' : 0,
	'check_dst_denied' : 0,
	'check_server' : 0,
	'check_server_denied' : 0
    }
};

// FIXME: re-implement with the addon localization framework
const strings = {
    "manifest_socket": "Low level network communications",
    "manifest_socket_udp" : "Low level network communications (UDP unicast)",
    "manifest_socket_multicast" : "Low level network communications (UDP multicast)",
    "manifest_socket_broadcast" : "Low level network communications (UDP broadcast)",
    "manifest_socket_tcp" : "Low level network communications (TCP)",
    
    "manifest_socket_method": "Socket method %s",
    "manifest_socket_udp_method" : "UDP socket method %s",
    "manifest_socket_broadcast_method" : "UDP broadcast socket method %s",
    "manifest_socket_multicast_method" : "UDP multicast socket method %s",
    "manifest_socket_tcp_method" : "TCP socket method %s",
    
    "manifest_proto" : "High level application protocols (HTTP, DNS, mDNS, UPnP)",
    
    "manifest_proto_http" : "HTTP protocol",
    "manifest_proto_dns" : "DNS protocol for name resolution",
    "manifest_proto_mdns" : "mDNS protocol for device discovery",
    "manifest_proto_upnp" : "UPnP procotocol for device discovery",
    
    "manifest_proto_http_method" : "HTTP protocol method %s",
    "manifest_proto_dns_method" : "DNS protocol method %s",
    "manifest_proto_mdns_method" : "mDNS protocol method %s",
    "manifest_proto_upnp_method" : "UPnP protocol method %s",
    
    "manifest_tools" : "Network performance measurement tools",
    "manifest_tools_method" : "Network performance measurement tool %s",
    
    "manifest_system": "System configuration and statistics",
    "manifest_system_method" : "System method %s",
    
    "manifest_dst_mdns" : "Devices discovered using mDNS",
    "manifest_dst_upnp" : "Devices discovered using UPnP",
    "manifest_dst_fathom" : "Other devices running Fathom",
    "manifest_dst_localnet" : "Devices in the local network",
    "manifest_dst_ip" : "Network host %s",
    "manifest_dst_ip_proto" : "Network host %s using %s protocol",
    "manifest_dst_ip_port" : "Network host %s on port %d",
    "manifest_dst_ip_proto_port" : "Network host %s on port %d using %s protocol"
};

const loc = function(name) {
    return strings[name];
}

// List of available modules
const valid_apis = ['socket','proto','system','tools','baseline'];

// List of valid destination protocols
const valid_protos = ['*','tcp','udp','multicast','broadcast'];

/* Simple Fathom destination URI parser and validation class. */
var URI = function(str) {
    this.proto = '*'; // default to any proto
    this.port = '*';  // default to any port
    this.host = undefined;

    var tmp = str.split('://');
    if (tmp.length==2) {
	this.proto = tmp[0];
	str = tmp[1];
    }

    if (this.proto === 'http') {
	// http defaults
	this.proto = 'tcp';
	this.port = 80;
    }

    if (this.proto === 'jsonrpc') {
	// jsonrpc defaults
	this.proto = 'udp';
    }

    if (!_.contains(valid_protos,this.proto))
	throw new FathomException("invalid proto: " + str);

    tmp = str.split(':');
    if (tmp.length==2 && tmp[1]!=='*') {
	try {
	    this.port = parseInt(tmp[1]);
	} catch (e) { 
	    throw new FathomException("invalid port: " + tmp[1]);
	}
    }
    if (this.port !== '*' && !(this.port>=0 && this.port <=65565))
	throw new FathomException("invalid port: " + str);
    
    this.host = tmp[0];
    if (!this.host)
	throw new FathomException("missing host: " + str);

    // add a description to the URI (for sec dialog etc)
    this.descname = 'manifest_dst';
    this.desc = undefined; // translated description of this URI
    switch (this.host) {
    case '{mdns}':
	this.descname += '_mdns';
	this.desc = loc(this.descname);
	break;
    case '{upnp}':
	this.descname += '_upnp';
	this.desc = loc(this.descname);
	break;
    case '{fathom}':
	this.descname += '_mdns';
	this.desc = loc(this.descname);
	break;
    case '{localnet}':
	this.descname += '_localnet';
	this.desc = loc(this.descname);
	break;
    default:
	if (this.port === '*' && this.proto === '*') {
	    this.descname += '_ip';
	    this.desc = loc(this.descname, this.host);
	} else if (this.port === '*' && this.proto !== '*') {
	    this.descname += '_ip_proto';
	    this.desc = loc(this.descname, this.host, this.proto);
	} else if (this.port !== '*' && this.proto === '*') {
	    this.descname += '_ip_port';
	    this.desc = loc(this.descname, this.host, this.port);
	} else if (this.port !== '*' && this.proto !== '*') {
	    this.descname += '_ip_proto_port';
	    this.desc = loc(this.descname, this.host, this.port, this.proto);
	} 
	break;
    }
};

/**
 * Parse the manifest to an manifest object and remove any invalid 
 * entries.
 */
var parseManifest = function(manifest) {
    manifest.isaddon = manifest.isaddon || false;
    console.info("security parse page manifest", manifest);

    if (!manifest.isaddon)
	ss.storage['security']['parse_manifest'] += 1;

    // validated and parsed manifest
    var res = {
	apidesc : [],                  // parsed apis (for UIs)
	destinations : [],             // parsed uris (for UIs)
	api : {},                      // module [->submodule]-> method-> true
	allowdst : {},                 // proto-> ip-> port-> true
	isaddon : manifest.isaddon,    // add-on internal page
	location: manifest.location,   // requesting page location
	neighbors : {}, // proto -> dict of discovered neighbors
    };

    if (manifest.api) {
	try {
	    _.each(manifest.api, function(api) {
		api = api.trim();

		var parts = api.split('.');
		var apimodule = parts[0];
		if (!_.contains(valid_apis,apimodule))
		    throw "No such api : " + apimodule;

		if (!res.api[apimodule])
		    res.api[apimodule] = {};

		if (parts.length==2 && parts[1] === '*') {
		    // e.g. system.*
		    res.api[apimodule]['*'] = true;
		    res.apidesc.push({
			orig : api,
			name : "manifest_"+apimodule,
			desc : loc("manifest_"+apimodule),
		    });

		} else if (parts.length==2) {
		    // e.g. system.doPing
		    res.api[apimodule][parts[1]] = true;
		    var name = "manifest_"+apimodule+"_method";
		    res.apidesc.push({
			orig : api,
			name : name,
			desc : loc(name, parts[1]),
		    });

		} else if (parts.length==3 && parts[2] === '*') {
		    // e.g. proto.dns.*
		    res.api[apimodule][parts[1]] = { '*' : true};
		    var name = "manifest_"+apimodule+"_"+parts[1];
		    res.apidesc.push({
			orig : api,
			name : name,
			desc : loc(name),
		    });

		} else if (parts.length==3) {
		    // e.g. proto.dns.lookup
		    if (!res.api[apimodule][parts[1]])
			res.api[apimodule][parts[1]] = {}
		    res.api[apimodule][parts[1]][parts[2]] = true;

		    var name = "manifest_"+apimodule+"_"+parts[1]+"_method";
		    res.apidesc.push({
			orig : api,
			name : name,
			desc : loc(name, parts[2]),
		    });
		} else {
		    throw "Invalid api definition: " + api;
		}
	    });
	} catch (e) {
	    console.error("security",e);
	    res = error("invalidmanifest",e);
	    if (!manifest.isaddon)
		ss.storage['security']['parse_manifest_error'] += 1;
	}
    } // no api access required ?!
    
    if (!res.error && !manifest.isaddon && manifest.destinations) {
	try {
	    _.each(manifest.destinations, function(dst) {
		var uri = new URI(dst);
		if (!res.allowdst[uri.proto])
		    res.allowdst[uri.proto] = {};
		if (!res.allowdst[uri.proto][uri.host])
		    res.allowdst[uri.proto][uri.host] = {};

		// for sec checks
		res.allowdst[uri.proto][uri.host][uri.port] = true;

		// parsed format for UIs
		res.destinations.push(uri);
	    });
	} catch (e) {
	    res = error("invalidmanifest",e.message);
	    if (!manifest.isaddon)
		ss.storage['security']['parse_manifest_error'] += 1;
	}
    }
    console.info(res);
    return res;
};
exports.parseManifest = parseManifest;

/**
 * Check if the destination (proto://ip:port) is allowed in the manifest
 * accepted by the user.
 */
var checkDstPermission = function(dstobj, manifest) {
    console.info("security destination check",manifest,dstobj);

    if (!manifest.isaddon)
	ss.storage['security']['check_dst'] += 1;

    if (!dstobj.host) {
	console.error("security invalid dstobj in checkDstPermission",dstobj);
	return false;
    }

    if (!_.contains(valid_protos, dstobj.proto)) {
	console.error("security invalid dstobj in checkDstPermission",dstobj);
	return false;
    }

    // check if dstobj.host is discovered via some neighbor discovery
    // protocol
    var checkneighs = function() {
	for (var p in manifest.neighbors) {
	    if (!manifest.neighbors.hasOwnProperty(p))
		continue
	    if (manifest.neighbors[p][dstobj.host])
		return p;
	}
	return undefined;
    };

    if (!manifest.isaddon) {
	// check if the requested host is a neighbor
	var neighp = checkneighs();
	if (neighp)
	    console.info(dstobj.host + " found with " + neighp);
	
	if (neighp && manifest.allowdst[dstobj.proto] && 
	    manifest.allowdst[dstobj.proto]['{'+neighp+'}'])
	{
	    if (manifest.allowdst[dstobj.proto]['{'+neighp+'}']['*'] ||
		manifest.allowdst[dstobj.proto]['{'+neighp+'}'][dstobj.port])
	    {
		console.info("security allow contact neighbor " + dstobj.host);
		return true;
	    }
	}
	if (neighp && manifest.allowdst['*'] && 
	    manifest.allowdst['*']['{'+neighp+'}']) 
	{
	    if (manifest.allowdst['*']['{'+neighp+'}']['*'] ||
		manifest.allowdst['*']['{'+neighp+'}'][dstobj.port])
	    {
		console.info("security allow contact neighbor " + dstobj.host);
		return true;
	    }
	}

	// check with 'localnet' which includes any neigh discovery protocol
	if (neighp) {
	    neighp = 'localnet';
	    if (manifest.allowdst[dstobj.proto] && 
		manifest.allowdst[dstobj.proto]['{'+neighp+'}'])
	    {
		if (manifest.allowdst[dstobj.proto]['{'+neighp+'}']['*'] ||
		    manifest.allowdst[dstobj.proto]['{'+neighp+'}'][dstobj.port])
		{
		    console.info("security allow contact neighbor " + 
				 dstobj.host);
		    return true;
		}
	    }
	    if (manifest.allowdst['*'] && 
		manifest.allowdst['*']['{'+neighp+'}']) 
	    {
		if (manifest.allowdst['*']['{'+neighp+'}']['*'] ||
		    manifest.allowdst['*']['{'+neighp+'}'][dstobj.port])
		{
		    console.info("security allow contact neighbor " + 
				 dstobj.host);
		    return true;
		}
	    }	    
	} // does not match '{localnet}'

	// requesting particular proto + host, check 2 cases for port
	if (manifest.allowdst[dstobj.proto] &&
	    manifest.allowdst[dstobj.proto][dstobj.host]) 
	{
	    if (manifest.allowdst[dstobj.proto][dstobj.host]['*'] ||
		manifest.allowdst[dstobj.proto][dstobj.host][dstobj.port])
	    {
		console.info("security allow contact listed host " + 
			     dstobj.host);
		return true;
	    }
	}

	// requesting any proto + host, check 2 cases for port
	if (manifest.allowdst["*"] && manifest.allowdst["*"][dstobj.host]) {
	    if (manifest.allowdst['*'][dstobj.host]['*'] ||
		manifest.allowdst['*'][dstobj.host][dstobj.port]) 
	    {
		console.info("security allow contact listed host " + 
			     dstobj.host);
		return true;
	    }
	}

	// does not match
	console.info("security not allowed " + dstobj.host);
	if (!manifest.isaddon)
	    ss.storage['security']['check_dst_denied'] += 1;
	return false;

    } // else addon
    return true;
};
exports.checkDstPermission = checkDstPermission;

/**
 * CORS style access control where we check a manifest file on
 * the server (proto://ip:port) to allow the webpage (manifest.location.origin) 
 * to connect to the server using fathom APIs.
 */
var checkDstServerPermission = function(dstobj, manifest) {
    console.info("security server manifest check",manifest,dstobj);
    if (!manifest.isaddon)
	ss.storage['security']['check_server'] += 1;

    var ok = true;

    // TODO: check if we have a recently cached copy of the server manifest

    // Else fetch the manifest

    // Compare the manifest.location.origin to the list of allowed origins 
    // in the manifest

    if (!manifest.isaddon && !ok)
	ss.storage['security']['check_server_denied'] += 1;
    return ok;
};
exports.checkDstServerPermission = checkDstServerPermission;





