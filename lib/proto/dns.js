/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew DNS protocol implementation using fathom sockets.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const _ = require('underscore');
const socketapi = require("socketapi");
const dnscore = require('proto/dnsrecord');
const DNSRecord = dnscore.DNSRecord;
const {error, FathomException} = require("error");

/** DNS object constructor. */
var dns = exports.DNS = function(manifest, server, proto, port) {
    this.manifest = manifest;   // requesting page manifest

    this.server = server;       // dns server ip
    this.proto = proto || 'udp';// udp or tcp
    this.port = port || 53;     // dns server port

    this.reqid = 0;
    this.socketids = {};        // fathom socket ids
    this.lookupid = 1;          // running socket req id
};

dns.prototype.makesocketreq = function(callback, method, params, multi) {
    this.reqid += 1;
    socketapi.exec(callback,
		   { module : "socket",
		     submodule : this.proto,
		     id : this.reqid,
		     method : method,
		     params : params,
		     multiresp : multi || false
		   },
		   this.manifest);
};

/** The response object send back by all lookup methods. */    
var DNSResponse = exports.DNSResponse = function(name, r) {
    this.request = name;
    this.cname = undefined; // canonical name
    this.answers = [];      // list of IP addresses
    
    var that = this;
    if (_.isFunction(r.hasMore)) {
	// FF native lookup methods
    	while (r.hasMore()) {
    	    this.answers.push(r.getNextAddrAsString());
    	}
	this.cname = r.canonicalName;
    } else if (_.isArray(r.answer)) {
	// javascript DNS record
	_.each(r.answer, function(a) {
	    switch (a.type) {
	    case dnscore.NAME_TO_QTYPE.CNAME:
		that.cname = a.data;
		break;
	    case dnscore.NAME_TO_QTYPE.A:
    		that.answers.push(a.address);
		break;
	    default:
		break;
	    }
	});
    }
};

/** DNS lookup using fathom sockets. */
dns.prototype.lookup = function(callback, hostname, timeout) {
    timeout = timeout || 60; // 1min default timeout (s)

    var id = this.lookupid;
    this.lookupid += 1;

    var q = new DNSRecord();
    q.question.push({ 
    	name: hostname, 
    	type: dnscore.NAME_TO_QTYPE.A, 
    	'class': dnscore.NAME_TO_QCLASS.IN 
    });
    q.id = id;
    var req = dnscore.writeToByteArray(q);

    var that = this;
    if (this.proto === "udp") {
        that.makesocketreq(function(s) { // open udp socket
            if (s.error)
		return callback(s, true);

            // keep a reference for the close function
            that.socketids[id] = s;
            var closes = function(err) {
    	        that.makesocketreq(function() {}, 
    				   "close", 
    				   [s]);
                delete that.socketids[id];
                if (err)
                    callback(err, true);
            };

            that.makesocketreq(function(res) { // send request
                if (res.error)
		    return closes(res);
		
                that.makesocketreq(function(res) { // recv
                    var resp = undefined;
                    if (res.error && !res.timeout) {
                        resp = res;
                    } else if (res.error && res.timeout) {
                        resp = {timeout : true};
                    } else if (res.data) {
        		resp = new DNSResponse(hostname, 
					       dnscore.parse(res.data));
                    } else {
			resp = error("parseerror","got empty response");
		    }
                    callback(resp, true);
                    closes();        
                }, "udpRecvFrom", [s, false, timeout*1000]);
            }, "udpSendTo", [s, req, that.server, that.port]);
        }, "udpOpen", []);
	
    } else if (this.proto === 'tcp') {
        that.makesocketreq(function(s) { // open tcp socket
            if (s.error)
		return callback(s, true);

            // keep a reference for the close function
            that.socketids[id] = s;
            var closes = function(res) {
    	        that.makesocketreq(function() {},"close",[s]);
                delete that.socketids[id];
                if (res)
                    callback(res, true);
            };

            that.makesocketreq(function(res) { // send request
                if (res.error)
		    return closes(res);

		var data;
		var recvloop = function() {
                    that.makesocketreq(function(res,done) { // recv
			if (res.error && !res.timeout)
			    return closes(res);

			if (res.data) {
			    if (!data)
				data = res.data
			    else
				data += res.data;
			    recvloop();
			} else {
                            var resp = undefined;
                            if (data) {
        			resp = new DNSResponse(hostname, 
						       dnscore.parse(data));
                            } else {
				resp = error("parseerror","got empty response");
			    }
                            closes(resp);  
			}

                    }, "recv", [s, false, timeout*1000]);
		}; // recvloop
		recvloop();

            }, "send", [s, req]);
        }, "tcpOpenSendSocket", [that.server, that.port]);
 
    } else {
        callback(error("internal","unsupported protocol, proto="+this.proto));
    }
};

/** Stop any on-going lookups. */
dns.prototype.close = function(callback) {
    for (var id in this.socketids) {
        this.makesocketreq(function() {},"close",[this.socketids[id]]);
    }
    this.socketids = {};
    this.reqid = 0;
    callback({}, true);
};
