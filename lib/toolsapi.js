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

/** Helper method on top of Fathom socket and proto APIs to do a DNS lookup of hostname. */
var dnsLookup = exports.dnsLookup = function(callback, hostname, server, port) {
    if (!hostname)
        return callback(error("missingparams", "hostname"));    
    port = port || 53;

    var reqid = 1;
    var _resolve = function(cb, s, proto) {
        console.debug('tools resolve ' + hostname + ' from ' + proto + '://' + s + ':' + port);
        protoapi.exec(function(res) {
            if (res.error) {
                console.debug('tools dnsLookup dns.create fails',res);
                cb(res);
                return;
            }

            var ts = Date.now();
            protoapi.exec(function(lres) {
                var d = Date.now() - ts;
                if (!lres.error) {
                    // add some metadata on success
                    lres.server = s;
                    lres.port = port;
                    lres.proto = proto;
                    lres.ts = ts;
                    lres.duration = d;
                } else {
                    console.debug('tools dnsLookup dns.lookup fails',lres);
                }
                cb(lres);

            }, { module : 'proto',
                 submodule : 'dns',
                 method : 'lookup',
                 params : [res, hostname, 5],
                 id : reqid++ 
            }, apimanifest);

        }, { module : 'proto',
             submodule : 'dns',
             method : 'create',
             params : [s, proto, port],
             id : reqid++ 
        }, apimanifest);        
    };

    var resolve = function(servers, errors) {
        if (!servers || servers.length === 0) {
            // not found or fails, just return empty list (or error list if contains failures fails)
            callback({answers : [], error : (errors.length > 0 ? errors : undefined)});   
            return;
        }

        var s = servers.shift(); 
        if (!s) {
            // not found or fails, just return empty list (or error list if contains failures fails)
            callback({answers : [], error : (errors.length > 0 ? errors : undefined)});   
            return;
        }

        // start with udp dns req
        _resolve(function(res1) {
            if (res1.answers) {
                callback(res1);
                return;
            }

            if (res1.error)
                errors.push(res1);

            // fallback to tcp
            _resolve(function(res2) {
                if (res2.answers) {
                    callback(res2);
                    return;
                }
                if (res2.error)
                    errors.push(res2);

                // try with remaining servers (if any)
                resolve(servers, errors);

            }, s, 'tcp');
        }, s, 'udp');
    };

    if (server) {
        // use the requested server
        resolve([server],[]);
    } else {
        // get local DNS server config using system API
        systemapi.exec(function(res, doneflag) {
            if (!res.error && res.result && res.result.nameservers && res.result.nameservers.length > 0) {
                console.debug('tools dns lookup will try', res.result.nameservers);
                resolve(res.result.nameservers,[]);
            } else if (res.error) {
                callback(res)
            } else {
                callback({ error : "no nameservers found"})                
            }
        }, { module : 'system',
             method : 'getNameservers'});
    }
}

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
            if (response.status == 200 && !response.error) {
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
        url:  config.API_URL+"/fulllookup" + (ip ? "/"+ip : ""),
        onComplete: function(response) {
            if (response.status == 200 && !response.error) {
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

/** Network neighborhood discovery using selected protocols.  */
var discovery = exports.discovery = function(callback, protocols, timeout, manifest) {
    if (!protocols) {
        protocols = ['local','route','internet','upnp','mdns','ping', 'arptable']; 
    }
    timeout = timeout || 10;

    // backup timer for stop signal if something fails bad - should not happen
    var bkptimer = timers.setTimeout(function() {
        // FIXME: ping & arptable relies on this timer for now
        if (!_.contains(protocols, 'ping') && !_.contains(protocols, 'arptable')) {
            console.warn('tools discovery hit the backup timer, stopping the search');
        }
        timers.setTimeout(callback, 0, undefined, true);
    }, (timeout+3)*1000);

    // common result node format
    var Node = function(type, reach, ipv4, ipv6, r) {
        this.type = type;       // type: local | peer | gw | internet
        this.reachable = reach; // reachable (ping)
        this.ipv4 = ipv4;       // ipv4
        this.ipv6 = ipv6;       // ipv6
        this.raw = {};          // the raw discovery data (variable / proto)
        if (r && r.proto)
            this.raw[r.proto] = r;
    };

    // done flags
    alldone = {}
    _.each(protocols, function(p) { alldone[p] = false; });

    // handle a new node (can be null if just need to signal allfound)
    var addnode = function(proto, node, pflag) {
        // map discovery proto to manifest destinations
        if (node && node.reachable) {
            if (_.contains(['route','arptable','ping','mdns','upnp'],proto)) {
                let neighp = 'localnet';
                if (!manifest.neighbors[neighp])
                    manifest.neighbors[neighp] = {};
                if (node.ipv4)
                    manifest.neighbors[neighp][node.ipv4] = true;
                if (node.ipv6)
                    manifest.neighbors[neighp][node.ipv6] = true;
            }
            if (_.contains(['mdns','upnp'],proto)) {
                let neighp = proto;
                if (!manifest.neighbors[neighp])
                    manifest.neighbors[neighp] = {};
                if (node.ipv4)
                    manifest.neighbors[neighp][node.ipv4] = true;
                if (node.ipv6)
                    manifest.neighbors[neighp][node.ipv6] = true;
            }
        }

        // update flags
        alldone[proto] = pflag;
        var dflag = _.every(_.values(alldone));
        if (!node && dflag) {
            if (bkptimer)
                timers.clearTimeout(bkptimer);
            timers.setTimeout(callback, 0, undefined, true); // signal all done
        } else if (node) {
            if (dflag && bkptimer)
                timers.clearTimeout(bkptimer);
            timers.setTimeout(callback, 0, node, dflag); // send node + done flag
        }
    };

    _.each(protocols, function(p) {
        switch (p) {
        case "local":
            // discover local node
            var raw = { proto : p};
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
                            p,
                            true, // reachable
                            (defiface ? defiface.ipv4 : "127.0.0.1"),
                            (defiface ? defiface.ipv6 : undefined), 
                            raw);

                        // one and only local node
                        addnode(p, node, true);

                    },{ method : 'getInterfaces', params : [true]});
                },{ method : 'getHostname'});
            });
            break;

        case "internet":
            lookupIP(function(res) {
                if (res && !res.error) {
                    res.proto = p;
                    var node = new Node(
                        p,
                        true, // reachable
                        config.MSERVER_FR, // use some fixed address that will not appear as other node's address
                        undefined,
                        res);
                    addnode(p, node, true);
                    return;                    
                }

                // try again to see if we are connected (API server failure ?)
                isConnected(function(c) {
                    var node = new Node(
                        p,
                        c, // reachable
                        config.MSERVER_FR, // use some fixed address that will not appear as other node's address
                        undefined,
                        undefined);
                    addnode(p, node, true);
                });

            }); // lookupIP
            break;

        case "route":
            // discover gateway(s) based on routing table
            systemapi.exec(function(ifaces) {
                if (ifaces.error || ifaces.result.length <= 0) {
                    addnode(p, undefined, true);
                    return;
                }
                ifaces = ifaces.result;

                // get routes
                systemapi.exec(function(routes) {
                    if (routes.error || routes.result.routes.length <= 0){
                        addnode(p, undefined, true);
                        return;
                    }

                    // routes on each interface
                    var rifaces = _.groupBy(routes.result.routes, 'iface');
                    if (_.size(rifaces) === 0) {
                        addnode(p, undefined, true);
                        return;                        
                    }

                    var getnode = function(name, routes) {
                        var raw = {                    
                            proto : p,
                            ifacename : null,
                            iface : null,
                            routes : routes
                        };

                        // get more info about the interface
                        if (utils.isWin()) {
                            // win route returns the interface ip
                            raw.iface = _.find(ifaces, function(iface) { 
                                return (iface.ipv4 === name || iface.ipv6 === name); 
                            });
                            if (raw.iface)
                                raw.ifacename = raw.iface.name;
                        } else {
                            raw.ifacename = name;
                            raw.iface = _.find(ifaces, function(iface) { return (iface.name === name); });
                        }
                        if (!raw.iface) {
                            return undefined;
                        }

                        var ipv4 = _.find(_.pluck(raw.routes, 'gateway'), utils.isValidIPv4unicast);
                        var ipv6 = _.find(_.pluck(raw.routes, 'gateway'), utils.isValidIPv6unicast);
                        if (!ipv4 && !ipv6) {
                            return undefined;
                        }

                        return new Node(
                            'gw',
                            false,
                            ipv4,
                            ipv6,
                            raw);
                    }

                    var acnt = 0;
                    var cnt = 0;
                    for (var i = 0; i < _.size(rifaces); i++) {
                        let name  = _.keys(rifaces)[i];
                        let node = getnode(name, rifaces[name])
                        if (!node)
                            continue;

                        acnt += 1; // count as good

                        // check gw reach
                        systemapi.exec(function(res) {
                            node.reachable = (!res.error && res.result.rtt.length > 0);

                            // check internet reach via this gw
                            systemapi.exec(function(res2) {
                                node.internet_reachable = (!res2.error && res2.result.rtt.length > 0);
                                node.reachable = node.reachable || node.internet_reachable;
                                cnt += 1;
                                addnode(p, node, (cnt === acnt));

                            }, {method : 'doPing', 
                                params : [config.MSERVER_FR, {
                                  count : 3, 
                                  timeout : timeout, 
                                  interval : 0.5,
                                  iface : ((utils.isWin() || utils.isDarwin()) ?  
                                            (node.raw['route'].iface.ipv4!==undefined ? node.raw['route'].iface.ipv4 : node.raw['route'].iface.ipv6) : 
                                            node.raw['route'].iface.name)
                               }]
                            });

                        }, { method : 'doPing', 
                             params : [(node.ipv4!==undefined ? node.ipv4 : node.ipv6), {
                                count : 3, 
                                timeout : 1, 
                                interval : 0.5
                            }]
                        });
                    } // for                    

                    // found no valid gateways, stop here
                    if (acnt == 0) addnode(p, undefined, true); // signal done 

                }, { method : 'getRoutingTable'});
            }, { method : 'getInterfaces', params : [true]});
            break;

        case "mdns":
        case "upnp":
            protoapi.exec(function(id) {
                protoapi.exec(function(dev, doneflag) {
                    if (doneflag) {
                        protoapi.exec(function() {}, { 
                            module : "proto", 
                            submodule: p, 
                            method : 'close',                             
                            params : [id]}, apimanifest);
                    }
                    var node = undefined;
                    if (dev.address) {
                        node = new Node(
                            (dev.isgw ? 'gw' : 'peer'),
                            true,
                            dev.address,
                            undefined,
                            dev);
                    }
                    addnode(p, node, doneflag);

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
                if (ifaces.error || ifaces.result.length === 0) {
                    addnode(p,undefined,true); // signal done
                    return;
                }

                // send bcast ping on each local net interface
                var acnt = 0;
                for (var i = 0; i < _.size(ifaces.result); i++) {
                    let iface = ifaces.result[i];
                    if (iface.type === 'loopback' || 
                        !iface.broadcast || 
                        iface.broadcast.indexOf('169.') == 0) 
                    {
                        continue;
                    }

                    acnt += 1; // new async call
                    systemapi.exec(function(res, doneflag) {
                        if (res.error || !res.result.alt || _.size(res.result.alt)==0) {                            
                            return;
                        }
                        _.each(res.result.alt, function(r) {
                            if (r.address) {
                                r.proto = p;
                                r.srciface = iface;
                                var node = new Node(
                                    'peer',
                                    true,  // reach
                                    (utils.isValidIPv4(r.address) ? r.address : undefined),
                                    (utils.isValidIPv6(r.address) ? r.address : undefined),
                                    r);
                                // FIXME: no explicit signaling on the last node, relies on the
                                // general timeout set in the beg. of the function
                                addnode(p, node, false);
                            }
                        }); // foreach

                    }, {method : 'doPing', 
                        params: [iface.broadcast, { 
                           count : 2,
                           interval : Math.min(timeout/2,1),
                           timeout : timeout,
                           bcast : true}]
                    });
                }; // foreach ifaces

                // found no valid interfaces
                if (acnt == 0) addnode(p, undefined, true); // signal done 

            }, { method : 'getInterfaces', params : [true]});
            break;

        case "arptable":
            systemapi.exec(function(res) {
                if (res.error || res.result.length === 0) {
                    addnode(p, undefined, true);
                    return;
                }

                var acnt = 0;
                for (var i = 0; i < _.size(res.result); i++) {
                    let raw = res.result[i];
                    if (!utils.isValidIPv4unicast(raw.address)) {
                        continue;
                    }
                    acnt += 1;

                    // ok, valid unicast, check reachability and report
                    systemapi.exec(function(pres) {
                        // only report nodes that we can reach (others may be stale entries etc. )
                        if (!pres.error && pres.result.rtt.length > 0) {                            
                            lookupMAC(function(lookupres) {
                                raw.proto = p;
                                if (lookupres && !lookupres.error) {
                                    raw.devinfo = lookupres;
                                }

                                var node = new Node(
                                    'peer',
                                    true,
                                    raw.address,
                                    undefined,
                                    raw);

                                // FIXME: no explicit signaling on the last node, relies on the
                                // general timeout set in the beg. of the function
                                addnode(p, node, false);

                            }, raw.mac);
                        }
                    },{ method : 'doPing', 
                        params : [raw.address, {
                            count : 3, 
                            timeout : 1, 
                            interval : 0.5
                        }]
                    });   
                }; // foreach

                // found no valid IPs
                if (acnt == 0) addnode(p, undefined, true); // signal done 

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
        // remote API stuff
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

        case "dnsLookup":
            dnsLookup(callback, 
                      (req.params ? req.params[0] : undefined), 
                      (req.params ? req.params[1] : undefined), 
                      (req.params ? req.params[2] : undefined));
            break;

        case "discovery":
            discovery(callback, req.params[0], req.params[1], manifest);
            break;

        default:
            return callback(error("nosuchmethod","fathom.tools."+req.method));
        }
    }
};

/** Toolsapi calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};
