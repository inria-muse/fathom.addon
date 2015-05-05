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

const { all, defer, promised } = require('sdk/core/promise');
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;
const url = require("sdk/url");

const _ = require('underscore');

const {error, FathomException} = require("error");
const consts = require('consts');
const config = require('config');

const systemapi = require("systemapi");
const toolsapi = require("toolsapi");
const upload = require("upload");
const utils = require('utils');
const fathom = require('fathom');
const DB = require('baselinedb').DB;

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

var backgroundtimer = undefined; // baseline timer
var db = undefined;

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
var setup = exports.setup = function() {
};

/**
 * Cleanup the API component.
 */
var cleanup = exports.cleanup = function() {
    if (!db) {
        db = new DB();
    }
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
    db = new DB();
    ss.storage['baseline']['status'] = "starting";
    db.connect(function(res) {
        ss.storage['baseline']['db_version'] = db.version;
        if (res && res.error) {
            console.error("baseline failed to open db connection",res.error);
            ss.storage['baseline']['status'] = "db connect failed";
            backgroundtimer = undefined;
            db = undefined;
        } else {
            // schedule first run
            console.log("baseline connection");
            timers.setTimeout(backgroundsched, 0);
            ss.storage['baseline']['status'] = "started";
            reset_pageload_stats();
        }
    });
};

/**
 * Stop the API component.
 */
var stop = exports.stop = function() {
    if (backgroundtimer) { 
        timers.clearTimeout(backgroundtimer);
    }
    backgroundtimer = undefined;
    if (db) {
        db.close();
    }
    db = undefined;
    ss.storage['baseline']['status'] = "stopped";
};

/**
 * Executes the given API request and callback with the data or an object with
 * error field with a short error message. 
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!db) 
        return callback(error("internal","baseline database is not available"));
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

/* Function executed by the background measurement timer */
var backgroundtask = function() {
    if (!userPrefs[consts.BASELINE]) {  
        return;
    }

    var ts = new Date(); // milliseconds since epoch
    ss.storage['baseline']['last_sched_ts'] = ts;
    ss.storage['baseline']['scheduled'] += 1;
    ss.storage['baseline']['status'] = "running";

    // common round end routine
    var done = function(delay) {
        timers.setTimeout(backgroundsched, delay || 0);

        // check if we need to update the baseline aggregates
        // delays the first (potentially long) check to the 2nd
        // baseline run upon restarts which is good I guess ...
        if (!ss.storage['baseline']['last_agg_ts'])
            ss.storage['baseline']['last_agg_ts'] = ts;

        var timesincelast = ts.getTime() - 
            new Date(ss.storage['baseline']['last_agg_ts']).getTime();
        
        if (db && (timesincelast > config.BASELINE_INTERVALS[1]*1000)) {
            timers.setTimeout(function() {
                ss.storage['baseline']['last_agg_ts'] = ts;
                db.baselineAgg(ts.getTime());
            }, 200);
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
                done(100);

            } else if (baseline.latency < 
                       3*config.BASELINE_INTERVALS[0]*1000) {
                // ok
                current_baseline = baseline;
                if (db) db.saveBaseline(baseline);

                ss.storage['baseline']['saved'] += 1;
                ss.storage['baseline']['status'] = "last round ok";
                done(100);

                if (canUpload(consts.BASELINE_UPLOAD)) {
                    timers.setTimeout(
                    upload.addUploadItem,200,"baseline",baseline);
                }

            } else {
                // the measurements took too long .. 
                console.warn('baseline discard results (high latency)');
                ss.storage['baseline']['discarded'] += 1;
                ss.storage['baseline']['status'] = "last round discarded";
                done(100);
            }
        }, ts); // domeasurements

    } else {
        // skip this round
        ss.storage['baseline']['skipped'] += 1;
        ss.storage['baseline']['status'] = "last round skipped";
        done();
    }
};

/* Schedule next background measurement round */
var backgroundsched = function() {
    if (!userPrefs[consts.BASELINE]) {
        return;
    }

    // add some random +/- 20% secs to the timing
    var d = Math.round(config.BASELINE_INTERVALS[0] + 
                       (0.5 - Math.random())*0.2*config.BASELINE_INTERVALS[0]);

    ss.storage['baseline']['next_run_ts'] = new Date(Date.now() + d*1000);
    backgroundtimer = timers.setTimeout(backgroundtask, d*1000);
    console.log("baseline next run",ss.storage['baseline']['next_run_ts']);
};

/* Do a baseline measurement round */
var domeasurements = exports.domeasurements = function(cb, ts) {
    if (!ts) ts = new Date();

    var baseline = {
        ts : ts.getTime(),
        timezoneoffset : ts.getTimezoneOffset(),
        rtt : {}
    }

    // pageload average delays for the period
    baseline.pageload = _.clone(pageload_stats);
    if (baseline.pageload.total > 0)
        baseline.pageload.total_delay /= baseline.pageload.total;
    if (baseline.pageload.dns > 0)
        baseline.pageload.dns_delay /= baseline.pageload.dns;
    if (baseline.pageload.firstbyte > 0)
        baseline.pageload.firstbyte_delay /= baseline.pageload.firstbyte;
    
    reset_pageload_stats();

    // run all promised functions, fails if any of the funtions fails
    all([
        systemapi.execp({ method : 'doTraceroute', 
                          params: [config.MSERVER_FR, config.BASELINE_TR_OPTS]}),
        systemapi.execp({ method : 'doTraceroute', 
                          params: [config.BASELINE_HOST, config.BASELINE_TR_OPTS]}),
        systemapi.execp({ method : 'doPing', 
                          params: [config.MSERVER_FR, config.BASELINE_PING_OPTS]}),
        systemapi.execp({ method : 'doPing', 
                          params: [config.BASELINE_HOST, config.BASELINE_PING_OPTS]}),
        utils.makePromise(getnetworkenv),
        systemapi.execp({ method : 'getBrowserMemoryUsage'}),
        systemapi.execp({ method : 'getLoad'}),
        systemapi.execp({ method : 'getIfaceStats'}),
        systemapi.execp({ method : 'getWifiSignal'}),
        systemapi.execp({ method : 'doPing', 
                          params: ['127.0.0.1', config.BASELINE_PING_OPTS]}),
        systemapi.execp({ method : 'doPingToHop', 
                          params: [1, config.BASELINE_PING_OPTS]}),        
        systemapi.execp({ method : 'doPingToHop', 
                          params: [2, config.BASELINE_PING_OPTS]}),
        systemapi.execp({ method : 'doPingToHop', 
                          params: [3, config.BASELINE_PING_OPTS]})
    ]).then(function (results) {
        baseline.traceroute = results[0];
        baseline.traceroute_host = results[1];
        baseline.rtt.rttx = results[2]
        baseline.rtt.rtt_host = results[3]
        baseline.networkenv = results[4];
        baseline.ffmem = results[5];
        baseline.load = results[6];
        baseline.traffic = results[7];
        baseline.wifi = results[8];        
        baseline.rtt.rtt0 = results[9];
        baseline.rtt.rtt1 = results[10];
        baseline.rtt.rtt2 = results[11];
        baseline.rtt.rtt3 = results[12];
        cb(baseline);
    }, function err(reason) {
        cb({ error : reason});
    });
};

/** Current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var ts = new Date();

    // if was refreshed less than x sec ago (or last request was less than y sec ago)
    // return the current value (and avoid overhead of refreshing the env)
    if (current_env && ( 
            ((ts.getTime() - current_env.ts) < config.BASELINE_ENV_TTL*1000) ||
            ((ts.getTime() - last_env_req.getTime()) < config.BASELINE_ENV_ACTIVITY_TTL*1000)) ) 
    {
        // flag as being cached
        current_env.cached = true;
        current_env.cached_ts = current_env.ts;
        current_env.ts = ts.getTime();
        last_env_req = ts;
        return callback(current_env);
    }

    last_env_req = ts;

    all([
        systemapi.execp({ method : 'doPing', 
                  params: [config.MSERVER_FR, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 1 }]}),
        systemapi.execp({ method : 'doPing', 
                  params: [config.MSERVER_FR, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 2 }]}),
        systemapi.execp({ method : 'doPing', 
                  params: [config.MSERVER_FR, 
                       { count : 2, 
                         timeout : 1,
                         interval : 0.5,
                         ttl : 3 }]}),
        systemapi.execp({ method : 'getRoutingTable'}),
        systemapi.execp({ method : 'getInterfaces', params : [true]}),
        systemapi.execp({ method : 'getArpCache'}),
        systemapi.execp({ method : 'getWifiInterface'})
    
    ]).then(function(results) {
        // part of the values are measured everytime, 
        // rest is filled from the db (determined once per env)
        var env = {
            ts : ts.getTime(),      
            timezoneoffset : ts.getTimezoneOffset(),
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

        if (!results[3].error && results[3].result) {
            var r = results[3].result.defaultgateway || {};
            env.default_iface_name = r.iface || null;
            env.gateway_ip = r.gateway || null;
            // should be save to assume this if we don't know 1st hop already
            if (!env.hop1_ip)
                env.hop1_ip = env.gateway_ip;
        }

        if (!results[4].error && results[4].result &&
            env.default_iface_name!==null) 
        {
            let i = _.find(results[4].result, function(elem) {
                return (elem.name === env.default_iface_name);
            });

            if (i) {
                env.default_iface_mac =  i.mac;
                env.default_iface_ip =  i.ipv4;
            }
        }

        if (!results[5].error && results[5].result &&
            env.gateway_ip!=null) 
        {
            let i = _.find(results[5].result, function(elem) {
                return (elem.address === env.gateway_ip);
            });
            if (i) {
                env.gateway_mac =  i.mac;
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

        if (db) {
            // fill-in remaining values from the db 
            db.lookupEnv(env, function(finalenv) {
                current_env = finalenv;
                callback(finalenv);
            });
        } else {
            current_env = env;
            callback(env);
        }

    }, function(err) {
        // rejection handler
        callback(error("internal",err));
    });
};

/** Handle new pageload time report. */
var handlepageload = exports.handlepageload = function(p) {
    var ts = new Date();

    // stats
    if (!ss.storage['baseline']['pageload']) {
        ss.storage['baseline']['pageload'] = 0;
    }
    ss.storage['baseline']['pageload'] += 1;
    ss.storage['baseline']['pageload_ts'] = ts;

    // aggregate baseline stats about pageloads
    update_pageload_stats(p.performance);

    console.debug('baseline pageload',p.location);

    // TODO: check if the page is in users' top-k and store some 
    // local results about top-k browsing

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

        var whitelist = _.difference(config.ALEXA_TOP, ss.storage['blacklist'] || []);
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
    console.debug('baseline pageload final',p);

    if (canUpload(consts.PAGELOAD_UPLOAD)) {
        timers.setTimeout(upload.addUploadItem,100,"pageload",p);

        // run extra traceroute + ping towards whitelisted domains with some probability
        if (p.location.whitelisted && p.location.address && Math.random() < config.P_MEASURE) {
            console.log('baseline domainperf measurement to ' + p.location.address);
            all([
                systemapi.execp({ method : 'doPing', 
                                  params: [p.location.address, config.BASELINE_PING_OPTS]}),
                systemapi.execp({ method : 'doTraceroute', 
                                  params: [p.location.address, config.BASELINE_TR_OPTS]})
            ]).then(function (results) {
                var obj = {
                    ts : p.ts,
                    timezoneoffset : p.timezoneoffset,
                    pageid : p.pageid,
                    location : p.location,
                    ping : results[0],
                    traceroute : results[1]
                };
                timers.setTimeout(upload.addUploadItem,100,"domainperf",obj);

            }, function(err) {
               console.warn("baseline domainperf measurement failed",err);
            });
        }
    } // else can't upload
};