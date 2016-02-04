/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Network environment handling.
 *
 * The module caches the current environment info so we don't keep resolving
 * the details all the time. The full info (ip lookup, mserver + first three hops) 
 * is done periodically and/or when re-connecting to a network env. 
 * 
 * The caching and lookups are managed by the following configs (fathom.json):
 *  
 *  "environment" : {
 *      "inactivity_ttl_sec"   : 5,           // required api inactivity before lookup (avoid many lookups during burst of activity)
 *      "local_lookup_ttl_sec" : 300,         // local lookup ttl (seconds)
 *      "full_lookup_ttl_days" : 5            // full lookup ttl (days)
 *  },
 *
 * The full network environment object has the following info:
 *
 *    {
 *       "ts": 1448982561480,                        // local lookup ts
 *       "timezoneoffset": -60,                      // browser timezone
 *       "timezoneoffsethours": "+0100",
 *       "timezonename": "CET",
 *       "default_iface_name": "eth0",               // current local default iface
 *       "default_iface_ip": "128.93.62.39",         
 *       "default_iface_mac": "4c:72:b9:27:28:ea",
 *       "gateway_ip": "128.93.1.100",               // default gateway
 *       "gateway_mac": "00:10:db:ff:28:00",
 *       "ssid": null,                               // wifi network
 *       "bssid": null,
 *       "hop1_ip": "128.93.1.100",                  // 1st IP hop
 *       "hop2_ip": "192.93.1.105",
 *       "hop3_ip": "193.51.184.178",
 *       "public_ip": "128.93.62.39",                // external IP
 *       "country": "FR",                            // location info based on public IP
 *       "city": "Le Chesnay",
 *       "isp": "FR-INRIA-ROCQ Institut National de Recherche en Informatique,FR",
 *       "net_desc": "FR-INRIA-ROCQ Institut National de Recherche en Informatique,FR",
 *       "as_desc": "FR-INRIA-ROCQ Institut National de Recherche en Informatique,FR",
 *       "as_number": 775,
 *       "lookup_ts": 1448982561480,                 // location info lookup ts
 *       "mserver_ip": "80.239.168.203",             // MLAB server
 *       "mserver_city": "Paris",
 *       "mserver_country": "FR",
 *       "first_seen_ts": null,                      // local db insert ts
 *       "env_id": null,                             // local db id
 *       "userlabel": null                           // user given name for this env
 *   }
 *
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const { all, defer, promised, resolve } = require('sdk/core/promise');

const _ = require('underscore');

const {error, FathomException} = require("./error");
const config = require('./config');
const utils = require('./utils');
const db = require('./db');
const systemapi = require("./systemapi");
const toolsapi = require("./toolsapi");

// config keys
const INACTIVITY_TTL_SEC = 'inactivity_ttl_sec';
const LOCAL_LOOKUP_TTL_SEC = 'local_lookup_ttl_sec';
const FULL_LOOKUP_TTL_DAYS = 'full_lookup_ttl_days';

/** Set userlabel for a given environment. */
var setenvlabel = exports.setenvlabel = function(callback, req) {
    var envid = (req.params ? req.params[0] : undefined);
    if (!envid)
        return callback(error("missingparams", "envid"));

    var label = (req.params ? req.params[1] : undefined);
    if (!label)
        return callback(error("missingparams", "label"));

    db.getInstance().updateEnvUserLabel(envid, label, callback);
};

/** Lookup local info (network config + update with db data if available). */
var getenvlocal = exports.getenvlocal = function(callback, ts) {
    if (!ts)
        ts = new Date();

    all([
        systemapi.execp({ method : 'getRoutingTable'}),
        systemapi.execp({ method : 'getInterfaces', params : [true]}),
        systemapi.execp({ method : 'getArpCache'}),
        systemapi.execp({ method : 'getWifiInterface'})

    ]).then(function(results) {
        // more info on the current timezone to make data handling easier ..
        var tzinfo = ts.toString().match(/([-\+][0-9]+)\s\(([A-Za-z\s].*)\)/);
        if (!tzinfo)
            tzinfo = ts.toString().match(/([-\+][0-9]+)/);

        var env = {
            ts : ts.getTime(),      
            timezoneoffset : ts.getTimezoneOffset(),
            timezoneoffsethours : (tzinfo && tzinfo.length > 0 ? tzinfo[1] : null),
            timezonename : (tzinfo && tzinfo.length > 1 ? tzinfo[2] : null),
            default_iface_name : null,
            default_iface_ip : null,
            default_iface_mac : null,
            gateway_ip : null,
            gateway_mac : null,
            ssid : null,
            bssid : null,
            hop1_ip : null,
            hop2_ip : null,
            hop3_ip : null,
            public_ip : null,
            country : null,  
            city : null,     
            isp : null,      
            net_desc : null, 
            as_desc : null,  
            as_number : null,   
            lookup_ts : null,    
            mserver_ip : null,  
            mserver_city : null,
            mserver_country : null,
            env_id : null,        
            first_seen_ts : null,
            userlabel : null  
        };

        // routing table
        if (!results[0].error && results[0].result) {
            var r = results[0].result.defaultgateway || {};
            env.default_iface_name = r.iface || null;
            env.gateway_ip = r.gateway || null;
            env.hop1_ip = env.gateway_ip || null;
        }

        // get interfaces
        if (!results[1].error && results[1].result &&
            env.default_iface_name!==null) 
        {
            let i = _.find(results[1].result, function(elem) {
                return (elem.name === env.default_iface_name);
            });

            if (i) {
                env.default_iface_mac =  i.mac || null;
                env.default_iface_ip =  i.ipv4 || null;
            }
        }

        // arp cache
        if (!results[2].error && results[2].result &&
            env.gateway_ip!=null) 
        {
            let i = _.find(results[2].result, function(elem) {
                return (elem.address === env.gateway_ip);
            });
            if (i) {
                env.gateway_mac =  i.mac || null;
            }
        }

        if (!results[3].error && results[3].result && results[3].result.connected && 
            results[3].result.name == env.default_iface_name) {
            // default interface is wireless
            if (results[3].result.ssid)
                env.ssid = results[3].result.ssid;
            if (results[3].result.ssid)
                env.bssid = results[3].result.bssid;
        }

        // fill-in remaining values from the db (or insert if never seen before)
        db.getInstance().lookupEnv(env, callback);

    }).then(null, function(err) {
        // catch all errors
        callback(error("internal",err));
    });
}

/** Lookup full info (local + public IP + mserver + first hops). */
var getenvfull = exports.getenvfull = function(callback, ts, localenv) {
    if (!ts)
        ts = new Date();

    var f = function(env) {
        env.lookup_ts = ts.getTime();

        utils.lookupIP(function(ip) {
            if (!ip || ip.error) {
                console.warn("env failed to lookup public ip",ip);
                ip = '0.0.0.0';
            }

            env.public_ip = ip;

            toolsapi.getMlabServer(function(sres) {
                if (!sres.error && sres.ip && sres.ip.length > 0) { 
                    // closest MLAB server
                    env.mserver_ip = sres['ip'][0];
                    env.mserver_city = sres['city'];
                    env.mserver_country = sres['country'];
                } else {
                    // fallback to our server
                    env.mserver_ip = config.get('api', 'ipv4');
                    env.mserver_city = config.get('api', 'city');
                    env.mserver_country = config.get('api', 'country');
                }

                all([
                    systemapi.execp({ method : 'doPing', 
                              params: [env.mserver_ip, 
                                   { count : 2, 
                                     timeout : 1,
                                     interval : 0.5,
                                     ttl : 1 }]}),
                    systemapi.execp({ method : 'doPing', 
                              params: [env.mserver_ip, 
                                   { count : 2, 
                                     timeout : 1,
                                     interval : 0.5,
                                     ttl : 2 }]}),
                    systemapi.execp({ method : 'doPing', 
                              params: [env.mserver_ip, 
                                   { count : 2, 
                                     timeout : 1,
                                     interval : 0.5,
                                     ttl : 3 }]}),
                    utils.getIpInfoP(env.public_ip)

                ]).then(function(results) {
                    // 1st hop IP
                    var p = results[0];
                    if (!p.error && p.result && p.result.time_exceeded_from) {
                        env.hop1_ip = p.result.time_exceeded_from;
                    }

                    // 2nd hop IP
                    p = results[1];
                    if (!p.error && p.result && p.result.time_exceeded_from) {
                        env.hop2_ip = p.result.time_exceeded_from;
                    }

                    // 3rd hop IP
                    p = results[2];
                    if (!p.error && p.result && p.result.time_exceeded_from) {
                        env.hop3_ip = p.result.time_exceeded_from;
                    } else if (!p.error && p.result && p.result.rtt.length>0) {
                        // reached the dst in three hops
                        env.hop3_ip = p.result.dst_ip;
                    }

                    // IP info
                    var info = results[3];
                    if (!info.error) {
                        if (info.geoloc && !info.geoloc.error && info.geoloc.locations.length > 0) {
                            env.country = info.geoloc.locations[0].country;
                            env.city = info.geoloc.locations[0].city;
                        }

                        if (info['prefix-overview'] && !info['prefix-overview'].error && info['prefix-overview'].asns.length > 0) {
                            env.as_number = info['prefix-overview'].asns[0].asn;
                            // FIXME: the RIPE lookup does not provide all these fields but keeping
                            // them here now for backwards compat ... could/should be removed.
                            env.as_desc = info['prefix-overview'].asns[0].holder;
                            env.isp = info['prefix-overview'].asns[0].holder;
                            env.net_desc = info['prefix-overview'].asns[0].holder;
                        }
                    }

                    // update env in db and return
                    db.getInstance().updateEnv(env, callback);

                }).then(null, function(err) {
                    // catch all errors
                    callback(error("internal",err));
                });
            });  // mlab
        });    // lookupIP        
    }

    if (!localenv) {
        getenvlocal(f, ts);
    } else {
        f(localenv);
    } 
};

// cache the last resolved env
var current_env = undefined;
var last_env_req = undefined;

/** Return the latest network environment. */
var getcurrent = exports.getcurrent = function() {
    last_env_req = new Date();
    return current_env;
};

/** Resolve the current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var cfg = config.get('environment');    
    var ts = new Date();

    // reset cache flag
    if (current_env)
        current_env.cached = false;

    if (!current_env) {
        // 1) if no current_env do local lookup - we're starting
        console.debug('resolve env for first time');
        getenvfull(function(env) {            
            last_env_req = ts;
            current_env = env;
            return callback(current_env);
        }, ts);

    } else if ((ts.getTime() - last_env_req.getTime()) <= cfg[INACTIVITY_TTL_SEC]*1000 ) {
        // 2) if there's a lot of activity, just return the last known
        console.debug('resolve env returning cached');
        last_env_req = ts;
        current_env.cached = true;
        return callback(current_env);

    } else if ( (!current_env.public_ip || current_env.public_ip === '0.0.0.0') &&
                (!current_env.lookup_ts || (ts.getTime() - current_env.lookup_ts) > cfg[LOCAL_LOOKUP_TTL_SEC]*1000)) 
    {
        // 3) public IP not yet known, keep trying (but not too often)
        getenvfull(function(env) {
            current_env = env;
            last_env_req = ts;
            return callback(current_env);
        }, ts, current_env);

    } else if ( (ts.getTime() - current_env.ts) <= cfg[LOCAL_LOOKUP_TTL_SEC]*1000 ) {
        // 4) current env is complete and not old, return cached
        console.debug('resolve env returning cached');
        last_env_req = ts;
        current_env.cached = true;
        return callback(current_env);

    } else {
        // 5) local info is stale, resolve again
        console.debug('resolve env update local');
        getenvlocal(function(env) {            
            if (!env.public_ip || env.public_ip === '0.0.0.0' ||
                ( (ts.getTime() - env.lookup_ts) > cfg[FULL_LOOKUP_TTL_DAYS]*24*3600*1000 ) ||
                env.ssid !== current_env.ssid ||
                env.default_iface_name !== current_env.default_iface_name ||
                env.default_iface_mac !== current_env.default_iface_mac ||
                env.gateway_ip !== current_env.gateway_ip ||
                env.gateway_mac !== env.gateway_mac ) 
            {
                // 6) full info missing, is old or re-connected to a different env
                console.debug('resolve env update full');
                getenvfull(function(env) {
                    current_env = env;
                    last_env_req = ts;
                    return callback(current_env);
                }, ts, env);

            } else {   
                // 7) no need to do full lookup
                current_env = env;
                last_env_req = ts;
                return callback(current_env);
            }
        }, ts);
    }
};

/** Env promise */
var getnetworkenvp = exports.getnetworkenvp = function() {
    return utils.makePromise(getnetworkenv);
};