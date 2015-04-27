/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.tools.* API functions.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");

const self = require("sdk/self");
const system = require("sdk/system");
const Request = require("sdk/request").Request;
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");
const { all, defer, promised } = require('sdk/core/promise');

const _ = require('underscore');

const {error, FathomException} = require("error");
const config = require("config");
const utils = require("utils");

const systemapi = require("systemapi");
const baselineapi = require("baselineapi");
const socketapi = require("socketapi");
const protoapi = require("protoapi");
const DNSResponse = require("proto/dns").DNSResponse;

// Manifest for remote API stuff (allows access to the multicast
// discovery & localnet remote API calls when using tools.remoteapi.*).
const apimanifest = {
    isaddon : true, // skip all dst checks
    winid : 'toolsapi',
    neighbors : []
};

/** Check if we are connected to the internet. Tries few tricks to be sure it works in any env:
 *   - HTTP HEAD to google.com (should work unless internet/google/dns is down)
 *   - HTTP HEAD to our MSERVER (our IP address in case google/dns is down)
 */
var isConnected = exports.isConnected = function(callback) {
    var pcfg = {
        proto : 'xmlhttpreq',
        count : 1, 
        timeout : 5,
        reports : false
    };

    socketapi.exec(function(res, done) {
        if (!res.error && res.pings.length > 0) {
            return callback(true, true);
        }

        // try our server in case google/dns was just down (unlikely)
        socketapi.exec(function(res, done) { 
           return callback((!res.error && res.pings.length > 0), true);
        }, {module : 'tools',
            submodule : 'ping',
            method : 'start', 
            params : [config.MSERVER_FR, pcfg],
            id : 2
        }, apimanifest);

    }, {module : 'tools',
        submodule : 'ping',
        method : 'start', 
        params : ['www.google.com', pcfg],
        id : 1
    }, apimanifest);
};

// store mac lookup results in memory to avoid requesting same MACs
// over and over again, size limited to MAX_CACHE, policy LFRU
var maccache = {};
const MAX_CACHE = 1000;

/** Lookup device manufacturer info based on MAC address. */
var lookupMAC = exports.lookupMAC = function(callback, mac) {    
    if (maccache[mac]) {
        maccache[mac].ts = new Date().getTime();
        callback(maccache[mac].obj);
        return;
    }

    Request({
        url: config.API_URL+"/mac/"+mac,
        onComplete: function(response) {
            if (response.status == 200) {
                maccache[mac] = { 
                    obj : response.json, 
                    ts : new Date().getTime()
                };

                callback(response.json);

                if (_.size(maccache) > MAX_CACHE) {
                    // delete some items to keep the cache size down
                    _.each(_.sortBy(_.keys(maccache), 
                        function(k) {
                            return maccache[k].ts; // oldest first
                        }).slice(0,100),           // first 100 
                         function(k) {
                            delete maccache[k];
                        }); // _.each            
                }
            } else {
                let err = undefined;
                if (response.json && response.json.error)
                    err = error("servererror",
                      response.json.error);
                else
                    err = error("http",
                      response.status+"/"+response.statusText);
                callback(err);
            }
        }
    }).get();
};

/** Lookup current public IP or more info on the given IP. */
var lookupIP = exports.lookupIP = function(callback, ip) {
    Request({
        url:  config.API_URL+"/geo" + (ip ? "/"+ip : ""),
        onComplete: function(response) {
            if (response.status == 200) {
                callback(response.json);
            } else {
                let err = undefined;
                if (response.json && response.json.error)
                    err = error("servererror",response.json.error);
                else
                    err = error("http",response.status+"/"+response.statusText);
                callback(err);
            }
        }
    }).get();
};

/** Get certificate chain for given url. */
var getCertChain = exports.getCertChain = function(callback, uri) {
    if (!uri)
        return callback(error("missingparams", "uri"));

    var makeURI = function(aURL, aOriginCharset, aBaseURI) {  
        var ioService = Cc["@mozilla.org/network/io-service;1"]
        .getService(Ci.nsIIOService);  
        return ioService.newURI(aURL, aOriginCharset, aBaseURI);  
    }; 

    var getSecurityInfo = function(channel) {
        var info = {
            security: {
                state: null,
                description: null,
                errorMsg: null
            },
            certs: []
        };
        try {
            var secInfo = channel.securityInfo;
            if (secInfo instanceof Ci.nsITransportSecurityInfo) {       
                secInfo.QueryInterface(Ci.nsITransportSecurityInfo);
                if ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_SECURE) == Ci.nsIWebProgressListener.STATE_IS_SECURE)
                    info.security.state = "Secure";

                else if ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_INSECURE) == Ci.nsIWebProgressListener.STATE_IS_INSECURE)
                    info.security.state = "Insecure";

                else if ((secInfo.securityState & Ci.nsIWebProgressListener.STATE_IS_BROKEN) == Ci.nsIWebProgressListener.STATE_IS_BROKEN)
                    info.security.state = "Unknown";

                info.security.description = secInfo.shortSecurityDescription;
                info.security.errorMsg = secInfo.errorMessage;
            }

            // Get SSL certificate details
            if (secInfo instanceof Ci.nsISSLStatusProvider) {
                var status = secInfo.QueryInterface(Ci.nsISSLStatusProvider).SSLStatus.QueryInterface(Ci.nsISSLStatus);
                var serverCert = status.serverCert;
                if (serverCert instanceof Ci.nsIX509Cert) {
                    var certChain = serverCert.getChain().enumerate();
                    while (certChain.hasMoreElements()) {
                        info.certs.push(certChain.getNext().QueryInterface(Ci.nsIX509Cert));
                    }
                }
            }
        } catch(e) {
            info = error("internal", e.message);
        }
        return info;
    }; // get sec info

    var httpRequest = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"]
        .createInstance();
    httpRequest.mozBackgroundRequest = true;
    httpRequest.open("GET", makeURI(uri, null, null).prePath, true); 
    httpRequest.onreadystatechange = function(aEvt) {  
        if (httpRequest.readyState == 4) {
            var info = getSecurityInfo(httpRequest.channel);
            callback(info, true);
        }
    };
    httpRequest.send(null);
};

/** Hostname DNS lookup method using xpcom services. */
var lookupHostname = exports.lookupHostname = function(callback, hostname) {
    if (!hostname)
        return callback(error("missingparams", "hostname"));

    var service = Cc["@mozilla.org/network/dns-service;1"]
        .createInstance(Ci.nsIDNSService);
    var flag = Ci.nsIDNSService.RESOLVE_BYPASS_CACHE | Ci.nsIDNSService.RESOLVE_CANONICAL_NAME;
    var thread = Cc["@mozilla.org/thread-manager;1"]
        .getService(Ci.nsIThreadManager).currentThread;

    var dnsCallback = {
        onLookupComplete: function(request, record, status){
            if (record != null){
                callback(new DNSResponse(hostname, record));
            } else {        
                callback(error("internal",
                 "lookup returns empty record, status="+status));
            }
        }
    };

    service.asyncResolve(hostname, flag, dnsCallback, thread);
};

/** Url DNS lookup method using xpcom services. */
var lookupUrl = exports.lookupUrl = function(callback, url) {
    if (!url)
        return callback(error("missingparams", "url"));

    // TODO: can we use the sdk url class instead ?
    var ioService = Cc["@mozilla.org/network/io-service;1"]
        .getService(Ci.nsIIOService);
    var aURI = undefined;
    try {
        aURI = ioService.newURI(url, null, null);
    } catch (e) {
        return callback(error("invalidparams", "url="+url));
    }
    if (!aURI || !aURI.host)
        return callback(error("invalidparams", "url="+url));
    
    var dnsCallback = {
        onLookupComplete: function(request, record, status){
            if (record != null) {
                callback(new DNSResponse(url, record), true);
            } else {
                callback(error("internal",
                 "lookup returns empty record, status="+status));
            }
        }
    };
    var service = Cc["@mozilla.org/network/dns-service;1"]
        .getService(Ci.nsIDNSService);
    var flag = Ci.nsIDNSService.RESOLVE_BYPASS_CACHE | Ci.nsIDNSService.RESOLVE_CANONICAL_NAME;
    var thread = Cc["@mozilla.org/thread-manager;1"]
        .getService(Ci.nsIThreadManager).currentThread;

    service.asyncResolve(aURI.host, flag, dnsCallback, thread);
};

/** Network neighborhood discovery using selected protocols.  */
var discovery = exports.discovery = function(callback, timeout, protocols, manifest) {
    if (!protocols) {
        protocols = ['local','route','internet','upnp','mdns','ping', 'arptable']; 
    }

    // common result node format
    var Node = function(type, reach, ipv4, ipv6, r) {
        this.type = type;       // type: local | peer | gw | internet
        this.reachable = reach; // reachable (ping)
        this.ipv4 = ipv4;       // ipv4
        this.ipv6 = ipv6;       // ipv4
        this.raw = {};          // the raw discovery data (variable / proto)
        if (r && r.proto)
            this.raw[r.proto] = r;
    };

    // handle new node
    var addnode = function(neighp, node) {
        if (neighp && node.reachable) {
            if (!manifest.neighbors[neighp])
                manifest.neighbors[neighp] = {};
            if (node.ipv4)
                manifest.neighbors[neighp][node.ipv4] = true;
            if (node.ipv6)
                manifest.neighbors[neighp][node.ipv6] = true;
        }
        timers.setTimeout(callback, 0, node, false);
    };

    // last callback with done=true (all others will send done=false)
    if (!timeout)
        timeout = 10;
    timers.setTimeout(callback, timeout*1000+500, {}, true);

    _.each(protocols, function(p) {
        switch (p) {
        case "local":
            // discover local node
            var raw = { proto : 'local'};
            baselineapi.getnetworkenv(function(env) {
                if (!env.error)
                    raw.networkenv = env;

                systemapi.exec(function(hostname) {
                    if (!hostname.error)
                        raw.hostname = hostname.result;

                    systemapi.exec(function(ifaces) {
                        if (!ifaces.error)
                            raw.interfaces = ifaces.result;

                        var defiface = (raw.interfaces ? _.find(
                            raw.interfaces, function(iface) {
                                return (iface.name === raw.networkenv.default_iface_name);
                            }) : undefined);

                        var node = new Node(
                            'local',
                            true, // reachable
                            (defiface ? defiface.ipv4 : "127.0.0.1"),
                            (defiface ? defiface.ipv6 : undefined), 
                            raw);

                        addnode(undefined, node);

                    },{ method : 'getInterfaces', params : [true]});
                },{ method : 'getHostname'});
            });
            break;

        case "route":
            // discover gateway(s) based on routing table
            systemapi.exec(function(ifaces) {
                if (ifaces.error || ifaces.result.length <= 0)
                    return;
                ifaces = ifaces.result;

                // get routes
                systemapi.exec(function(routes) {
                    if (routes.error || routes.result.routes.length <= 0)
                        return;

                    // rgateway of each interface
                    var rifaces = _.groupBy(routes.result.routes, 'iface');

                    _.each(rifaces, function(routes, name) {
                        var raw = {                    
                            proto : 'route',
                            ifacename : name,
                            iface : _.find(ifaces, function(iface) { return (iface.name === name); }),
                            routes : routes
                        };

                        if (!raw.iface) {
                            return;
                        }

                        var ipv4 = _.find(_.pluck(raw.routes, 'gateway'), utils.isValidIPv4unicast);
                        var ipv6 = _.find(_.pluck(raw.routes, 'gateway'), utils.isValidIPv6unicast);
                        if (!ipv4 && !ipv6) {
                            return;
                        }

                        var node = new Node(
                            'gw',
                            false,
                            ipv4,
                            ipv6,
                            raw);

                        // check reach
                        systemapi.exec(function(res) {
                            node.reachable = (!res.error && res.result.rtt.length > 0);

                            // check internet reach via this gw
                            systemapi.exec(function(res2) {
                                node.internet_reachable = (!res2.error && res2.result.rtt.length > 0);
                                node.reachable = node.reachable || node.internet_reachable;

                                // done!
                                addnode('localnet', node);

                            }, {method : 'doPing', 
                                params : [config.MSERVER_FR, {
                                  count : 3, 
                                  timeout : Math.min(5,timeout/2), 
                                  interval : 0.5,
                                  iface : ((utils.isWin() || utils.isDarwin()) ?  
                                            (raw.iface.ipv4!==undefined ? raw.iface.ipv4 : raw.iface.ipv6) : 
                                            raw.iface.name)
                               }]
                            });

                        },{ method : 'doPing', 
                            params : [(ipv4!==undefined ? ipv4 : ipv6), {
                                count : 3, 
                                timeout : Math.floor(Math.min(2,timeout/2.0)), 
                                interval : 0.5
                            }]
                        });
                    });     
                },{ method : 'getRoutingTable'});
            }, { method : 'getInterfaces', params : [true]});
            break;

        case "internet":
            var node = new Node(
                'internet',
                false,
                config.MSERVER_FR, // use some fixed address that will not appear as other node's address
                undefined,
                undefined);

            lookupIP(function(res) {
                if (!res.error) {
                    node.reachable = true;
                    res.proto = 'internet';
                    node.raw['internet'] = res;
                    addnode(undefined, node);
                } else {
                    isConnected(function(c) {
                        node.reachable = c;
                        addnode(undefined, node);
                    });
                }
            });
            break;

        case "mdns":
            protoapi.exec(function(id) {
                protoapi.exec(function(dev, doneflag) {
                    if (dev.address) {
                        var node = new Node(
                            (dev.isgw ? 'gw' : 'peer'),
                            true,
                            dev.address,
                            undefined,
                            dev);
                        addnode(p, node);
                    } // ignore

                    if (doneflag) {
                        protoapi.exec(function() {}, { 
                            module : "proto", 
                            submodule: p, 
                            method : 'close',                             
                            params : [id]}, apimanifest);
                    }
                }, {module : "proto", 
                    submodule: p, 
                    method : 'discovery', 
                    params : [id, timeout]}, apimanifest);
            }, {module : "proto", 
                submodule: p, 
                method : 'create', 
                params : []}, apimanifest);
            break;

        case "upnp":
            protoapi.exec(function(id) {
                protoapi.exec(function(dev, doneflag) {
                    if (dev.address) {
                        var node = new Node(
                            (dev.isgw ? 'gw' : 'peer'),
                            true,
                            dev.address,
                            undefined,
                            dev);
                        addnode(p, node);
                    } // ignore

                    if (doneflag) { // cleanup
                        protoapi.exec(function() {}, { 
                            module : "proto", 
                            submodule: p, 
                            method : 'close', 
                            params : [id]}, apimanifest);
                    }
                }, {module : "proto", 
                    submodule: p, 
                    method : 'discovery', 
                    params : [id, timeout]}, apimanifest);
            }, {module : "proto", 
                submodule: p, 
                method : 'create', 
                params : []}, apimanifest);
            break;

        case "ping":
            // get active interfaces
            systemapi.exec(function(ifaces) {
                if (ifaces.error)
                    return;

                // send bcast ping on each local net interface
                _.each(ifaces.result, function(iface) {
                    if (iface.type === 'loopback' || !iface.broadcast || 
                        iface.broadcast.indexOf('169.') == 0) {
                        return; // skip
                    }

                    systemapi.exec(function(res, doneflag) {
                        if (res.error)
                            return;

                        _.each(res.result.alt, function(r) {
                            if (r.address) {
                                r.proto = 'ping';
                                r.srciface = iface;

                                systemapi.exec(function(res, doneflag) {
                                    if (!res.error && res.result && res.result.length == 1) {
                                        r.arp = res.result[0];
                                    }

                                    var node = new Node(
                                        'peer',
                                        true,  // reach
                                        (utils.isValidIPv4(r.address) ? r.address : undefined),
                                        (utils.isValidIPv6(r.address) ? r.address : undefined),
                                        r);

                                    addnode('localnet', node);

                                }, { method : 'getArpCache', params : [r.address]});
                            }
                        }); // foreach                        
                    }, {method : 'doPing', 
                        params: [iface.broadcast, { 
                           count : 2,
                           interval : timeout/2,
                           timeout : timeout,
                           bcast : true}]
                    });
                }); // foreach ifaces
            }, { method : 'getInterfaces', params : [true]});
            break;

        case "arptable":
            systemapi.exec(function(res) {
                if (res.error) return;

                _.each(res.result, function(raw) {
                    systemapi.exec(function(pres) {
                        // only report nodes that we can reach (others may be stale entries etc. )
                        if (!pres.error && pres.result.rtt.length > 0) {                            
                            lookupMAC(function(lookupres) {
                                raw.proto = 'arptable';
                                if (lookupres && !lookupres.error) {
                                    raw.devinfo = lookupres;
                                }

                                var node = new Node(
                                    'peer',
                                    true,
                                    raw.address,
                                    undefined,
                                    raw);

                                addnode('localnet', node);
                            }, raw.mac);
                        }
                    },{ method : 'doPing', 
                        params : [raw.address, {
                            count : 3, 
                            timeout : Math.floor(Math.min(2,timeout/2.0)), 
                            interval : 0.5
                        }]
                    });   
                }); // foreach
            }, { method : 'getArpCache', params : [] });
            break;

        }
    });
}; // discovery

// JSONRPC server instances - only one of each is running per extension
// process 
// TODO: what if running multiple browser windows ? now just reuse sock ..
var discoveryserver = undefined;
var apiserver = undefined;
var startstopcache = {};

// The discovery object. Exposes min amount of info about the node.
const idblock = {
    fathom_version : self.version,
    fathom_uuid : ss.storage['public_uuid'] // TODO: remove this too, lets track a device?
};

// Incoming Fathom discovery request response handler
var replysearch = function(req) {
    req.result = idblock;
    protoapi.exec(function(res) {
        if (res.error) console.warn("toolsapi sendres failed",res);
    }, {module : "proto", 
        submodule: "jsonrpc", 
        method : 'sendres', 
        params : [discoveryserver,req]
    }, apimanifest);
};

// Incoming Fathom API request response handler

// FIXME: should have fathom.init and ask this dev user consent 
// before giving access to anything else !!!
// Now access to all methods allowed with privileged apimanifest ...

var replyapi = function(req) {
    // method is the full name
    var tmp = req.method.split('.');
    if (tmp.length == 2) {
        req.module = tmp[0];
        req.method = tmp[1];

    } else if (tmp.length == 3) {
        req.module = tmp[0];
        req.submodule = tmp[1];
        req.method = tmp[2];

    } else {
        // problem with the request
        protoapi.exec(function(res) {
            if (res.error) console.warn("toolsapi reply failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [apiserver,req,'invalidreq']
        }, apimanifest);
    }

    var cb = function(res,done) {
        req.result = res;
        protoapi.exec(function(res) {
            if (res.error) console.warn("toolsapi reply failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [apiserver,req,res.error]
        }, apimanifest);
    };

    // handle request using the API modules
    switch (req.module) {
    case 'system':
        systemapi.exec(cb, req, apimanifest);
        break;  
    case 'baseline':
        baselineapi.exec(cb, req, apimanifest);
        break;  
    case 'socket':
        socketapi.exec(cb, req, apimanifest);
        break;  
    case 'proto':
        protoapi.exec(cb, req, apimanifest);
        break;
    case 'tools':
        exec(cb, req, apimanifest);
        break;

    default:
        // no such module
        protoapi.exec(function(res) {
            if (res.error) console.warn("toolsapi reply failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [apiserver,req,'notfound']
        }, apimanifest);
    }
}; // replyapi

var handleremoteapi = exports.handleremoteapi = function(callback, method, params, manifest) {
    switch (method) {
    case "start":
        startstopcache[manifest.winid] = true;

        if (!discoveryserver) {
            // start multicast server to reply Fathom search queries
            console.info("toolsapi start discovery server");
            protoapi.exec(function(id) {
                if (id.error) {
                    startstopcache[manifest.winid] = false;
                    return callback(id);
                }
                    
                console.info("toolsapi started discovery server "+id);
                discoveryserver = id;
            
                // start unicast server to reply Fathom API queries
                console.info("toolsapi start API server");
                protoapi.exec(function(id) {
                    if (id.error) {
                        startstopcache[manifest.winid] = false;
                        handleremoteapi(function() {},"stop",[],manifest);
                        return callback(id);
                    }
                    console.info("toolsapi started api server " + id);
                    apiserver = id;

                    // start listening on incoming connections
                    // on both sockets
                    protoapi.exec(replysearch, {    
                        module : "proto", 
                        submodule: "jsonrpc", 
                        method : 'listen', 
                        params : [discoveryserver]
                    }, apimanifest);

                    protoapi.exec(replyapi, {   
                        module : "proto", 
                        submodule: "jsonrpc", 
                        method : 'listen', 
                        params : [apiserver]
                    }, apimanifest);

                    // give some time for the servers to come up
                    // before triggering the callback
                    timers.setTimeout(callback, 500, {}, true);

                }, {module : "proto", 
                    submodule: "jsonrpc", 
                    method : 'create', 
                    params : [
                        undefined,
                        config.API_PORT,
                        true,
                        "udp"]
                }, apimanifest);
            }, {module : "proto", 
                submodule: "jsonrpc", 
                method : 'create', 
                params : [
                    config.DISCOVERY_IP,
                    config.DISCOVERY_PORT,
                    true,
                    "multicast"]
            }, apimanifest);
        }
        break;

    case "stop":
        if (startstopcache[manifest.winid])
            delete startstopcache[manifest.winid];

        if (_.size(startstopcache) == 0) {
            // no page is requesting the API service to be running, can stop
            if (apiserver) {
                protoapi.exec(function() {}, {
                    module : "proto", 
                    submodule: "jsonrpc", 
                    method : 'close', 
                    params : [apiserver] 
                }, apimanifest);
                apiserver = undefined;
            }
            if (discoveryserver) {
                protoapi.exec(function() {}, {
                    module : "proto", 
                    submodule: "jsonrpc", 
                    method : 'close', 
                    params : [discoveryserver] 
                }, apimanifest);
                discoveryserver = undefined;
            }
        }
        return callback({},true);
        break;

    case "discovery":
        var timeout = (params && params.length > 0 ? params[0] : 10);
        manifest.neighbors['fathom'] = {};  
        protoapi.exec(function(id) {
            if (id.error) {
                callback(id);
                return;
            }

            protoapi.exec(function(res, done) {
                if (!res.error && res.address) {
                    console.info("fathom found new device "+res.address);
                    manifest.neighbors['fathom'][res.address] = true;
                    res.result.address = res.address;
                    callback(res.result, false);
                }

                if (done) {
                    callback({},done);                    
                    protoapi.exec(function() {}, {
                        module : "proto", 
                        submodule: "jsonrpc", 
                        method : 'close', 
                        params : [id] 
                    }, apimanifest);
                }

            }, {module : "proto", 
                submodule: "jsonrpc", 
                method : 'makereq', 
                params : [
                    id,
                    "search",   // method
                    idblock,    // params
                    undefined,  // module
                    undefined,  // urlparams
                    timeout]    // timeout
            }, apimanifest);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'create', 
            params : [
                config.DISCOVERY_IP,
                config.DISCOVERY_PORT,
                false,
                "multicast"]
        }, apimanifest);     
        break;

    case "makereq":
        if (params.length < 2)
            return callback(error("missingparams","node or method"));
        if (!params[0].address)
            return callback(error("invalidparams","node"));

        var reqdst = params[0].address;
        var reqmethod = params[1];
        var reqparams = (params.length === 3 ? params[2] : []);

        protoapi.exec(function(id) {
            if (id.error) {
                return callback(id);
            }

            protoapi.exec(function(res, done) {
                callback(res,done);

                protoapi.exec(function() {}, {
                    module : "proto", 
                    submodule: "jsonrpc", 
                    method : 'close', 
                    params : [id] 
                }, apimanifest);

            }, {module : "proto", 
                submodule: "jsonrpc", 
                method : 'makereq', 
                params : [
                    id,
                    reqmethod,
                    reqparams]
            }, apimanifest);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'create', 
            params : [
                reqdst,
                config.API_PORT,
                false,
                "udp"]
        }, apimanifest);
        break;

    default:
        return callback(error("nosuchmethod", 
                        "fathom.toolsapi.remoteapi."+method));
    }
};

/**
 * Executes the given socket request and calls back with the data or 
 * an object with error field with a short error message.
 */ 
 var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
        return callback(error("missingmethod"));

    if (req.submodule === 'iperf' || req.submodule === 'ping') {
        // implemented as a socketworker
        return socketapi.exec(callback, req, manifest);

    } else if (req.submodule === "remoteapi") {
        handleremoteapi(callback, req.method, req.params, manifest);

    } else {
        // utility methods
        switch (req.method) {
        case "isConnected":
            isConnected(callback);
            break;

        case "lookupMAC":
            lookupMAC(callback, (req.params ? req.params[0] : undefined));
            break;

        case "lookupIP":
            lookupIP(callback, (req.params ? req.params[0] : undefined));
            break;

        case "lookupUrl":
            lookupUrl(callback, (req.params ? req.params[0] : undefined));
            break;

        case "lookupHostname":
            lookupHostname(callback, (req.params ? req.params[0] : undefined));
            break;

        case "getCertChain":
            getCertChain(callback, (req.params ? req.params[0] : undefined));
            break;

        case "discovery":
            discovery(callback, req.params[0], req.params[1], manifest);
            break;

        default:
            return callback(error("nosuchmethod","fathom.toolsapi."+req.method));
        }
    }
};

/** Toolsapi calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};
