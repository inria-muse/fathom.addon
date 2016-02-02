/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew UPnP device discovery protocol implementation using 
 * fathom sockets. 
 *
 * TODO: add other UPnP stuff like querying more router data ...
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
var {Cc, Ci} = require("chrome");
var parser = Cc["@mozilla.org/xmlextras/domparser;1"].createInstance(Ci.nsIDOMParser);

const timers = require("sdk/timers");
const Request = require("sdk/request").Request;

const socketapi = require("../socketapi");

// Various UPnP protocol constants
const SSDP_PORT = 1900;
const SSDP_MCAST_ADDR = "239.255.255.250";
const SSDP_MSEARCH = 
"M-SEARCH * HTTP/1.1\r\n"+
"HOST:"+SSDP_MCAST_ADDR+":"+SSDP_PORT+"\r\n"+
"ST:ssdp:all\r\n"+
"MAN:\"ssdp:discover\"\r\n"+
"MX:10\r\n\r\n";
const SSDP_ALIVE = 'ssdp:alive';
const SSDP_BYEBYE = 'ssdp:byebye';
const SSDP_UPDATE = 'ssdp:update';
const UPNP_NTS_EVENTS = {
    'ssdp:alive': 'DeviceAvailable',
    'ssdp:byebye': 'DeviceUnavailable',
    'ssdp:update': 'DeviceUpdate'
};
const SSDP_IGW = 'urn:schemas-upnp-org:device:InternetGatewayDevice:1';

/** UPnP object constructor. */
var upnp = exports.UPNP = function(manifest) {
    this.manifest = manifest;
    this.reqid = 0;
    this.socketid = -1;         // fathom socket id
};

upnp.prototype.makesocketreq = function(callback, proto, method, params, multi){
    this.reqid += 1;
    socketapi.exec(callback, { 
        module : "socket",
         submodule : proto,
         id : this.reqid,
        method : method,
        params : params,
        multiresp : multi || false
    },
     this.manifest);
};

/** The response object send back by discovery. */    
var UPNPResponse = exports.UPNPResponse = function(address, ssdp, xml) {
    this.address = address;       // ipv4
    this.ssdp = ssdp;             // service discovery data

    this.iswin = (this.ssdp && this.ssdp.server &&
      this.ssdp.server.toLowerCase().indexOf('windows')>=0) || undefined;

    if (xml) {
        var doc = xml2json(xml);
        doc = (doc && doc.root ? doc.root : doc);
        this.xml = (doc && doc.device ? doc.device : doc);
        this.isgw = (this.xml.deviceType && this.xml.deviceType == SSDP_IGW) || undefined;
    }

    this.proto = 'upnp';
};

/** MongoDB compatiple keys (i.e. no dots!). */
var escape = function(key) {
    return key.replace(/\./g,'_');
};

/** Parse xml formatted string to a json object. */
var xml2json = function(xmlstr) {

    var helper = function(xml) {
        // Code below modified from:
        // http://davidwalsh.name/convert-xml-json
        
        // Create the return object
        var obj = {};
        
        if (xml.nodeType == 1) { // element
            // do attributes
            if (xml.attributes.length > 0) {
                obj["@attributes"] = {};
                for (var j = 0; j < xml.attributes.length; j++) {
                    var attribute = xml.attributes.item(j);
                    obj["@attributes"][escape(attribute.nodeName)] = attribute.value;
                }
            }
        } else if (xml.nodeType == 3) { // text
            obj = xml.nodeValue;
        }
        
        // do children
        if (xml.hasChildNodes()) {
            for (var i = 0; i < xml.childNodes.length; i++) {
                var item = xml.childNodes.item(i);
                var nodeName = escape(item.nodeName);
                if (typeof(obj[nodeName]) == "undefined") {
                    if (nodeName == "#text") {
                        return item.nodeValue;
                    } else {
                        obj[nodeName] = helper(item);
                    }
                } else {
                    if (typeof(obj[nodeName].push) == "undefined") {
                        var old = obj[nodeName];
                        obj[nodeName] = [];
                        obj[nodeName].push(old);
                    }
                    obj[nodeName].push(helper(item));
                }
            }
        }
        return obj;
    }; // helper

    var doc = parser.parseFromString(xmlstr, "application/xml"); 
    return helper(doc);
}; // xml2json

upnp.prototype.discovery = function(callback, timeout) {
    timeout = timeout || 300; // default to 5min

    if (this.socketid !== -1)
        this.close(function() {});
    this.socketid = -1;
    this.manifest.neighbors['upnp'] = {};

    var that = this;
    var getxml = function(address, headers) {
        var url = headers.location;
        if (url.indexOf('http')<0) {
             return callback(new UPNPResponse(
                address,
                headers,
                undefined), false);
        }
        Request({
            url: url,
            onComplete: function(response) {
                console.info("upnp getxml returns: " + 
                   response.status+"/"+response.statusText);
                if (that.socketid!==-1) {
                    if (response.status === 200) {
                        callback(new UPNPResponse(address,
                          headers,
                          response.text), false);
                    } else {
                        callback(new UPNPResponse(address,
                          headers,
                          undefined), false);
                    }           
                } // else closed already, ignore response
            }
        }).get();
    }; // getxml

    // multicast lookup
    var stoptimer = undefined;
    that.makesocketreq(function(s) { // open socket
        if (s.error)
            return callback(s, true);

        that.socketid = s;
        that.makesocketreq(function(res) { // send request
            if (res.error) {
                that.makesocketreq(
                    function() {}, 
                    "multicast", 
                    "close", 
                    [that.socketid]);
                that.socketid = -1;
                return callback(res, true);
            }

            // make sure we eventually stop listening for answers
            stoptimer = timers.setTimeout(function() {
                that.close();
                callback({timeout : true}, true);
            }, timeout*1000);

            that.makesocketreq(function(res) { // start recv
                if (res.error) {
                    // stopping on error, cancel the timer
                    if (stoptimer)
                        timers.clearTimeout(stoptimer);
                    stoptimer = undefined;
                    that.close();
                    return callback(res, true);
                }

                if (!res.data || res.data.length===0) // continue
                    return;

                var lines = res.data.split('\r\n');
                var headers = {};
                for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    var idx = line.indexOf(':');
                    if (idx > 0) {
                        var k = escape(line.substring(0,idx).toLowerCase());
                        var v = line.substring(idx+1).trim();
                        headers[k] = v;
                    }
                }

                if (headers.location && 
                    !that.manifest.neighbors['upnp'][res.address]) {
                    console.info("upnp new device " + res.address);
                    that.manifest.neighbors['upnp'][res.address] = true;
                    // get more info from the device and return callback
                    getxml(res.address, headers);

                } // else prob with headers or got multiple resp from same dev
            }, "multicast", "udpRecvFromStart", [that.socketid, true], true);
        }, "multicast", "udpSendTo", [that.socketid, SSDP_MSEARCH, SSDP_MCAST_ADDR, SSDP_PORT]);
    }, "multicast", "multicastOpenSocket", []);
}; // lookup

upnp.prototype.close = function(callback) {
    // multicast response socket
    if (this.socketid && this.socketid !== -1) {
        this.makesocketreq(function() {}, 
          "multicast", "udpRecvStop", [this.socketid]);
        this.makesocketreq(function() {}, 
          "multicast", "close", [this.socketid]);
    }
    this.socketid = -1;
    if (callback)
        callback({}, true);
};
