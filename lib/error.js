/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew All errors returned by the extension APIs will follow
 *               the standard format defined in this file.
 * 
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

/** Generate standard error object. */
exports.error = function(type, arg) {
    var res = {
	error : {
	    type : type,
	    arg : arg,
	    message : undefined
	}
    };

    // TODO: these messages could be localized to extension locale ..
    switch (type) {
    case 'notallowed': 
	res.error.message = "User declined the manifest";
	break;
    case 'jsonrpc': 
	res.error.message = "JSONRPC error: " + arg;
	break;
    case 'http': 
	res.error.message = "HTTP error: " + arg;
	break;
    case 'servererror': 
	res.error.message = "Server returns error: " + arg;
	break;
    case 'internal': 
	res.error.message = "Internal error: " + arg;
	break;
    case 'parseerror': 
	res.error.message = "Parsing error: " + arg;
	break;
    case 'invalidmanifest': 
	res.error.message = "Problem with the page manifest: " + arg;
	break;
    case 'destinationnotallowed': 
	res.error.message = "Access to the destination not allowed: " + arg;
	break;
    case 'serverforbidden': 
	res.error.message = "Server denies access: " + arg;
	break;
    case 'invalidid': 
	res.error.message = "Invalid resource id: " + arg;
	break;
    case 'noinit': 
	res.error.message = "API not initialized: " + arg;
	break;
    case 'notsupported': 
	res.error.message = "Not supported on this OS: " + arg;
	break;
    case 'dbqueryfailed': 
	res.error.message = "Failed to query db: " + arg;
	break;
    case 'dbconnfailed': 
	res.error.message = "Failed to connect to db: " + arg;	
	break;
    case 'readfailed': 
	res.error.message = "Failed to read: " + arg;	
	break;
    case 'nosuchfile': 
	res.error.message = "No such file: " + arg;	
	break;
    case 'execerror': 
	res.error.message = "Execution failed: " + arg;	
	break;
    case 'invalidparams': 
	res.error.message = "Invalid parameter(s): " + arg;	
	break;
    case 'nosuchmethod': 
	res.error.message = "No such method: " + arg;	
	break;
    case 'nosuchmodule': 
	res.error.message = "No such module: " + arg;	
	break;
    case 'missingparams': 
	res.error.message = "Missing parameter(s): " + arg;	
	break;
    case 'missingmethod': 
	res.error.message = "Missing method name";	
	break;
    default:
	res.error.message = arg;
    }
    return res;
}

/** Addon exception class for fatal errors. */
exports.FathomException = function(msg) {
    this.name = 'FathomException';
    this.message = msg;
};

