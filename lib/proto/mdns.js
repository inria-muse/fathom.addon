/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew mDNS protocol implementation using fathom sockets.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const timers = require("sdk/timers");
const _ = require('underscore');
const socketapi = require("socketapi");
const dnscore = require('proto/dnsrecord');
const DNSRecord = dnscore.DNSRecord;

// mDNS protocol constants
const MDNS_DEST_ADDR = '224.0.0.251';
const MDNS_DEST_PORT = 5353;
const DNSSD_DOMAIN = "_services._dns-sd._udp.local.";

// Service names to look for from gateways ..
const GW_SERVICE_MATCH = ['openwrt','freebox-server'];

/** mDNS object constructor. */
var mdns = exports.MDNS = function(manifest) {
    this.manifest = manifest;   // requesting page manifest
    this.socketid = -1;        // fathom socket id
    this.reqid = 0;
};

mdns.prototype.makesocketreq = function(callback, method, params, multi) {
    this.reqid += 1;
    socketapi.exec(callback,
		   { module : "socket",
		     submodule : "multicast",
		     id : this.reqid,
		     method : method,
		     params : params,
		     multiresp : multi || false
		   },
		   this.manifest);
};

/** The response object send back by discovery. */    
var MDNSResponse = exports.MDNSResponse = function(address) {
    this.address = address;    // ipv4
    this.address6 = undefined; // ipv6 address
    this.hostname = undefined; // hostname
    this.services = [];        // list of available services
    this.proto = 'mdns';
};

MDNSResponse.prototype.update = function(a) {
    switch (a.type) {
    case dnscore.NAME_TO_QTYPE.PTR:
	var name = a.data;
	this.services.push({ name : name });

	// check for some well known service types
	if (!this.isgw)
	    this.isgw = _.some(GW_SERVICE_MATCH, function(n) {
		return (name.toLowerCase().indexOf(n)>=0);
	    }) || undefined;

	if (!this.isfathom)
	    this.isfathom = (name.toLowerCase().indexOf('fathom')>=0) || undefined;

	if (!this.islinux)
	    this.islinux = (name.toLowerCase().indexOf('linux')>=0) || undefined;

	break;

    case dnscore.NAME_TO_QTYPE.TXT:
	var r = _.find(this.services, function(sr) {
	    return (sr.name === a.name);
	});
	if (r)
	    r.path = a.data[0];
	break;

    case dnscore.NAME_TO_QTYPE.SRV:
	var r = _.find(this.services, function(sr) {
	    return (sr.name === a.name);
	});
	if (r) {
	    r.port = a.port;
	    r.hostname = a.target;
	}
        if (a.target)
            this.hostname = a.target;
	break;

    case dnscore.NAME_TO_QTYPE.AAAA:
	this.address6 = a.address;
	break;
    default:
	break;
    }
};

mdns.prototype.discovery = function(callback, timeout) {
    timeout = timeout || 60; // default to 1min

    // cleanup previous on-going requests
    if (this.socketid && this.socketid !== -1)
        this.makesocketreq(function() {}, 
			   "close", 
			   [this.socketid]);
    this.socketid = -1;
    this.manifest.neighbors['mdns'] = {};

    var rescache = {};

    var q = new DNSRecord();
    q.question.push({ 
    	name: DNSSD_DOMAIN, 
    	type: dnscore.NAME_TO_QTYPE.PTR, 
    	'class': dnscore.NAME_TO_QCLASS.IN 
    });
    var req = dnscore.writeToByteArray(q);

    var that = this;
    
    var stoptimer = undefined;
    var stoplookup = function(error) {
    	// stop listening for responses
    	that.makesocketreq(function() {}, 
    			   "udpRecvStop", 
    			   [that.socketid]);
    	that.makesocketreq(function() {}, 
    			   "close", 
    			   [that.socketid]);
    	that.socketid = -1;
 
	// return all incomplete objects
	_.each(rescache, function(v,k) {
	    if (!v.cbdone) {
    		callback(v.o, false);
	    }
	});

	if (error) {
    	    callback(error, true); 
	} else {
            callback({timeout : true}, true);
	}
    };
    
    // multicast lookup
    that.makesocketreq(function(s) { // open socket
    	if (s.error)
	    return callback(s,true);
    	that.socketid = s;

    	that.makesocketreq(function(res) { // send request
     	    if (res.error) {
        	that.makesocketreq(function() {}, 
        			   "close", 
        			   [that.socketid]);
        	that.socketid = -1;
		return callback(res, true);
    	    }
	    
    	    // make sure we eventually stop listening for answers
    	    stoptimer = timers.setTimeout(stoplookup, timeout*1000);
	    
    	    that.makesocketreq(function(res) { // start recv
         	if (res.error) {
        	    // stopping on error, cancel the timer
        	    if (stoptimer)
        		timers.cancelTimeout(stoptimer);
        	    stoptimer = undefined;
        	    stoplookup(res);
        	    return;
        	}

        	if (!res.data || res.data.length === 0)
        	    return;

		if (!that.manifest.neighbors['mdns'][res.address]) {
		    console.info("mdns found new device "+res.address);
		    that.manifest.neighbors['mdns'][res.address] = true;

		    rescache[res.address] = {
			o : new MDNSResponse(res.address),
			c : 0,
			rc : 0,
			cbdone : false
		    };
		} else {
		    rescache[res.address].rc += 1;
		    rescache[res.address].cbdone = false;
		}

        	var resp = dnscore.parse(res.data);
		for (var i = 0; i < resp.answer.length; i++) {
		    var a = resp.answer[i];
		    if (a.type === dnscore.NAME_TO_QTYPE.PTR) {
			rescache[res.address].c += 1;

			// request more info about the discovered service
			var q = new DNSRecord();
			q.question.push({ 
    			    name: a.data, 
    			    type: dnscore.NAME_TO_QTYPE.ANY, 
    			    'class': dnscore.NAME_TO_QCLASS.IN 
			});
			var req = dnscore.writeToByteArray(q);
			that.makesocketreq(function(res) {},
					   "udpSendTo", 
					   [that.socketid, 
					    req, 
					    MDNS_DEST_ADDR, 
					    MDNS_DEST_PORT]);
		    }
		    rescache[res.address].o.update(a);
		}

		if (rescache[res.address].rc == rescache[res.address].c) {
		    callback(rescache[res.address].o, false);
		    rescache[res.address].cbdone = true;
		}

	    },"udpRecvFromStart", [that.socketid, false], true);
	},"udpSendTo", [that.socketid, req, MDNS_DEST_ADDR, MDNS_DEST_PORT]);
    },"multicastOpenSocket", []);
};

mdns.prototype.close = function(callback) {
    if (this.socketid && this.socketid !== -1)
        this.makesocketreq(function() {},"close",[this.socketid]);
    this.socketid = -1;
    this.reqid = 0;
    if (callback)
	callback({}, true);
};
