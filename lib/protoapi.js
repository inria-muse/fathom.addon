/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.proto API.
 *
 * Implements various application protocols on top of the socket API.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const {error, FathomException} = require("./error");

// actual protocol implementations
const upnp = require("./proto/upnp");
const http = require("./proto/http");
const dns = require("./proto/dns");
const mdns = require("./proto/mdns");
const jsonrpc = require("./proto/jsonrpc");

var id = 1;
var protos = {};

/**
 * Executes the given request and callback with the data or an object with
 * error field with a short error message.
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
	return callback(error("missingmethod"));

    var pid, obj = undefined;
    if (req.method === "create") {
	// create new protocol object 
	console.log("proto." + req.submodule + ".create");

	switch (req.submodule) {
	case "http":
	    obj = new http.HTTP(manifest, 
				req.params[0], 
				req.params[1]);

	    obj.connect(function(res) {
		if (res.error) {
		    callback(res, true);
		} else {
		    pid = id;
		    protos[pid] = obj;
		    id += 1;
		    callback(pid, true);
		}
	    });
	    break;
	    
	case "dns":
	    obj = new dns.DNS(manifest, 
			      req.params[0], 
			      req.params[1], 
			      req.params[2]);
	    pid = id;
	    protos[pid] = obj;
	    id += 1;
	    callback(pid, true);

	    break;
	    
	case "mdns":
	    obj = new mdns.MDNS(manifest);
	    pid = id;
	    protos[pid] = obj;
	    id += 1;
	    callback(pid, true);
	    break;
	    
	case "upnp":
	    obj = new upnp.UPNP(manifest);
	    pid = id;
	    protos[pid] = obj;
	    id += 1;
	    callback(pid, true);
	    break;
	    
	case "jsonrpc":
	    obj = new jsonrpc.JSONRPC(manifest, 
				      req.params[0], 
				      req.params[1], 
				      req.params[2], 
				      req.params[3], 
				      req.params[4]);

	    obj.connect(function(res) {
		if (res.error) {
		    callback(res, true);
		} else {
		    pid = id;
		    protos[pid] = obj;
		    id += 1;
		    callback(pid, true);
		}
	    });
	    break;
	    
	default:
	    return callback(error("nosuchmethod", 
				  req.submodule+"."+req.method));
	}

    } else if (req.params && req.params.length>0 && protos[req.params[0]]) {
	// call method on existing object
	pid = req.params[0];
	obj = protos[pid];
	console.log("proto." + req.submodule + "." + req.method + 
		    " pid="+pid);

	if (obj && typeof obj[req.method] === "function") {
	    var args = [callback].concat(req.params.splice(1));
	    obj[req.method].apply(obj,args);
	} else {
	    // instance found but not the method
	    return callback(error("nosuchmethod", 
				  req.submodule+"."+req.method));
	}

	// cache cleanup on close
	if (req.method === 'close')
	    delete protos[pid];

    } else {
	callback(error("invalidid", "protocolid="+
		       req.submodule+"/"+(req.params ? req.params[0] : "na")));
    }
};

/** Exec promise. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};
