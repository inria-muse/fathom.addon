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

const _ = require('underscore');

const {error, FathomException} = require("error");
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

// keep a pointer to the last known network environment
var current_env = undefined;

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
	if (res.error) {
	    console.error("baseline failed to open db connection",res.error);
	    backgroundtimer = undefined;
	    db = undefined;
	} else {
	    // schedule first run
	    timers.setTimeout(backgroundsched, 0);
	    ss.storage['baseline']['status'] = "started";
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
	
    case 'setUserlabel':
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

    if (fathom.allowBackgroundTask()) {
	domeasurements(function(baseline) {
	    baseline.latency = Date.now() - ts.getTime();
	    timers.setTimeout(backgroundsched, 100);

	    if (baseline.error) {
		// baselines failed ...
		console.debug("baseline error",baseline);
		ss.storage['baseline']['failed'] += 1;
		ss.storage['baseline']['status'] = "error: " + 
		    baseline.error;

	    } else if (baseline.latency < 
		       3*config.BASELINE_INTERVALS[0]*1000) {
		// all ok, save and queue for upload
		if (db) db.saveBaseline(baseline);
		ss.storage['baseline']['saved'] += 1;
		ss.storage['baseline']['status'] = "last round ok";
		if (canUpload(config.BASELINE_UPLOAD)) {
		    timers.setTimeout(
			upload.addUploadItem,200,"baseline",baseline);
		}

	    } else {
		// the measurements took too long .. 
		console.debug('baseline discard results (high latency)',
			      baseline);
		ss.storage['baseline']['discarded'] += 1;
		ss.storage['baseline']['status'] = "last round discarded";
	    }
	}, ts);
    } else {
	// skip this round
	ss.storage['baseline']['skipped'] += 1;
	ss.storage['baseline']['status'] = "last round skipped";
	timers.setTimeout(backgroundsched, 0);
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
};

/* Do a baseline measurement round */
var domeasurements = exports.domeasurements = function(cb, ts) {
    if (!ts) ts = new Date();
    var baseline = {
	ts : ts.getTime(),
	timezoneoffset : ts.getTimezoneOffset() 
    }

    ss.storage['baseline']['run'] += 1;
    ss.storage['baseline']['last_run_ts'] = ts;

    // run all promised functions, fails if any of the funtions fails
    all([
	utils.makePromise(getnetworkenv),
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
	systemapi.execp({ method : 'getBrowserMemoryUsage'}),
	systemapi.execp({ method : 'getLoad'}),
	systemapi.execp({ method : 'getIfaceStats'}),
	systemapi.execp({ method : 'getWifiSignal'}),
	
    ]).then(function (results) {
	// success function
	baseline.networkenv = results[0];
	baseline.traceroute = results[1];
	baseline.rtt = { rttx : results[2] };
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
	}, function error(reason) {
	    cb({ error : reason});
	});
    }, function error(reason) {
	cb({ error : reason});
    });
};

/** Current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var ts = new Date();

    // FIXME: pick a good delay, tradeoff accuracy in env detection
    // avoid some overhead, and resolve at most once every 60s
    if (current_env && current_env.ts &&
	((ts.getTime() - current_env.ts) < 60*1000)) 
    {
	// flag as being cached
	current_env.cached = true;
	current_env.cached_ts = current_env.ts;
	current_env.ts = ts.getTime();
	return callback(current_env);
    }

    all([
	systemapi.execp({ method : 'getRoutingTable'}),
	systemapi.execp({ method : 'getActiveInterfaces'}),
	systemapi.execp({ method : 'getArpCache'}),
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

	// success function
	if (!results[0].error && results[0].result) {
	    var r = results[0].result.defaultroute || {};
	    env.default_iface_name = r.iface || null;
	    env.gateway_ip = r.gateway || null;
	}

	if (!results[1].error && results[1].result &&
	    env.default_iface_name!==null) 
	{
	    let i = _.find(results[1].result, function(elem) {
		return (elem.name === env.default_iface_name);
	    });

	    if (i) {
		env.default_iface_mac =  i.mac;
		env.default_iface_ip =  i.ipv4;
	    }
	}

	if (!results[2].error && results[2].result &&
	    env.gateway_ip!=null) 
	{
	    let i = _.find(results[2].result, function(elem) {
		return (elem.address === env.gateway_ip);
	    });
	    if (i)
		env.gateway_mac =  i.mac;
	}

	// 1st hop IP
	var p = results[3];
	if (!p.error && p.result && p.result.time_exceeded_from) {
	    env.hop1_ip = p.result.time_exceeded_from;
	}

	// 2nd hop IP
	p = results[4];
	if (!p.error && p.result && p.result.time_exceeded_from) {
	    env.hop2_ip = p.result.time_exceeded_from;
	}

	// 3rd hop IP
	p = results[5];
	if (!p.error && p.result && p.result.time_exceeded_from) {
	    env.hop3_ip = p.result.time_exceeded_from;
	} else if (!p.error && p.result && p.result.rtt.length>0) {
	    // reached the dst in three hops
	    env.hop3_ip = p.result.dst_ip;
	}

	// wifi
	p = results[6];
	if (!p.error && p.result && p.result.ssid) {
	    env.ssid = p.result.ssid;
	}
	if (!p.error && p.result && p.result.bssid) {
	    env.bssid = p.result.bssid;
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
    if (!ss.storage['baseline']['pageload'])
	ss.storage['baseline']['pageload'] = 0;
    ss.storage['baseline']['pageload'] += 1;
    ss.storage['baseline']['pageload_ts'] = ts;

    var blacklist = ss.storage['blacklist'] || [];
    var match = undefined;
    if (p.location && p.location.host) {
	// this should be instant as the IP is cached by the browser
	var r = dnsservice.resolve(p.location.host, flags);
	if (r.hasMore()) {
	    p.location.address = dnsservice.resolve(
		p.location.host, flags).getNextAddrAsString();
	}

	// see if the page hostname is whitelisted ?
	match = _.find(config.ALEXA_TOP, function(h) {
            // host matches a whitelisted site which is not blacklisted by user
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

    } else if (Math.random() < config.P_MEASURE) {
	// run extra traceroute + ping towards the server
	all([systemapi.execp({ method : 'doPing', 
			       params: [p.location.address, 
					{ count : 10, 
					  timeout : 5,
					  interval : 0.5 
					}]}),
	     systemapi.execp({ method : 'doTraceroute', 
			       params: [p.location.address, 
					{ count : 3, 
					  waittime : 5 
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

		console.debug('pmeasure',obj);

		if (canUpload(config.PAGELOAD_UPLOAD)) {
		    timers.setTimeout(
			upload.addUploadItem,100,"domainperf",obj);
		} // else uploads not allowed

	    }, function(err) {
		console.warn("baseline page measurement failed",err);
	    });
    }
	
    // store to db
    if (db) db.savePageload(p);

    if (canUpload(config.PAGELOAD_UPLOAD)) {
	timers.setTimeout(upload.addUploadItem,100,"pageload",p);
    } // else uploads not allowed
};
