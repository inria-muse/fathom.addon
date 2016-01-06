/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
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
const db = require('./db');
const env = require('./env');

// db handler
var dbi = db.getInstance();

// keep pointers to the last measurement values to provide quick access to examples
var current_baseline = undefined;
var current_pageload = undefined;

/**
 * Initialize the API component.
 */
var setup = exports.setup = function() {
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
};

/**
 * Cleanup the API component.
 */
var cleanup = exports.cleanup = function() {
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
    ss.storage['baseline']['db_version'] = dbi.version;
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
        // TODO: this is not a real fathom API method .. maybe remove and just
        // expose via exports directly for internal use ?
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

        if (range === 'latest') {
            // return the last cached measurement result
            switch (metric) {
                case 'env':
                    env.getnetworkenv(callback);
                    break;
                case 'traffic':
                case 'mem':
                case 'rtt':
                case 'wifi':                    
                    callback((current_baseline ? current_baseline[metric] : undefined));
                    break;
                case 'cpu':
                case 'load':
                case 'tasks':
                    callback((current_baseline ? current_baseline['load'] : undefined));
                    break;
                default:
                    callback(error("invalidparams", "metric=" + metric));
            }
        } else {
            if (metric === 'env') {
                dbi.getEnvRange(range, callback);
            } else {
                dbi.getBaselineRange(metric, range, callback);
            }
        }
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

/* Measurement timer */
var backgroundtimer = undefined;

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
            dbi.baselineAgg(ts.getTime());
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
                dbi.saveBaseline(baseline);

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

    // run every freq rounds (for traceroute)
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

    // condition check for dns measurements
    var dnsexec = function() {
        if (cfg['baseline']['dnsreq_enable']) {
            var whitelist = cfg['pageload']['whitelist'];
            var idx = Math.floor(Math.random() * whitelist.length);
            var name = whitelist[idx].replace('.*','.com'); // there's few wild-card domains !

            return toolsapi.execp({ 
                method : 'dnsLookup', 
                params: [name] 
            });
        } else {
            // just returns a promise that will resolve to simple error obj
            var e = { error : 'dnsreq_enable=false' };
            return resolve(e).then(function(value) {
              return value;
            });
        }
    };

    env.getnetworkenv(function(env) {
        // run all promised functions, fails if any of the funtions fails
        baseline.networkenv = env;
        all([
            condexec({ method : 'doTraceroute', 
                       params: [env.mserver_ip, cfg['baseline']['tr_opts']]},
                     cfg['baseline']['tr_freq']),
            systemapi.execp({ method : 'doPing', 
                              params: [env.mserver_ip, cfg['baseline']['ping_opts']]}),
            systemapi.execp({ method : 'getBrowserMemoryUsage'}),
            systemapi.execp({ method : 'getLoad'}),
            systemapi.execp({ method : 'getMemInfo'}),
            systemapi.execp({ method : 'getIfaceStats'}),
            systemapi.execp({ method : 'getWifiSignal'}),
            systemapi.execp({ method : 'doPing', 
                              params: ['127.0.0.1', cfg['baseline']['ping_opts']]}),
            systemapi.execp({ method : 'doPingToHop', 
                              params: [1, cfg['baseline']['ping_opts'], env.mserver_ip]}),        
            systemapi.execp({ method : 'doPingToHop', 
                              params: [2, cfg['baseline']['ping_opts'], env.mserver_ip]}),
            systemapi.execp({ method : 'doPingToHop', 
                              params: [3, cfg['baseline']['ping_opts'], env.mserver_ip]}),
            dnsexec()
        ]).then(function (results) {
            let idx = 0;
            baseline.traceroute = results[idx++];
            baseline.rtt.rttx = results[idx++]
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
    });
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

    // currently allowed domains (blacklist is the user prefs)
    var whitelist = _.difference(cfg['whitelist'], ss.storage['blacklist'] || []);

    // adds IP address and anonymized non-whitelisted urls
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
        try {
            let u = new url.URL(res.name);
            res.protocol = u.protocol.replace(':','');
            res.location = {
                host : u.host,
                origin : u.origin,
                name : u.pathname
            };
            delete res.name;
            res.location = updatelocation(res.location);
        } catch (err) {
            // could not parse url, just hash the name anyways so we don't leek anything .. ?
            console.warn("baseline pageload prob with resource url: " + res.name, err);
            res.name = utils.getHash(res.name, ss.storage['salt']);
        }
    });

    // store for raw data reqs
    current_pageload = p;

    if (canUpload(consts.PAGELOAD_UPLOAD)) {
        // resolve current env
        env.getnetworkenv(function(env) {
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