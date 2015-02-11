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
Cu.import("resource://gre/modules/Task.jsm"); // exports Task
Cu.import("resource://gre/modules/Sqlite.jsm"); // exports Sqlite
Cu.import("resource://gre/modules/FileUtils.jsm"); // exports FileUtils
const { all, defer, promised } = require('sdk/core/promise');
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");
const fileIO = require('sdk/io/file');
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

// module stats
if (!ss.storage['baseline']) {
    ss.storage['baseline'] = {
	'last_run_ts' : null,
	'scheduled' : 0, // number of timer expires (== skipped + run)
	'skipped' : 0,   // skipped due to user activity
	'run' : 0,       // run measurements (== discarded + failed + saved)
	'discarded' : 0, // results discarded
	'failed' : 0,    // run failure
	'saved' : 0      // saved to db
    }
};

//-- SQL statements

// env table contains row per unique network environment visited by the device
//
// Unique env is identified by:
//
// -- default_iface_name (eth0, ath0, ...)
// -- default_iface_mac 
// -- gateway_ip
// -- gateway_mac
// -- ssid text
// -- bssid text
// -- TODO: mobile operator, network type, lac, cell ?
//
// In addition we store:
// -- hop1_ip text
// -- hop2_ip text
// -- hop3_ip text
// -- public IP
// -- country
// -- city
// -- isp
// -- AS number
// -- AS descr
// -- user label

// list of keys to identify a unique environment 
// TODO: gateway ip/mac can be the same in two environments .. 
const ENV_ID_KEYS = [
    'default_iface_name', 
    'default_iface_mac', 
    'gateway_ip', 
    'gateway_mac', 
    'ssid', 
    'bssid'];

const ENV_EXTRA_KEY = [
    'userlabel', 
    'lookup_ts',
    'public_ip',
    'country',
    'city',
    'isp',
    'net_desc',
    'as_number',
    'as_desc'];

const SQL_CREATE_ENV = "CREATE TABLE IF NOT EXISTS env(rowid integer primary key autoincrement, first_seen_ts integer, last_seen_ts integer, default_iface_name text, default_iface_mac text, gateway_ip text, gateway_mac text, ssid text, bssid text, hop1_ip text, hop2_ip text, hop3_ip text, userlabel text unique, public_ip text, country text, city text, isp text, net_desc text, as_number text, as_desc text, lookup_ts integer)";

const SQL_INSERT_ENV = "INSERT INTO env(first_seen_ts, default_iface_name, default_iface_mac, gateway_ip, gateway_mac, ssid, bssid, hop1_ip, hop2_ip, hop3_ip) VALUES(:first_seen_ts, :default_iface_name, :default_iface_mac, :gateway_ip, :gateway_mac, :ssid, :bssid, :hop1_ip, :hop2_ip, :hop3_ip)";

// row corresponds to a single measurement round, ~last 24h hours
const SQL_CREATE_BASELINE = "CREATE TABLE IF NOT EXISTS baseline(rowid integer primary key not null, env_id integer not null, ts integer not null, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, rx integer, tx integer, rtt1 real, rtt2 real, rtt3 real, rttx real)";

const SQL_INSERT_BASELINE = "INSERT INTO baseline(rowid, env_id, ts, tasks_total, tasks_running, tasks_sleeping, loadavg_onemin, loadavg_fivemin, loadavg_fifteenmin, cpu_user, cpu_system, cpu_idle, mem_total, mem_used, mem_free, mem_ff, wifi_signal, wifi_noise, rx, tx, rtt1, rtt2, rtt3, rttx) VALUES(:rowid, :env_id, :ts, :tasks_total, :tasks_running, :tasks_sleeping, :loadavg_onemin, :loadavg_fivemin, :loadavg_fifteenmin, :cpu_user, :cpu_system, :cpu_idle, :mem_total, :mem_used, :mem_free, :mem_ff, :wifi_signal, :wifi_noise, :rx, :tx, :rtt1, :rtt2, :rtt3, :rttx)";

// row represents aggregate level 1, ~last week
const SQL_CREATE_AGG1 = "CREATE TABLE IF NOT EXISTS agg1(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, rx integer, tx integer, rtt1 real, rtt2 real, rtt3 real, rttx real)";

// row represents aggregate level 2, ~last month
const SQL_CREATE_AGG2 = "CREATE TABLE IF NOT EXISTS agg2(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, rx integer, tx integer, rtt1 real, rtt2 real, rtt3 real, rttx real)";

// row represents aggregate level 3, ~last year
const SQL_CREATE_AGG3 = "CREATE TABLE IF NOT EXISTS agg3(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, rx integer, tx integer, rtt1 real, rtt2 real, rtt3 real, rttx real)";

// insert template -- replace xxx by table name
const SQL_INSERT_AGG = "INSERT INTO xxx(rowid, env_id, ts, samples, tasks_total, tasks_running, tasks_sleeping, loadavg_onemin, loadavg_fivemin, loadavg_fifteenmin, cpu_user, cpu_system, cpu_idle, mem_total, mem_used, mem_free, mem_ff, wifi_signal, wifi_noise, rx, tx, rtt1, rtt2, rtt3, rttx) VALUES(:rowid, :env_id, :ts, :samples, :tasks_total, :tasks_running, :tasks_sleeping, :loadavg_onemin, :loadavg_fivemin, :loadavg_fifteenmin, :cpu_user, :cpu_system, :cpu_idle, :mem_total, :mem_used, :mem_free, :mem_ff, :wifi_signal, :wifi_noise, :rx, :tx, :rtt1, :rtt2, :rtt3, :rttx)";

// database file, create if does not exist
var dbfile = FileUtils.getFile("ProfD", 
			       ["fathom", "baseline.sqlite"], 
			       true);
var dbconf = { path: dbfile.path, sharedMemoryCache: false };
var conn = undefined;
var backgroundtimer = undefined;

// register handler for baseline preference changes
sprefs.on(config.BASELINE, function() {
    if (userPrefs[config.BASELINE]) {
	console.info("baselineapi enabled by the user");
	timers.setTimeout(backgroundsched,0); 
    } else {
	console.info("baselineapi disabled by the user");
	if (backgroundtimer)
	    timers.clearTimeout(backgroundtimer);
    }
});

// function executed by the background measurement timer
var backgroundtask = function() {
    if (!userPrefs[config.BASELINE]) {	
	return;
    }

    ss.storage['baseline']['scheduled'] += 1;
    if (fathom.allowBackgroundTask()) {
	domeasurements(function(baseline) {
	    if (baseline.error) {
		console.warn("baseline failed",baseline.error);
		ss.storage['baseline']['failed'] += 1;
	    } else if ((Date.now() - baseline.ts) < 5*60*1000) {
		save(baseline);
		ss.storage['baseline']['saved'] += 1;
	    } else {
		// some prob, maybe went to sleep ?
		console.info('baseline discard (round longer than 5 minutes)');
		ss.storage['baseline']['discarded'] += 1;
	    }
	    backgroundsched();
	});
    } else {
	// skip this round
	ss.storage['baseline']['skipped'] += 1;
	backgroundsched();
    }
};

// schedule next background measurement round
var backgroundsched = function() {
    if (!userPrefs[config.BASELINE]) {
	return;
    }
    // add some random +/- 20% secs to the timing
    var d = Math.round(config.BASELINE_INTERVALS[0] + 
		       (0.5 - Math.random())*0.2*config.BASELINE_INTERVALS[0]);
    console.debug("baseline next round in " + d + " sec");
    backgroundtimer = timers.setTimeout(backgroundtask, d*1000);
};

// do a baseline measurement round
var domeasurements = exports.domeasurements = function(cb) {
    var ts = new Date(); // milliseconds since epoch
    var baseline = {
	ts : ts.getTime(),
	timezoneoffset : ts.getTimezoneOffset() 
    }

    ss.storage['baseline']['run'] += 1;
    ss.storage['baseline']['last_run_ts'] = ts;

    // run all promised functions, fails if any of the funtions fails
    all([
	utils.makePromise(getnetworkenv),
	systemapi.execp({ method : 'getBrowserMemoryUsage'}),
	systemapi.execp({ method : 'getLoad'}),
	systemapi.execp({ method : 'getIfaceStats'}),
	systemapi.execp({ method : 'getWifiSignal'}),
	systemapi.execp({ method : 'doPing', 
			  params: [config.MSERVER_FR, 
				   { count : 5, 
				     timeout : 2,
				     interval : 0.5 
				   }]}),
	systemapi.execp({ method : 'doTraceroute', 
			  params: [config.MSERVER_FR, 
				   { count : 3, 
				     waittime : 2 
				   }]})
	
    ]).then(function (results) {
	// success function
	baseline.networkenv = results[0];
	baseline.ffmem = results[1];
	baseline.load = results[2];
	baseline.traffic = results[3];
	baseline.wifi = results[4];
	baseline.rtt = { rttx : results[5] };
	baseline.traceroute = results[6];

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

	    console.debug('baseline measurement',baseline);

	    cb(baseline);

	}, function error(reason) {
	    cb({ error : reason});
	});

    }, function error(reason) {
	cb({ error : reason});
    });
};

/* Save a baseline round to the DB. */
var save = function(bs) {
    if (!conn) return;

    // sliding window index
    var rowid = ss.storage['baseline_idx'] + 1;
    rowid = rowid % config.BASELINE_ROWS[0];

    // current env
    var envid = bs.networkenv.env_id;

    // baseline row object
    var o = {
	rowid : rowid,
	env_id : envid, 
	ts : bs.ts,
	tasks_total : null,
	tasks_running : null,
	tasks_sleeping : null,
	loadavg_onemin : null,
	loadavg_fivemin : null,
	loadavg_fifteenmin : null,
	cpu_user : null,
	cpu_system : null,
	cpu_idle : null,
	mem_total : null,
	mem_used : null,
	mem_free : null,
	mem_ff : null,
	wifi_signal : null,
	wifi_noise : null,
	rx : null,
	tx : null,
	rtt1 : null,
	rtt2 : null,
	rtt3 : null,
	rttx : null
    };

    o.mem_ff = (!bs.ffmem.error ? bs.ffmem.result.mem : null);

    if (!bs.load.error) {
	if (bs.load.result.tasks) {
	    o.tasks_total = bs.load.result.tasks.total;
	    o.tasks_running = bs.load.result.tasks.running;
	    o.tasks_sleeping = bs.load.result.tasks.sleeping;
	}
	
	if (bs.load.result.loadavg) {
	    o.loadavg_onemin = bs.load.result.loadavg.onemin;
	    o.loadavg_fivemin = bs.load.result.loadavg.fivemin;
	    o.loadavg_fifteenmin = bs.load.result.loadavg.fifteenmin;
	}
	
	if (bs.load.result.cpu) {
	    o.cpu_user = bs.load.result.cpu.user;
	    o.cpu_system = bs.load.result.cpu.user;
	    o.cpu_idle = bs.load.result.cpu.idle; 
	}
	
	if (bs.load.result.memory) {
	    o.mem_total = bs.load.result.memory.total; 
	    o.mem_used = bs.load.result.memory.used;
	    o.mem_free = bs.load.result.memory.free;
	}
    }
    
    if (!bs.wifi.error) {
	o.wifi_signal = bs.wifi.result.signal || null;
	o.wifi_noise = bs.wifi.result.noise || null;
    }
    
    if (!bs.traffic.error) {
	// traffic counters of the current default interface
	let defiface = _.find(bs.traffic.result, function(r) {
	    return (r.name === bs.networkenv["default_iface_name"]);
	});
	if (defiface) {
	    o.rx = defiface.rx.bytes; 
	    o.tx = defiface.tx.bytes;
	}
    }
    
    if (!bs.rtt.rtt1.error && bs.rtt.rtt1.result.stats) {
	o.rtt1 = bs.rtt.rtt1.result.stats.median;
    };
    if (!bs.rtt.rtt2.error && bs.rtt.rtt2.result.stats) {
	o.rtt2 = bs.rtt.rtt2.result.stats.median;
    };
    if (!bs.rtt.rtt3.error && bs.rtt.rtt3.result.stats) {
	o.rtt3 = bs.rtt.rtt3.result.stats.median;
    };
    if (!bs.rtt.rttx.error && bs.rtt.rttx.result.stats) {
	o.rttx = bs.rtt.rttx.result.stats.median;
    };

    console.debug('baseline save row',o);
    
    Task.spawn(function* saveRound() {
	try {
	    yield conn.execute(
		"DELETE FROM baseline WHERE rowid="+o.rowid);
	    
	    yield conn.executeCached(SQL_INSERT_BASELINE,o);

	    ss.storage['baseline_idx'] = rowid;
	    
	    // check if we need to aggregate tables
	    doaggregate(bs.ts);

	} catch(err) {
	    console.error("baseline save fails: " + err);
	} finally {
	    // queue for upload in anycase if allowed
	    if (userPrefs[config.BASELINE_UPLOAD] === "always") {
		timers.setTimeout(upload.addUploadItem, 0, "baseline", [bs]);
	    }
	}
    }); // Task
}; // save

// update aggregate timeseries
var doaggregate = function(ts) {
    if (!conn) return;

    let dbs = ['baseline','agg1','agg2'];
		
    // aggregate table row object
    let o = {
	tasks_total : null,
	tasks_running : null,
	tasks_sleeping : null,
	loadavg_onemin : null,
	loadavg_fivemin : null,
	loadavg_fifteenmin : null,
	cpu_user : null,
	cpu_system : null,
	cpu_idle : null,
	mem_total : null,
	mem_used : null,
	mem_free : null,
	mem_ff : null,
	wifi_signal : null,
	wifi_noise : null,
	rtt1 : null,
	rtt2 : null,
	rtt3 : null,
	rttx : null
    };

    Task.spawn(function* agg() {
	for (let level = 1; level <= 3; level += 1) {
	    let wstart = ss.storage['baseline_ts_agg'+level];
	    let wend = wstart + config.BASELINE_INTERVALS[level]*1000;

	    while (wend < ts) {
		console.debug("handle agg"+level+" ["+wstart+","+wend+"]");

		// get one window of data from the previous level's table		
		let aggs = _.map(o, function(v,k) {
		    return "SUM("+k+") AS " + k;
		}).join(", ");
		let stmt = "SELECT env_id, COUNT(*) as n, "+aggs+", MAX(rx) as rx, MAX(tx) as tx FROM "+dbs[level-1]+" WHERE ts > " + wstart + " AND " + " ts <= " + wend + " GROUP BY env_id";
		console.debug(stmt);

		let rows = yield conn.execute(stmt);
		console.debug("got " + rows.length + " rows");
		for (let i = 0; i < rows.length; i++) {
		    // each result row corresponds to aggregate data
		    // in some environment
		    let row = rows[i];
		    let n = row.getResultByName('n');
		    console.debug(n + " samples for env=" + row.getResultByName('env_id'));

		    if (n <= 1)
			return; // ignore environments with 0 or 1 samples

		    let oo = _.clone(o);
		    _.each(_.keys(oo), function(col) {
			if (row.getResultByName(col))
			    oo[col] = row.getResultByName(col)*1.0 / n;
		    });

		    oo.rx = row.getResultByName('rx');
		    oo.tx = row.getResultByName('tx');
		    oo.env_id = row.getResultByName('env_id');
		    oo.samples = n;
		    oo.ts = wend; // multiple envs will have same timestamp
	    
		    let rowid = ss.storage['baseline_idx_agg'+level] + 1;
		    rowid = rowid % config.BASELINE_ROWS[level];
		    oo.rowid = rowid;
	    
		    console.debug(oo);
		
		    yield conn.execute(
			"DELETE FROM agg"+level+" WHERE rowid="+rowid);
		    
		    yield conn.executeCached(
			SQL_INSERT_AGG.replace('xxx','agg'+level),oo);

		    ss.storage['baseline_idx_agg'+level] = rowid;
		}; // for

		// next window
		wstart = wend;
		wend = wstart + config.BASELINE_INTERVALS[level]*1000;		
	    } // while

	    // end of the last handled window
	    ss.storage['baseline_ts_agg'+level] = wstart;
	} // for
    }); // Task
}; // doaggregate

/** Update network environment object from the db. */
var getnetworkenvdb = exports.getnetworkenvdb = function(callback, env) {
    if (!conn) return callback(env);

    Task.spawn(function* getEnv() {
	try {
	    // query to find the 'env' from the db based on the unique keys
	    let stmt = "SELECT * FROM env WHERE ";
	    stmt += _.map(ENV_ID_KEYS, function(k) {
		if (env[k]===null) {
		    return k+" IS NULL";
		} else {
		    return k+"='"+env[k]+"'";
		}
	    }).join(' AND ');
	    stmt += ' LIMIT 1';

	    let res = yield conn.executeCached(stmt);

	    if (!res || res.length == 0) {
		// new environment
		console.debug("baseline found new environment!");
		env.first_seen_ts = env.ts;
		
		var stripped_env = _.pick(env, [
		    'first_seen_ts',
		    'default_iface_name',
		    'default_iface_mac',
		    'gateway_ip',
		    'gateway_mac', 
		    'ssid', 
		    'bssid', 
		    'hop1_ip', 
		    'hop2_ip',
		    'hop3_ip'
		]);
		yield conn.executeCached(SQL_INSERT_ENV, stripped_env);
		
		res = yield conn.executeCached(
		    "SELECT last_insert_rowid() AS rowid");

		env.env_id = res[0].getResultByName("rowid");
		
	    } else if (res && res.lenght>0) {
		// already in the database -- update the object
		env.env_id = res[0].getResultByName("rowid");
		env.first_seen_ts = res[0].getResultByName("first_seen_ts");
		_.each(ENV_EXTRA_KEYS, function(k) {
		    if (res[0].getResultByName(k)) {
			env[k] = res[0].getResultByName(k);
		    }
		});
	    }

	    yield conn.executeCached(
		"UPDATE env SET last_seen_ts=" + env.ts + 
		    " WHERE rowid=" + env.env_id);

	    if (!env.lookup_ts) {
		// have not yet resolved the public IP / AS, try to do
		// it now -- this is done once / environment
		let ipres = yield toolsapi.execp({ method : 'lookupIP'});
		if (ipres && !ipres.error) {
		    env.lookup_ts = env.ts;
		    env.public_ip = ipres.ip;
		    env.country = ipres.country;
		    env.city = ipres.city;
		    env.isp = ipres.isp;

		    if (ipres.whois) {
			env.net_desc =
			    ((ipres.whois.netblock && 
			      ipres.whois.netblock.descr) ? 
			     ipres.whois.netblock.descr.split(';')[0] : 
			     null);

			env.as_number = (ipres.whois.asblock ? 
					 ipres.whois.asblock.origin : null);

			env.as_desc = 
			    ((ipres.whois.asblock && 
			      ipres.whois.asblock.descr) ? 
			     ipres.whois.asblock.descr.split(';')[0] : 
			     null);
		    }

		    // update DB
		    yield conn.execute(
			"UPDATE env SET public_ip='"+env.public_ip +
			    "', country='"+env.country + 
			    "', city='"+env.city + 
			    "', isp=\""+env.isp + 
			    "\", net_desc=\""+env.net_desc + 
			    "\", as_number='"+env.as_number + 
			    "', as_desc=\""+env.as_desc + 
			    "\", lookup_ts="+env.lookup_ts + 
			    " WHERE rowid="+env.env_id);
		}
	    }

	    // return the updated env object
	    return callback(env);

	} catch(err) {
	    console.error("baseline getnetworkenvdb fails: " + err);
	    return callback(error("dbqueryfailed", err));
	}
    }); // Task
}

/** Current network environment. */
var getnetworkenv = exports.getnetworkenv = function(callback) {
    var ts = new Date();
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
	    gateway_ip : null,
	    default_iface_mac : null,
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
	    if (i)
		env.default_iface_mac =  i.mac;
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

	// fill-in remaining values from the db
	getnetworkenvdb(function(finalenv) {
	    callback(finalenv);
	}, env);

    }, function(err) {
	// rejection handler
	callback(error("internal",err));
    });
};

/**
 * Initialize the API component.
 */
var setup = exports.setup = function() {
    console.info("baseline setup, db="+dbfile.path);
};

/**
 * Cleanup the API component.
 */
var cleanup = exports.cleanup = function() {
    console.info("baseline cleanup");
    if (dbfile && fileIO.exists(dbfile.path)) {
	fileIO.remove(dbfile.path);
    }
};

// init tables and indexes if not done yet
var inittables = function() {
    Task.spawn(function* createDb() {
	let stophere = yield conn.tableExists('baseline');
	if (stophere)
	    return;
	
	console.info("baseline db " + SQL_CREATE_ENV);
	yield conn.execute(SQL_CREATE_ENV);
	
	console.info("baseline db " + SQL_CREATE_BASELINE);
	yield conn.execute(SQL_CREATE_BASELINE);
	
	console.info("baseline db " + SQL_CREATE_AGG1);
	yield conn.execute(SQL_CREATE_AGG1);
	
	console.info("baseline db " + SQL_CREATE_AGG2);
	yield conn.execute(SQL_CREATE_AGG2);
	
	console.info("baseline db " + SQL_CREATE_AGG3);
	yield conn.execute(SQL_CREATE_AGG3);    
	
	let now = new Date().getTime(); // milliseconds since epoch
	
	ss.storage['baseline_idx'] = -1;
	ss.storage['baseline_idx_agg1'] = -1;
	ss.storage['baseline_idx_agg2'] = -1;
	ss.storage['baseline_idx_agg3'] = -1;
	
	ss.storage['baseline_ts_agg1'] = now;
	ss.storage['baseline_ts_agg2'] = now;
	ss.storage['baseline_ts_agg3'] = now;
	
	console.info('baseline tables and indexes created');
    }); // Task
}; // inittables

/**
 * Initialize the API component when the addon is loaded.
 */
var start = exports.start = function() {
    console.info("baseline start");
    Sqlite.openConnection(dbconf).then(
	function onConnection(connection) {
	    console.info("baseline db connection up");
	    conn = connection;
	    inittables();
	    backgroundsched();
	},
	function onError(err) {
	    // should not happen, this will make this module un-usable!!
	    console.error("baseline failed to open db connection: " + err);
	    conn = undefined;
	}
    );
};

/**
 * Cleanup the API component when the addon is unloaded.
 */
var stop = exports.stop = function() {
    console.info("baseline stop");    
    if (backgroundtimer)
	timers.clearTimeout(backgroundtimer);
    backgroundtimer = undefined;
    if (conn)
	conn.close();
    conn = undefined;
};

/**
 * Executes the given request and callback with the data or an object with
 * error field with a short error message. 
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!conn)
	return callback(error("dbconnfailed", "baseline database"));
    if (!req.method)
	return callback(error("missingmethod"));

    switch (req.method) {
    case 'get':
	var metric = (req.params ? req.params[0] : undefined);
	var range = (req.params ? req.params[1] : undefined);

	if (!metric)
	    return callback(error("missingparams", "metric"));
	if (!range)
	    return callback(error("missingparams", "range"));
	
	if (!_.isArray(metric)) {
	    metric = [metric];
	}

	// just make sure we don't try to request env as part of other
	// timeseries -- programmer error if happens
	if (_.contains(metric, "env") && metric.length != 1) {
	    metric = _.filter(metric, function(m) { return (m !== 'env'); });
	}

	var stmt;    
	var cols = ['ts', 'env_id'];

	_.each(metric, function(m) {
	    switch (m) {
	    case 'cpu':
		cols = cols.concat(["cpu_user", "cpu_system", "cpu_idle"]);
		break;
	    case 'load':
		cols = cols.concat(["loadavg_onemin", "loadavg_fivemin", "loadavg_fifteenmin"]);
		break;
	    case 'tasks':
		cols = cols.concat(["tasks_total", "tasks_running", "tasks_sleeping"]);
		break;
	    case 'mem':
		cols = cols.concat(["mem_total", "mem_used", "mem_free", "mem_ff"]);
		break;
	    case 'traffic':
		cols = cols.concat(["tx", "rx"]);
		break;
	    case 'wifi':
		cols = cols.concat(["wifi_noise", "wifi_signal"]);
		break;
	    case 'rtt':
		cols = cols.concat(["rtt1", "rtt2", "rtt3", "rttx"]);
		break;
	    case 'env':
		cols = cols.concat(["ts","env_id","first_seen_ts","last_seen_ts","default_iface_name","default_iface_mac","gateway_ip","gateway_mac","ssid","bssid","hop1_ip","hop2_ip","hop3_ip","public_ip","country","city","isp","userlabel","net_desc","as_number","as_desc","lookup_ts"]);
		stmt = "SELECT s.ts as ts, e.rowid as env_id, e.first_seen_ts, e.last_seen_ts,  e.default_iface_name,  e.default_iface_mac, e.gateway_ip, e.gateway_mac, e.ssid, e.bssid, e.hop1_ip, e.hop2_ip, e.hop3_ip, e.public_ip, e.country, e.city, e.isp, e.userlabel, e.net_desc, e.as_number, e.as_desc, e.lookup_ts";
		break;
	    default:
		callback({error : "Invalid metric: " + metric});
		return;
	    }
	});

	var t;
	switch (range) {
	case 'day':
	    t = "baseline";
	    break;
	case 'week':
	    t = "agg1";
	    break;
	case 'month':
	    t = "agg2";
	    break;
	case 'year':
	    t = "agg3";
	    break;
	default:
	    callback(error("invalidparams", "range=" + range));
	    return;
	}
	
	if (_.contains(metric, "env")) {
	    stmt += ' FROM '+t+' as s INNER JOIN env as e ON s.env_id = e.rowid'+' ORDER BY s.ts';
	} else {
	    stmt = "SELECT " + cols.join(', ') + " FROM " + t + " ORDER BY ts"; 
	}
	console.debug(stmt);
	
	let res = { metric : metric, range : range, data : []};
	conn.execute(stmt, null, function(row) {
	    let o = {};
	    _.each(cols, function(col) {
		o[col] = row.getResultByName(col);
	    });
	    res.data.push(o);
	}).then(function onComplete(result) {
	    return callback(res);
	},function onError(err) {
	    return callback(error("dbqueryfailed", err));
	});

	break;
	
    case 'setUserlabel':
	var envid = (req.params ? req.params[0] : undefined);
	var label = (req.params ? req.params[1] : undefined);

	if (!envid)
	    return callback(error("missingparams", "envid"));
	if (!label)
	    return callback(error("missingparams", "label"));

	var stmt = "UPDATE env SET userlabel=\"" + userlabel +
	    "\" WHERE rowid=" + envid;

	conn.execute(stmt, null)
	    .then(function onComplete(result) {
		return callback({}, true);
	    },function onError(err) {
		return callback(error("dbqueryfailed", err));
	    });

	break;

    default:
	return callback(error("nosuchmethod", req.method));
    }
}; // exec

/** Exec calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};
