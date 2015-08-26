/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew HTTP protocol implementation using fathom sockets.
 *
 * Very basic implementation. Use only for simple troubleshooting or
 * measurement tasks. Otherwise, standard browser or sdk implementations 
 * of xmlhttprequest should be preferred.
 * 
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const {error, FathomException} = require("../error");
const socketapi = require("../socketapi");

/** HTTP object constructor. */
var http = exports.HTTP = function(manifest, ip, port) {
    this.manifest = manifest;
    this.ip = ip;
    this.port = port || 80;
    this.socketid = -1;         // fathom socket id
    this.reqid = 0;             // running socket req id
};

http.prototype.makesocketreq = function(callback, method, params, multi) {
    this.reqid += 1;
    socketapi.exec(callback,
		   { module : "socket",
		     submodule : "tcp",
		     id : this.reqid,
		     method : method,
		     params : params,
		     multiresp : multi || false
		   },
		   this.manifest);
};
	    
http.prototype.connect = function(callback) {
    if (!this.ip)
	return callback(error("missingparams","ip"));

    var that = this;
    that.makesocketreq(function(res, done) {
	if (res.error) {
	    callback(res, true);
	} else {
	    // socket opened, store the id
	    that.socketid = res;
	    callback({}, true);
	}
    },'tcpOpenSendSocket',[this.ip,this.port]);
};

http.prototype.send = function(callback, method, path, headers, data) {
    if (!this.socketid || this.socketid<0)
	return callback(error("execerror","not connected"));
    if (!method)
	return callback(error("missingparams","method"));
    if (!(method === "POST" || method === "GET" || method === "HEAD"))
	return callback(error("invalidparams","method="+method));

    // format HTTP request
    var req = method + " " + path + " HTTP/1.1\r\n";
    req += "Host:"+this.ip+"\r\n"; 
    for (var k in headers)
	req += k + ": "+headers[k]+"\r\n"; 
    req += "\r\n";
    req += (data ? data + "\r\n\r\n" : "");

    console.info("http request\n\n" + req);

    this.makesocketreq(callback,"send",[this.socketid,req]);
};
	    
http.prototype.receive = function(callback) {
    if (!this.socketid || this.socketid<0)
	return callback(error("execerror","not connected"));

    var that = this;
    var idx, htmlres = "";
    var handleres = function(res) {
	if (res.error) {
	    callback(res, true);
	    return;
	}
	    
	htmlres += res.data;
	idx = htmlres.indexOf('</html>');
	if (idx>=0) {
	    // end tag found, return the document
	    callback(htmlres.substring(0,idx+'</html>'.length), true);
	} else {
	    // no end tag, continue to receive
	    that.makesocketreq(handleres,"recv",[that.socketid,true,1000]);
	}
    };
    this.makesocketreq(handleres,"recv",[this.socketid,true,1000]);
};

http.prototype.close = function(callback) {
    if (this.socketid && this.socketid>=0) {
	this.makesocketreq(function() {},"close", [this.socketid]);
    }
    this.socketid = -1;
    callback({}, true);
};
	
