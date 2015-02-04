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
const _ = require('underscore');

const {error, FathomException} = require("error");
// TODO: switch to the SDK locale system when it starts working ...
const locale = require("locale").getLocale();
const loc = require("locale").get;

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
	return false;

    } // else addon
    return true;
};
exports.checkDstPermission = checkDstPermission;

/**
 * CORS style access control where we check a manifest file on
 * the server (proto://ip:port) to allow the webpage (manifest.origin) 
 * to connect to the server using fathom APIs.
 */
var checkDstServerPermission = function(dstobj, manifest) {
    console.info("security server manifest check",manifest,dstobj);

    var ok = true;

    // TODO: check if we have a recently cached copy of the server manifest

    // Else fetch the manifest

    // Compare the manifest.location.origin to the list of allowed origins 
    // in the manifest

    return ok;
};
exports.checkDstServerPermission = checkDstServerPermission;





