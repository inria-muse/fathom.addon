1/*
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

const _ = require('underscore');

const {error, FathomException} = require("error");
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
	'scheduled' : 0,  // number of timer expires
	'skipped' : 0,    // skipped due to user activity
	'run' : 0,        // runs
	'discarded' : 0,  // results discarded
	'failed' : 0,     // run failure
	'saved' : 0,      // saved to db
	'pageload' : 0,  // pageloads handled
	'pageload_ts' : 0 // last pageload ts
    }
}

var backgroundtimer = undefined; // baseline timer
var db = undefined;

// keep pointers to the last measurement values
var current_env = undefined;
var current_baseline = undefined;
var current_pageload = undefined;

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
	(p.timing.loadEventEnd - p.timing.navigationStart) <= 0)
	return; // did not load completely ? ignore for now

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
	(p.timing.responseStart - p.timing.navigationStart) > 0) 
    {
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
    if (!db)
	db = new DB();
    db.cleanup();
    db = undefined;
    if (ss.storage['baseline'])
	delete ss.storage['baseline'];
};

/**
 * Start the API component.
 */
var start = exports.start = function() {
    db = new DB();
    db.connect(function(res) {
	if (res && res.error) {
	    console.error("baseline failed to open db connection",res.error);
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
    if (backgroundtimer) timers.clearTimeout(backgroundtimer);
    backgroundtimer = undefined;
    if (db) db.close();
    db = undefined;
    ss.storage['baseline']['status'] = "stopped";
};

/**
 * Executes the given API request and callback with the data or an object with
 * error field with a short error message. 
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!db) callback(error("internal","baseline database is not available"));

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
	if (!req.method)
	    return callback(error("missingmethod"));
	else
	    return callback(error("nosuchmethod", req.method));
    }
}; // exec

/** Exec calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};

var canUpload = function(what) {
    return (userPrefs[what] === config.UPLOAD_ALWAYS);
};

/* Function executed by the background measurement timer */
var backgroundtask = function() {
    if (!userPrefs[config.BASELINE]) {	
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
		db.baselineAgg(ts);
	    }, 400);
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

		// all ok, save and queue for upload
		current_baseline = baseline;
		if (db) db.saveBaseline(baseline);

		ss.storage['baseline']['saved'] += 1;
		ss.storage['baseline']['status'] = "last round ok";
		done(100);

		if (canUpload(config.BASELINE_UPLOAD)) {
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
	}, ts);
    } else {
	// skip this round
	ss.storage['baseline']['skipped'] += 1;
	ss.storage['baseline']['status'] = "last round skipped";
	done();
    }
};

/* Schedule next background measurement round */
var backgroundsched = function() {
    if (!userPrefs[config.BASELINE]) {
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
	timezoneoffset : ts.getTimezoneOffset()
    }

    // pageload stats for the period
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
			  params: [config.MSERVER_FR, 
				   { count : 3, 
				     waittime : 2 
				   }]}),
	systemapi.execp({ method : 'doPing', 
			  params: [config.MSERVER_FR, 
				   { count : 5, 
				     timeout : 2,
				     interval : 0.5 
				   }]}),
	utils.makePromise(getnetworkenv),
	systemapi.execp({ method : 'getBrowserMemoryUsage'}),
	systemapi.execp({ method : 'getLoad'}),
	systemapi.execp({ method : 'getIfaceStats'}),
	systemapi.execp({ method : 'getWifiSignal'})
	
    ]).then(function (results) {
	baseline.traceroute = results[0];
	baseline.rtt = { rttx : results[1] };
	baseline.networkenv = results[2];
	baseline.ffmem = results[3];
	baseline.load = results[4];
	baseline.traffic = results[5];
	baseline.wifi = results[6];

	var nop = function() {
	    var deferred = defer();
	    deferred.resolve(error(undefined,"IP undefined"));
	    return deferred.promise;
	};

	var plist = [];
	if (baseline.networkenv.hop1_ip != null) {
	    plist.push(systemapi.execp({ method : 'doPing', 
					 params: [baseline.networkenv.hop1_ip, 
						  { count : 5, 
						    interval : 0.5,
						    timeout : 1
						  }]
				       }));
	} else { 
	    plist.push(nop()); 
	}

	if (baseline.networkenv.hop2_ip != null) {
	    plist.push(systemapi.execp({ method : 'doPing', 
					 params: [baseline.networkenv.hop2_ip, 
						  { count : 5, 
						    interval : 0.5,
						    timeout : 1
						  }]
				       }));
	} else { 
	    plist.push(nop()); 
	}

	if (baseline.networkenv.hop3_ip != null) {
	    plist.push(systemapi.execp({ method : 'doPing', 
					 params: [baseline.networkenv.hop3_ip, 
						  { count : 5, 
						    interval : 0.5,
						    timeout : 1
						  }]
				       }));
	} else { 
	    plist.push(nop()); 
	}

	all(plist).then(function(results) {
	    baseline.rtt.rtt1 = results[0];		
	    baseline.rtt.rtt2 = results[1];
	    baseline.rtt.rtt3 = results[2];
	    cb(baseline);
	}, function err(reason) {
	    cb({ error : reason});
	});
    }, function err(reason) {
	cb({ error : reason});
    });
};

/** Current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var ts = new Date();

    // FIXME: pick a good delay, tradeoff accuracy in env detection
    // avoid some overhead, and resolve at most once every x seconds
    if (current_env && ((ts.getTime() - current_env.ts) < 15*1000)) 
    {
	// flag as being cached
	current_env.cached = true;
	current_env.cached_ts = current_env.ts;
	current_env.ts = ts.getTime();
	return callback(current_env);
    }

    all([
	systemapi.execp({ method : 'doPing', 
			  params: [config.MSERVER_FR, 
				   { count : 2, 
				     timeout : 1,
				     interval : 0.3,
				     ttl : 1 }]}),
	systemapi.execp({ method : 'doPing', 
			  params: [config.MSERVER_FR, 
				   { count : 2, 
				     timeout : 1,
				     interval : 0.3,
				     ttl : 2 }]}),
	systemapi.execp({ method : 'doPing', 
			  params: [config.MSERVER_FR, 
				   { count : 2, 
				     timeout : 1,
				     interval : 0.3,
				     ttl : 3 }]}),
	systemapi.execp({ method : 'getRoutingTable'}),
	systemapi.execp({ method : 'getActiveInterfaces'}),
	systemapi.execp({ method : 'getArpCache'}),
	systemapi.execp({ method : 'getActiveWifiInterface'})
	
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
	    var r = results[3].result.defaultroute || {};
	    env.default_iface_name = r.iface || null;
	    env.gateway_ip = r.gateway || null;
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
	    if (i)
		env.gateway_mac =  i.mac;
	}

	if (!results[6].error && results[6].result && results[6].result.ssid) {
	    env.ssid = results[6].result.ssid;
	}
	if (!results[6].error && results[6].result && results[6].result.bssid) {
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
    if (!userPrefs[config.PAGELOAD]) {	
	return;
    }

    // stats
    if (!ss.storage['baseline']['pageload'])
	ss.storage['baseline']['pageload'] = 0;
    ss.storage['baseline']['pageload'] += 1;
    ss.storage['baseline']['pageload_ts'] = ts;

    // aggregate baseline stats about pageloads
    if (userPrefs[config.BASELINE]) {	
	update_pageload_stats(p.performance);
    }

    // TODO: check if the page is in users' top-k and store some 
    // local results about top-k browsing

    // check if the domain is whitelisted
    var blacklist = ss.storage['blacklist'] || [];
    var match = undefined;
    if (p.location && p.location.host) {
	// this should be instant as the IP is cached by the browser
	var r = dnsservice.resolve(p.location.host, flags);
	if (r.hasMore()) {
	    p.location.address = dnsservice.resolve(
		p.location.host, flags).getNextAddrAsString();
	}

	match = _.find(config.ALEXA_TOP, function(h) {
            var re = new RegExp(h, 'i');
	    return (!_.contains(blacklist, h) &&
                    p.location.host.search(re)>=0);
	});
    }

    if (!match) {
	// anonymize all page location related info
	_.each(p.location, function(v,k) {
	    p.location[k] = utils.getHash(v, ss.storage['salt']);
	});
	p.location.anonymized = true;

    } else if (Math.random() < config.P_MEASURE && 
	       canUpload(config.PAGELOAD_UPLOAD)) 
    {
	// run extra traceroute + ping towards the domain
	all([systemapi.execp({ method : 'doPing', 
			       params: [p.location.address, 
					{ count : 10, 
					  timeout : 3,
					  interval : 0.5 
					}]}),
	     systemapi.execp({ method : 'doTraceroute', 
			       params: [p.location.address, 
					{ count : 3, 
					  waittime : 3 
					}]})
	    ]).then(function (results) {
		var obj = {
		    ts : p.ts,
		    timezoneoffset : p.timezoneoffset,
		    pageid : p.pageid,
		    location : p.location,
		    ping : results[0],
		    traceroute : results[1]
		};

		if (canUpload(config.PAGELOAD_UPLOAD)) {
		    timers.setTimeout(
			upload.addUploadItem,100,"domainperf",obj);
		} // else uploads not allowed

	    }, function(err) {
		console.warn("baseline page measurement failed",err);
	    });
    }

    // p is anonymized, store an example and upload if allowed
    current_pageload = p;
    if (canUpload(config.PAGELOAD_UPLOAD)) {
	timers.setTimeout(upload.addUploadItem,100,"pageload",p);
    } // else uploads not allowed
};
