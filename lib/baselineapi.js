/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.baseline API.
 *
 * This module collects background measurements and provides an access
 * to historical data for webpages for a baseline performance data.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");

var dnsservice = Cc["@mozilla.org/network/dns-service;1"]
    .createInstance(Ci.nsIDNSService);
const flags = Ci.nsIDNSService.RESOLVE_DISABLE_IPV6 | 
    Ci.nsIDNSService.RESOLVE_CANONICAL_NAME;

const { all, defer, promised, resolve } = require('sdk/core/promise');
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;
const url = require("sdk/url");

const _ = require('underscore');

const {error, FathomException} = require("./error");
const consts = require('./consts');
const config = require('./config');

const systemapi = require("./systemapi");
const toolsapi = require("./toolsapi");
const upload = require("./upload");
const utils = require('./utils');
const fathom = require('./fathom');
const DB = require('./baselinedb').DB;

// make sure the module stat counters are initialized
if (!ss.storage['baseline']) {
    ss.storage['baseline'] = {
        'db_version' : 0,
        'scheduled' : 0,  // number of timer expires
        'skipped' : 0,    // skipped due to user activity
        'run' : 0,        // runs
        'discarded' : 0,  // results discarded
        'failed' : 0,     // run failure
        'saved' : 0,      // saved to db
        'pageload' : 0,   // pageloads handled
        'pageload_ts' : 0 // last pageload ts
    }
}

// measurement timer
var backgroundtimer = undefined; // baseline timer

// db handler
var db = new DB();
db.connect(function(res) {
    ss.storage['baseline']['db_version'] = db.version;
    if (res && res.error) {
        console.error("baseline failed to open db connection",res.error);
        ss.storage['baseline']['status'] = "db connect failed";
    } else {
        // schedule first run
        console.log("baseline db connected");
        ss.storage['baseline']['status'] = "connected";
    }
});

// keep pointers to the last measurement values
var current_env = undefined;
var current_baseline = undefined;
var current_pageload = undefined;
var last_env_req = new Date();

// baseline period stats for pageloads
var pageload_stats = {
    total : 0,
    dns : 0,
    firstbyte : 0,
    total_delay : 0.0,
    dns_delay : 0.0,
    firstbyte_delay : 0.0
}

var update_pageload_stats = function(p) {
    if (p.timing.loadEventEnd>0 && 
        (p.timing.loadEventEnd - p.timing.navigationStart) <= 0) {
        return; // did not load completely ? ignore for now
    }   

    // total pageload time
    pageload_stats.total += 1;
    pageload_stats.total_delay += (p.timing.loadEventEnd - p.timing.navigationStart);

    // dns req
    var dns = p.timing.domainLookupEnd - p.timing.domainLookupStart;
    if (dns > 0 && p.timing.domainLookupStart !== p.timing.fetchStart) {
        pageload_stats.dns += 1;
        pageload_stats.dns_delay += dns;
    } // else == 0 probably got from cache

    // time to first byte
    if ((p.timing.responseStart - p.timing.requestStart) > 0 &&
        (p.timing.responseStart - p.timing.navigationStart) > 0) {
        pageload_stats.firstbyte += 1;
        pageload_stats.firstbyte_delay += (p.timing.responseStart - p.timing.navigationStart);
    } // else == 0 probably got from cache
};

var reset_pageload_stats = function() {
    pageload_stats = {
        total : 0,
        dns : 0,
        firstbyte : 0,
        total_delay : 0.0,
        dns_delay : 0.0,
        firstbyte_delay : 0.0
    }
};

/**
 * Initialize the API component.
 */
var setup = exports.setup = function() {};

/**
 * Cleanup the API component.
 */
var cleanup = exports.cleanup = function() {
    // disconnect and remove the db
    db.close();
    db.cleanup();
    db = undefined;
    if (ss.storage['baseline']) {
        delete ss.storage['baseline'];
    }
};

/**
 * Start the API component.
 */
var start = exports.start = function() {
    if (!userPrefs[consts.BASELINE]) {
        ss.storage['baseline']['status'] = "disabled by the user";
        return;
    }    
    timers.setTimeout(function() { backgroundsched(); }, 0);
    ss.storage['baseline']['status'] = "started";
};

/**
 * Stop the API component.
 */
var stop = exports.stop = function() {
    if (backgroundtimer) { 
        timers.clearTimeout(backgroundtimer);
    }
    backgroundtimer = undefined;
    ss.storage['baseline']['status'] = "stopped";
};

/**
 * Executes the given API request and callback with the data or an object with
 * error field with a short error message. 
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method)
        return callback(error("missingmethod"));

    switch (req.method) {
    case 'getjson':
        // get latest raw json data
        var metric = (req.params ? req.params[0] : undefined);
        if (!metric)
            return callback(error("missingparams", "metric"));

        switch (metric) {
        case 'baseline':
            callback(current_baseline);
            break;
        case 'pageload':
            callback(current_pageload);
            break;
        case 'env':
            callback(current_env);
            break;
        default:
           callback(error("invalidparams", "metric=" + metric));
        }
        break;

    case 'get':
        // get selected range of values for metric
        var metric = (req.params ? req.params[0] : undefined);
        if (!metric)
            return callback(error("missingparams", "metric"));

        var range = (req.params ? req.params[1] : undefined);
        if (!range)
            return callback(error("missingparams", "range"));

        if (metric === 'env') {
            db.getEnvRange(range, callback);
        } else {
            db.getBaselineRange(metric, range, callback);
        }
        break;
    
    case 'setenvlabel':
        // save user label for environment
        var envid = (req.params ? req.params[0] : undefined);
        if (!envid)
            return callback(error("missingparams", "envid"));

        var label = (req.params ? req.params[1] : undefined);
        if (!label)
            return callback(error("missingparams", "label"));

        db.updateEnvUserLabel(envid, label, callback);
        break;

    default:
        return callback(error("nosuchmethod", req.method));
    }    
}; // exec

/** Exec calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};

/* Uploading allowed by the user ? */
var canUpload = function(what) {
    return (userPrefs[what] === consts.UPLOAD_ALWAYS);
};

/* Schedule next background measurement round */
var backgroundsched = function() {
    if (!userPrefs[consts.BASELINE]) {
        ss.storage['baseline']['status'] = "disabled by the user";
        return;
    }

    var cfg = config.get('baseline');

    // interval +/- rand seconds
    var d = Math.round(cfg['intervals'][0] + (Math.random()*2.0*cfg['rand']-cfg['rand']));

    backgroundtimer = timers.setTimeout(function() { backgroundtask(); }, d*1000);

    ss.storage['baseline']['next_run_ts'] = new Date(Date.now() + d*1000);
    console.log("baseline next run",ss.storage['baseline']['next_run_ts']);
};

/* Function executed by the background measurement timer */
var backgroundtask = function() {
    if (!userPrefs[consts.BASELINE]) {  
        ss.storage['baseline']['status'] = "disabled by the user";
        return;
    }

    var ts = new Date(); // milliseconds since epoch
    ss.storage['baseline']['last_sched_ts'] = ts;
    ss.storage['baseline']['scheduled'] += 1;
    ss.storage['baseline']['status'] = "running";

    var cfg = config.get('baseline');

    // schedule next immediately so even if something goes wrong with the
    // measurements, this gets done
    backgroundsched();

    // common round end routine
    var done = function() {
        // check if we need to update the baseline aggregates
        // delays the first (potentially long) check to the 2nd
        // baseline run upon restarts which is good I guess ...
        if (!ss.storage['baseline']['last_agg_ts'])
            ss.storage['baseline']['last_agg_ts'] = ts;

        var timesincelast = ts.getTime() - 
            new Date(ss.storage['baseline']['last_agg_ts']).getTime();
        
        if (timesincelast > cfg['intervals'][1]*1000) {
            ss.storage['baseline']['last_agg_ts'] = ts;
            db.baselineAgg(ts.getTime());
        }
    };

    if (fathom.allowBackgroundTask()) {
        ss.storage['baseline']['run'] += 1;
        ss.storage['baseline']['last_run_ts'] = ts;

        domeasurements(function(baseline) {
            baseline.latency = Date.now() - ts.getTime();
            console.debug(baseline);
            
            if (baseline.error) {
                // baselines failed ...
                ss.storage['baseline']['failed'] += 1;
                ss.storage['baseline']['status'] = "error: " + 
                    baseline.error;
                done();

            } else if (baseline.latency < 3*cfg['intervals'][0]*1000) {
                // ok
                current_baseline = baseline;
                db.saveBaseline(baseline);

                ss.storage['baseline']['saved'] += 1;
                ss.storage['baseline']['status'] = "last round ok";
                done();

                if (canUpload(consts.BASELINE_UPLOAD)) {
                    upload.addUploadItem("baseline", baseline);
                }

            } else {
                // the measurements took too long .. 
                console.warn('baseline discard results (high latency)');
                ss.storage['baseline']['discarded'] += 1;
                ss.storage['baseline']['status'] = "last round discarded";
                done();
            }
        }, ts, ss.storage['baseline']['scheduled']); // domeasurements

    } else {
        // skip this round
        ss.storage['baseline']['skipped'] += 1;
        ss.storage['baseline']['status'] = "last round skipped";
        done();
    }
};

/* Do a baseline measurement round */
var domeasurements = exports.domeasurements = function(cb, ts, runid) {
    if (!ts) ts = new Date();

    var cfg = config.get();    

    var baseline = {
        ts : ts.getTime(),
        timezoneoffset : ts.getTimezoneOffset(),
        runid : runid,
        config_version : cfg['config']['version'],
        rtt : {}
    };

    // pageload average delays for the period
    baseline.pageload = _.clone(pageload_stats);
    if (baseline.pageload.total > 0)
        baseline.pageload.total_delay /= baseline.pageload.total;
    if (baseline.pageload.dns > 0)
        baseline.pageload.dns_delay /= baseline.pageload.dns;
    if (baseline.pageload.firstbyte > 0)
        baseline.pageload.firstbyte_delay /= baseline.pageload.firstbyte;
    
    reset_pageload_stats();

    // for the dnsLookup test, pick a random domain from the whitelist (avoid hitting the cache)
    var getRandomName = function() {
        var whitelist = cfg['pageload']['whitelist'];
        var idx = Math.floor(Math.random() * whitelist.length);
        return whitelist[idx].replace('.*','.com'); // there's few wild-card domains !
    };

    // run every freq rounds
    var condexec = function(mcfg, freq) {
        if ((runid-1)%freq === 0) {
            return systemapi.execp(mcfg);
        } else {
            // just returns a promise that will resolve to simple error obj
            mcfg.error = 'skipped (freq=' + freq + ')';
            return resolve(mcfg).then(function(value) {
              return value;
            });
        }
    };

    // run all promised functions, fails if any of the funtions fails
    all([
        condexec({ method : 'doTraceroute', 
                   params: [cfg['mserver']['ipv4'], cfg['baseline']['tr_opts']]},
                 cfg['baseline']['tr_freq']),
        systemapi.execp({ method : 'doPing', 
                          params: [cfg['mserver']['ipv4'], cfg['baseline']['ping_opts']]}),
        getnetworkenvp(),
        systemapi.execp({ method : 'getBrowserMemoryUsage'}),
        systemapi.execp({ method : 'getLoad'}),
        systemapi.execp({ method : 'getMemInfo'}),
        systemapi.execp({ method : 'getIfaceStats'}),
        systemapi.execp({ method : 'getWifiSignal'}),
        systemapi.execp({ method : 'doPing', 
                          params: ['127.0.0.1', cfg['baseline']['ping_opts']]}),
        systemapi.execp({ method : 'doPingToHop', 
                          params: [1, cfg['baseline']['ping_opts']]}),        
        systemapi.execp({ method : 'doPingToHop', 
                          params: [2, cfg['baseline']['ping_opts']]}),
        systemapi.execp({ method : 'doPingToHop', 
                          params: [3, cfg['baseline']['ping_opts']]}),
        toolsapi.execp({ method : 'dnsLookup', 
                         params: [getRandomName()] })
    ]).then(function (results) {
        let idx = 0;
        baseline.traceroute = results[idx++];
        baseline.rtt.rttx = results[idx++]
        baseline.networkenv = results[idx++];
        baseline.ffmem = results[idx++];
        baseline.load = results[idx++];
        baseline.mem = results[idx++];
        baseline.traffic = results[idx++];
        baseline.wifi = results[idx++];        
        baseline.rtt.rtt0 = results[idx++];
        baseline.rtt.rtt1 = results[idx++];
        baseline.rtt.rtt2 = results[idx++];
        baseline.rtt.rtt3 = results[idx++];
        baseline.dns = results[idx++];

        cb(baseline);
        
    }).then(null, function err(reason) {
        // catch all errors
        cb({ error : reason});
    });
};

/** Current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var ts = new Date();

    var cfg = config.get('environment');    
    var mserver = config.get('mserver',  'ipv4');   

    // if was refreshed less than x sec ago (or last request was less than y sec ago)
    // return the current value (and avoid overhead of refreshing the env)
    if (current_env && ( 
            ((ts.getTime() - current_env.lookup_ts) < cfg['ttl']*1000) ||
            ((ts.getTime() - last_env_req.getTime()) < cfg['activity_ttl']*1000)) ) 
    {
        // flag as being cached
        current_env.cached = true;
        current_env.cached_ts = current_env.ts;
        current_env.ts = ts.getTime();
        last_env_req = ts;
        return callback(current_env);

    } else if (current_env && ((ts.getTime() - current_env.lookup_ts) >= cfg['max_ttl']*1000)) {
        // invalidate so that we refresh the full info
        current_env = undefined;
    }

    last_env_req = ts;

    all([
        systemapi.execp({ method : 'doPing', 
                  params: [mserver, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 1 }]}),
        systemapi.execp({ method : 'doPing', 
                  params: [mserver, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 2 }]}),
        systemapi.execp({ method : 'doPing', 
                  params: [mserver, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 3 }]}),
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
            env_id : null,        // from db 
            public_ip : null,     // from db
            country : null,       // from db
            city : null,          // from db
            isp : null,           // from db
            net_desc : null,      // from db
            as_number : null,     // from db
            as_desc : null,       // from db
            lookup_ts : null,     // from db
            first_seen_ts : null, // from db
            userlabel : null      // from db
        };

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

        // routing table
        if (!results[3].error && results[3].result) {
            var r = results[3].result.defaultgateway || {};
            env.default_iface_name = r.iface || null;
            env.gateway_ip = r.gateway || null;
            // should be save to assume this if we don't know 1st hop already
            if (!env.hop1_ip)
                env.hop1_ip = env.gateway_ip || null;
        }

        // get interfaces
        if (!results[4].error && results[4].result &&
            env.default_iface_name!==null) 
        {
            let i = _.find(results[4].result, function(elem) {
                return (elem.name === env.default_iface_name);
            });

            if (i) {
                env.default_iface_mac =  i.mac || null;
                env.default_iface_ip =  i.ipv4 || null;
            }
        }

        // arp cache
        if (!results[5].error && results[5].result &&
            env.gateway_ip!=null) 
        {
            let i = _.find(results[5].result, function(elem) {
                return (elem.address === env.gateway_ip);
            });
            if (i) {
                env.gateway_mac =  i.mac || null;
            }
        }

        if (!results[6].error && results[6].result && results[6].result.connected && 
            results[6].result.name == env.default_iface_name) {
            // default interface is wireless
            if (results[6].result.ssid)
                env.ssid = results[6].result.ssid;
            if (results[6].result.ssid)
                env.bssid = results[6].result.bssid;
        }

        // check if we have changed environment (env !== current_env) since the last time
        if (!current_env ||
            env.ssid !== current_env.ssid ||
            env.default_iface_name !== current_env.default_iface_name ||
            env.default_iface_mac !== current_env.default_iface_mac ||
            env.gateway_ip !== current_env.gateway_ip ||
            env.gateway_mac !== env.gateway_mac) 
        {
            // looks like we changed networks or info is stale -- refresh public IP etc.
            toolsapi.exec(function(ipres) {
                if (ipres && !ipres.error && ipres.result) {
                    env.lookup_ts = env.ts;
                    env.public_ip = ipres.ip;

                    if (ipres.result.geo) {
                        env.country = ipres.result.geo.country;
                        env.city = ipres.result.geo.city;
                        env.isp = ipres.result.geo.isp;
                    }

                    if (ipres.result.whois) {
                        env.net_desc =
                            ((ipres.result.whois.netblock && 
                              ipres.result.whois.netblock.descr) ? 
                            ipres.result.whois.netblock.descr.split(';')[0] : 
                            null);

                        env.as_number = (ipres.result.whois.asblock ? 
                           ipres.result.whois.asblock.origin : null);

                        env.as_desc = 
                            ((ipres.result.whois.asblock && 
                              ipres.result.whois.asblock.descr) ? 
                            ipres.result.whois.asblock.descr.split(';')[0] : 
                            null);
                    }

                    db.updateEnv(env, function(finalenv) {
                        current_env = finalenv;
                        callback(current_env);
                    });
                } else {
                    current_env = env;
                    callback(current_env);
                }
            }, { method : 'lookupIP'}); // lookupIP
        } else {
            // fill-in remaining values from the db 
            db.lookupEnv(env, function(finalenv) {
                current_env = finalenv;
                callback(current_env);
            });
        }
    }).then(null, function(err) {
        // catch all errors
        callback(error("internal",err));
    });
};

/** Env promise */
var getnetworkenvp = exports.getnetworkenvp = function() {
    return utils.makePromise(getnetworkenv);
};

/** Handle new pageload time report. */
var handlepageload = exports.handlepageload = function(p) {
    if (!userPrefs[consts.PAGELOAD]) {  
        return;
    }

    var ts = new Date();
    var cfg = config.get('pageload');

    // stats
    if (!ss.storage['baseline']['pageload']) {
        ss.storage['baseline']['pageload'] = 0;
    }
    ss.storage['baseline']['pageload'] += 1;
    ss.storage['baseline']['pageload_ts'] = ts;

    // aggregate baseline stats about pageloads
    update_pageload_stats(p.performance);

    console.debug('baseline pageload',p.location);

    var updatelocation = function(loc) {
        try {
            // this should be instant as the IP is cached by the browser        
            var r = dnsservice.resolve(loc.host, flags);
            if (r.hasMore()) {
                loc.address = dnsservice.resolve(loc.host, flags).getNextAddrAsString();
            }
        } catch (e) {
            // not found ?!
        }

        var whitelist = _.difference(cfg['whitelist'], ss.storage['blacklist'] || []);
        var whitelisted = _.find(whitelist, function(h) {
            var re = new RegExp(h + '$', 'i');
            return (loc.host.search(re)>=0);
        });

        if (!whitelisted) {
              // anonymize all page location related info
            _.each(loc, function(v,k) {
                loc[k] = utils.getHash(v, ss.storage['salt']);
            });
        }
        loc.whitelisted = (whitelisted && true);
        return loc;
    };
    p.location = updatelocation(p.location);

    // just keep the basic location info and anonymize if need
    _.each(p.performance.resourcetiming, function(res) {
        let u = new url.URL(res.name);
        res.protocol = u.protocol.replace(':','');
        res.location = {
            host : u.host,
            origin : u.origin,
            name : u.pathname
        };
        delete res.name;
        res.location = updatelocation(res.location);
    });

    // store for raw data reqs
    current_pageload = p;

    if (canUpload(consts.PAGELOAD_UPLOAD)) {
        // resolve current env
        getnetworkenv(function(env) {
            p.networkenv = env;
            console.debug('baseline pageload',p);
            timers.setTimeout(function() { upload.addUploadItem("pageload",p); },100);

            // run extra traceroute + ping towards whitelisted domains with some probability
            if (cfg['perf']['enable'] && p.location.whitelisted && p.location.address && Math.random() < cfg['perf']['p_ping']) {
                console.log('baseline domainperf measurement to ' + p.location.address);

                // ping always
                var mlist = [systemapi.execp({ method : 'doPing', 
                             params: [p.location.address, cfg['perf']['ping_opts']]})];

                var trcfg = { method : 'doTraceroute', 
                              params: [p.location.address, cfg['perf']['tr_opts']] };

                // even lower propa for traceroute 
                if (Math.random() < cfg['perf']['p_tr']) {
                    mlist.push(systemapi.execp(trcfg));
                } else {
                    trcfg.error = 'skipped';
                    mlist.push(resolve(trcfg).then(function(value) {
                      return value;
                    }));
                }

                all(mlist).then(function (results) {
                    var obj = {
                        ts : p.ts,
                        timezoneoffset : p.timezoneoffset,
                        networkenv : env,
                        pageid : p.pageid,
                        location : p.location,
                        ping : results[0],
                        traceroute : results[1]
                    };

                    console.debug('baseline domainperf',obj);
                    timers.setTimeout(function() { upload.addUploadItem("domainperf",obj); },100);

                }, function(err) {
                   console.warn("baseline domainperf measurement failed",err);
                });
            } // domainperf
        }); // getnetworkenv
    } // else can't upload
};