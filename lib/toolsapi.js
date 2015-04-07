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

/** Lookup current public IP. */
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

/** This node descriptor. */
var getdesc = exports.getdesc = function(callback) {
    var ts = new Date();
    var res = {
        "ts" : ts.getTime(),
        "timezoneoffset" : ts.getTimezoneOffset(),

        "fathom_node_id" : ss.storage["public_uuid"],
        "fathom_version" : self.version,

        "system" : {
            "platform" : system.platform,
            "architecture" : system.architecture,
            "platform_version" : system.platform_version,
            "name" : system.name,
            "vendor" : system.vendor,
            "version" : system.version
        },

        "hostname" : undefined,
        "interfaces" : undefined,
        "networkenv" : undefined
    };

    baselineapi.getnetworkenv(function(env) {
        if (!env.error)
            res.networkenv = env;
        systemapi.exec(function(hostname) {
            if (!hostname.error)
                res.hostname = hostname.result;
            systemapi.exec(function(ifaces) {
                if (!ifaces.error)
                    res.interfaces = ifaces.result;
                return callback(res);
            },{ method : 'getInterfaces', params : [true]});
        },{ method : 'getHostname'});
    });
};

/** Network neighborhood discovery using selected protocols.  */
var discovery = exports.discovery = function(callback, timeout, protocols, manifest) {
    if (!protocols) {
        protocols = ['local','route','internet','upnp','mdns','fathom','ping']; 
    }

    // common result node format
    var Node = function(type, rpc, reach, ipv4, ipv6, r) {
        this.type = type;       // type: local | peer | gw | internet
        this.rpc = rpc;         // fathom APIs available
        this.reachable = reach; // reachable (ping)
        this.ipv4 = ipv4;       // ipv4
        this.ipv6 = ipv6;       // ipv4
        this.raw = {};          // the raw discovery data (variable / proto)
        if (r && r.proto)
            this.raw[r.proto] = r;
    };

    // last callback with done=true (all others will send done=false)
    if (!timeout)
        timeout = 10;
    timers.setTimeout(callback, timeout*1000+500, {}, true);

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

    _.each(protocols, function(p) {
        switch (p) {
        case "local":
            // this node
            getdesc(function(n) {
                var defiface = (n.interfaces ? _.find(
                    n.interfaces, function(iface) {
                        return (iface.name === n.networkenv.default_iface_name);
                    }) : undefined);
                n.proto = 'local';

                var node = new Node(
                    'local',
                    (apiserver!==undefined),
                    true,
                    (defiface ? defiface.ipv4 : "127.0.0.1"),
                    (defiface ? defiface.ipv6 : undefined), 
                    n);
                addnode(undefined, node);
            });
            break;

        case "route":
            // get active interfaces
            systemapi.exec(function(ifaces) {
                if (ifaces.error || ifaces.result.length <= 0)
                    return;
                ifaces = ifaces.result;

                // get routes
                systemapi.exec(function(routes) {
                    if (routes.error || routes.result.routes.length <= 0)
                        return;

                    // return default gateway of each interface
                    var rifaces = _.groupBy(routes.result.routes, 'iface');

                    _.each(rifaces, function(routes, name) {
                        var raw = {                    
                            proto : 'route',
                            ifacename : name,
                            iface : _.find(ifaces, function(iface) { return (iface.name === name); }),
                            defaultroutes : _.filter(routes, function(r) { return r.defaultroute; }),
                            allroutes : routes
                        };

                        if (raw.defaultroutes.length === 0 || !raw.iface) {
                            return;
                        }

                        var ipv4 = _.find(_.pluck(raw.defaultroutes, 'gateway'), utils.isValidIPv4);
                        var ipv6 = _.find(_.pluck(raw.defaultroutes, 'gateway'), utils.isValidIPv6);

                        // could not find gateway IP (should not really happen ?)
                        if (!ipv4 && !ipv6) {
                            console.warn('toolsapi gateway ip not found', raw);
                            return;
                        }

                        var node = new Node(
                            'gw',
                            false,
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
                                  count : 2, 
                                  timeout : Math.min(5,timeout/2), 
                                  interval : 0.5,
                                  iface : ((utils.isWin() || utils.isDarwin()) ?  
                                            (raw.iface.ipv4!==undefined ? raw.iface.ipv4 : raw.iface.ipv6) : 
                                            raw.iface.name)
                               }]
                            });

                        },{ method : 'doPing', 
                            params : [(ipv4!==undefined ? ipv4 : ipv6), {
                                count : 2, 
                                timeout : Math.min(2,timeout/2), 
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
                false,
                config.MSERVER_FR, // use some fixed address that will not appear as other node's address
                undefined,
                undefined);

            systemapi.exec(function(res) {
                if (!res.error && res.result.rtt.length > 0) {
                    node.reachable = true;
                    lookupIP(function(res) {
                        if (!res.error) {
                            // public IP + API server available
                            node.rpc = true;
                            res.proto = 'internet';
                            node.raw['internet'] = res;
                        }
                        addnode(undefined, node);
                    });
                } else {
                    // internet not available but send the node anyways
                    addnode(undefined, node);
                }
            }, {method : 'doPing', 
                params : [config.MSERVER_FR, {
                          count : 2, 
                          timeout : Math.min(5,timeout/2), 
                          interval : 0.5
                       }]
                }
            );
            break;

        case "mdns":
            protoapi.exec(function(id) {
                protoapi.exec(function(dev, doneflag) {
                    if (dev.address) {
                        var node = new Node(
                            (dev.isgw ? 'gw' : 'peer'),
                            dev.isfathom,
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
                            false,
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

        case "fathom":
            handleremoteapi(function(n) {
                if (n.address) {
                    n.proto = 'fathom';
                    var node = new Node(
                        'peer',
                        true,
                        true,
                        n.address,
                        undefined,
                        n);         
                    addnode('localnet', node);
                }
            }, "discovery", [timeout], apimanifest);
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
                                        false, // rpc
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
        }
    });
}; // discovery

// JSONRPC server instances - only one of each is running per extension
// process 
// TODO: what if running multiple browser windows ? now just reuse sock ..
var discoveryserver = undefined;
var apiserver = undefined;
var startstopcache = {};

// Incoming Fathom discovery request response handler
var replysearch = function(desc) {
    return function(req) {
        req.result = desc;
        protoapi.exec(function(res) {
            if (res.error)
                console.warn("toolsapi sendres failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [discoveryserver,req]
        }, apimanifest);
    };
};

// Incoming Fathom API request response handler
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
            if (res.error)
                console.warn("toolsapi reply failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [apiserver,req,'invalidreq']
        }, apimanifest);
    }

    var cb = function(res,done) {
        req.result = res;
        protoapi.exec(function(res) {
            if (res.error)
                console.warn("toolsapi reply failed",res);
        }, {module : "proto", 
            submodule: "jsonrpc", 
            method : 'sendres', 
            params : [apiserver,req,res.error]
        }, apimanifest);
    };

    // FIXME: all remoteapi calls get elevated addonpage privileges
    // to any API... is there anyway to authenticate the client
    // and to make sure the client side user has given permission
    // to access the requested methods (see checks in makereq) ?

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
            if (res.error)
                console.warn("toolsapi reply failed",res);
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
            getdesc(function(mydesc) {      
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
                        protoapi.exec(replysearch(mydesc), {    
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
            }); // getdesc
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

            getdesc(function(mydesc) {      
                protoapi.exec(function(res, done) {
                    if (!res.error && res.address) {
                        console.info("fathom found new device "+res.address);
                        manifest.neighbors['fathom'][res.address] = true;

                        callback({
                            address : res.address,
                            descriptor : res.result,
                            proto : 'fathom'
                        }, false);
                        res = {}
                    }

                    if (done) {
                        callback(res,done);
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
                        mydesc,     // params
                        undefined,  // module
                        undefined,  // urlparams
                        timeout]    // timeout
                }, apimanifest);
            }); // getdesc
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

        case "getDesc":
            getdesc(callback);
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
