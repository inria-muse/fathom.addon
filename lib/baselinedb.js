/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The baseline Sqlite DB handler.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const { Unknown } = require('sdk/platform/xpcom');
const { all, defer, promised } = require('sdk/core/promise');
const fileIO = require('sdk/io/file');
const ss = require("sdk/simple-storage");
const self = require("sdk/self");

const {Cc, Ci, Cu} = require("chrome");
Cu.import("resource://gre/modules/Task.jsm"); // exports Task
Cu.import("resource://gre/modules/Sqlite.jsm"); // exports Sqlite
Cu.import("resource://gre/modules/FileUtils.jsm"); // exports FileUtils

const {error, FathomException} = require("error");
const config = require('config');
const toolsapi = require("toolsapi");
const _ = require('underscore');

// current DB schema version
const SCHEMA_VERSION = 4;

// backwards compat hack -- version numbering updates
if (!ss.storage['baseline_dbschema']) {
    ss.storage['baseline_dbschema'] = 1;

    if (ss.storage['baseline_dbupdate']) {
	ss.storage['baseline_dbschema'] = 2;
	delete ss.storage['baseline_dbupdate']
    }

    if (ss.storage['baseline_dbupdate2']) {
	ss.storage['baseline_dbschema'] = 3;
	delete ss.storage['baseline_dbupdate2']
    }
}

/** Constructor */
var DB = exports.DB = function() {
    this.dbfile = FileUtils.getFile("ProfD", 
				    ["fathom", "baseline.sqlite"], 
				    true);
    this.dbconf = { 
	path: this.dbfile.path, 
	sharedMemoryCache: false 
    };

    this.conn = undefined;
};

/** Connect to the db */
DB.prototype.connect = function(cb) {
    var that = this;
    this.close(); // make sure we're closed

    Sqlite.openConnection(that.dbconf).then(
	function onConnection(connection) {
	    that.conn = connection;

	    Task.spawn(function* createDb() {
		let initdone = yield that.conn.tableExists('baseline');
		if (!initdone) {
		    yield that.conn.execute(SQL_CREATE_ENV);
		    yield that.conn.execute(SQL_CREATE_BASELINE);
		    yield that.conn.execute(SQL_CREATE_AGG1);
		    yield that.conn.execute(SQL_CREATE_AGG2);
		    yield that.conn.execute(SQL_CREATE_AGG3);    
	
		    ss.storage['baseline_idx'] = -1;
		    ss.storage['baseline_idx_agg1'] = -1;
		    ss.storage['baseline_idx_agg2'] = -1;
		    ss.storage['baseline_idx_agg3'] = -1;
		    ss.storage['baseline_dbschema'] = SCHEMA_VERSION;

                    console.log('baselinedb tables created schema='+
				ss.storage['baseline_dbschema']);
		}

		// do various updates to the schema depending on
		// the current DB version

		if (ss.storage['baseline_dbschema'] < 2) {
		    ss.storage['baseline_dbschema'] = 2;

		    // new columns for pageload baselines
		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_total integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_total integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_total integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg3 ADD COLUMN pageload_total integer;');

		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_dns integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_dns integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_dns integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg3 ADD COLUMN pageload_dns integer;');

		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_firstbyte integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_firstbyte integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_firstbyte integer;');
		    yield that.conn.execute(
			'ALTER TABLE agg3 ADD COLUMN pageload_firstbyte integer;');

		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_total_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_total_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_total_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg3 ADD COLUMN pageload_total_delay real;');

		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_dns_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_dns_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_dns_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg3 ADD COLUMN pageload_dns_delay real;');

		    yield that.conn.execute(
			'ALTER TABLE baseline ADD COLUMN pageload_firstbyte_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg1 ADD COLUMN pageload_firstbyte_delay real;');
		    yield that.conn.execute(
			'ALTER TABLE agg2 ADD COLUMN pageload_firstbyte_delay real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg3 ADD COLUMN pageload_firstbyte_delay real;');
                    
                    console.log('baselinedb tables updated to schema='+
				ss.storage['baseline_dbschema']);
		}

		if (ss.storage['baseline_dbschema'] < 3) {
		    ss.storage['baseline_dbschema'] = 3;

		    yield that.conn.execute(                        
			'ALTER TABLE baseline ADD COLUMN wifi_quality real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg1 ADD COLUMN wifi_quality real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg2 ADD COLUMN wifi_quality real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg3 ADD COLUMN wifi_quality real;');
                    
                    console.log('baselinedb tables updated to schema='+
				ss.storage['baseline_dbschema']);
		}

		if (ss.storage['baseline_dbschema'] < 4) {
		    ss.storage['baseline_dbschema'] = 4;

		    yield that.conn.execute(                        
			'ALTER TABLE baseline ADD COLUMN rtt0 real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg1 ADD COLUMN rtt0 real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg2 ADD COLUMN rtt0 real;');
		    yield that.conn.execute(                        
			'ALTER TABLE agg3 ADD COLUMN rtt0 real;');
                    
                    console.log('baselinedb tables updated to schema='+
				ss.storage['baseline_dbschema']);
		}

	    }).then(cb, function(err) {
		that.close();
                console.error('baselinedb',err);
		cb(error("internal", err));
	    }); // Task
	},
	function onError(err) {
	    that.conn = undefined;
            console.error('baselinedb',err);
	    cb(error("dbconnfailed",err));
	}
    );
};

/** Connection status. */
DB.prototype.isConnected = function() {
    return (this.conn !== undefined);
};

/** Close db */
DB.prototype.close = function() {
    if (this.isConnected())
	this.conn.close();
    this.conn = undefined;
};

/** Remove the db file. */
DB.prototype.cleanup = function() {
    this.close();
    if (this.dbfile && fileIO.exists(this.dbfile.path)) {
	fileIO.remove(this.dbfile.path);
    }
};

/** Store a sys baseline measurement */
DB.prototype.saveBaseline = function(bs) {
    if (!this.isConnected()) return;
    var that = this;

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
	wifi_quality : null,
	rx : null,
	tx : null,
	rtt0 : null,
	rtt1 : null,
	rtt2 : null,
	rtt3 : null,
	rttx : null,
	pageload_total : null,
	pageload_dns : null,
	pageload_firstbyte : null, 
	pageload_total_delay : null, 
	pageload_dns_delay : null, 
	pageload_firstbyte_delay : null
    };

    if (bs.pageload) {
	o.pageload_total = bs.pageload.total;
	o.pageload_dns = bs.pageload.dns;
	o.pageload_firstbyte = bs.pageload.firstbyte;
	o.pageload_total_delay = bs.pageload.total_delay;
	o.pageload_dns_delay = bs.pageload.dns_delay;
	o.pageload_firstbyte_delay = bs.pageload.firstbyte_delay;
    }

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
	o.wifi_quality = bs.wifi.result.quality || null;
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
    
    if (!bs.rtt.rtt0.error && bs.rtt.rtt0.result.stats) {
	o.rtt0 = bs.rtt.rtt0.result.stats.median;
    };
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

    console.debug('baselinedb save row',o);
    
    Task.spawn(function* saveRound() {
	try {
	    yield that.conn.execute(
		"DELETE FROM baseline WHERE rowid="+o.rowid);	    
	    yield that.conn.executeCached(SQL_INSERT_BASELINE,o);
	    ss.storage['baseline_idx'] = rowid;	    
	} catch(err) {
	    console.error("baselinedb save error",err);
	}
    }); // Task
};

/** Update aggregation tables. */
DB.prototype.baselineAgg = function(ts) {
    if (!this.isConnected()) return;
    var that = this;

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
	wifi_quality : null,
	rtt0 : null,
	rtt1 : null,
	rtt2 : null,
	rtt3 : null,
	rttx : null,
	pageload_total : null, 
	pageload_dns : null, 
	pageload_firstbyte : null, 
	pageload_total_delay : null, 
	pageload_dns_delay : null, 
	pageload_firstbyte_delay : null
    };

    Task.spawn(function* agg() {
	try {
	    // FIXME: maybe doing this by time is not the best thing
	    // slow when the last check was long time in past ...
	    for (let level = 1; level <= 3; level += 1) {
		// first time we run agg, no window start
		if (!ss.storage['baseline_ts_agg'+level])
		    ss.storage['baseline_ts_agg'+level] = ts;

		let wstart = ss.storage['baseline_ts_agg'+level];
		let wend = wstart + config.BASELINE_INTERVALS[level]*1000;
	    
		while (wend < ts) {
		    console.debug("handle agg"+level+" ["+wstart+","+wend+"]");

		    // get one window of data from the previous level's table
		    let aggs = _.map(o, function(v,k) {
			return "SUM("+k+") AS " + k;
		    }).join(", ");

		    let stmt = "SELECT env_id, COUNT(*) as n, "+aggs+", MAX(rx) as rx, MAX(tx) as tx, MAX(ts) as wend FROM "+dbs[level-1]+" WHERE ts > " + wstart + " AND " + " ts <= " + wend + " GROUP BY env_id";

		    let rows = yield that.conn.execute(stmt);
		    console.debug("got " + rows.length + " rows");
		    for (let i = 0; i < rows.length; i++) {
			// each result row corresponds to aggregate data
			// in some environment
			let row = rows[i];
			let n = row.getResultByName('n');
			console.debug(n + " samples for env=" + row.getResultByName('env_id'));

			if (n <= 1)
			    continue; // ignore environments with 0 or 1 samples

			let oo = _.clone(o);
			_.each(_.keys(oo), function(col) {
			    if (row.getResultByName(col))
				oo[col] = row.getResultByName(col)*1.0 / n;
			});

			oo.rx = row.getResultByName('rx');
			oo.tx = row.getResultByName('tx');
			oo.env_id = row.getResultByName('env_id');
			oo.samples = n;
			oo.ts = row.getResultByName('wend'); // last agg sample ts
	    
			let rowid = ss.storage['baseline_idx_agg'+level] + 1;
			rowid = rowid % config.BASELINE_ROWS[level];
			oo.rowid = rowid;
			
			console.debug(oo);
			
			yield that.conn.execute(
			    "DELETE FROM agg"+level+" WHERE rowid="+rowid);
		    
			yield that.conn.executeCached(
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
	} catch(err) {
	    console.error("baselinedb agg error", err);
	}
    }); // Task
};

/** Lookup and if found, return extended info about the given env.*/
DB.prototype.lookupEnv = function(env, cb) {
    if (!this.isConnected()) return cb(env);

    var that = this;
    Task.spawn(function* getEnv() {
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

	let res = yield that.conn.executeCached(stmt);

	if (!res || res.length == 0) {
	    // insert new env to the DB
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
	    yield that.conn.executeCached(SQL_INSERT_ENV, stripped_env);
	    
	    res = yield that.conn.executeCached(
		"SELECT last_insert_rowid() AS rowid");
	    
	    env.env_id = res[0].getResultByName("rowid");
	    
	    console.debug("baselinedb env firsttime", env);
	    
	} else {
	    // already in the database -- update the object
	    env.env_id = res[0].getResultByName("rowid");
	    env.first_seen_ts = res[0].getResultByName("first_seen_ts");
	    _.each(ENV_EXTRA_KEYS, function(k) {
		if (res[0].getResultByName(k)) {
		    env[k] = res[0].getResultByName(k);
		}
	    });
	    
	    console.debug("baselinedb env db", env);
	}
	
	// seen now
	yield that.conn.execute(
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
		yield that.conn.execute(
		    "UPDATE env SET public_ip='"+env.public_ip +
			"', country='"+env.country + 
			"', city='"+env.city + 
			"', isp=\""+env.isp + 
			"\", net_desc=\""+env.net_desc + 
			"\", as_number='"+env.as_number + 
			"', as_desc=\""+env.as_desc + 
			"\", lookup_ts="+env.lookup_ts + 
			" WHERE rowid="+env.env_id);
		
		console.debug("baselinedb env lookup", env);
	    }
	}
	
	// if we get here, return the updated env
	return env;

    }).then(cb, function(err) {
	console.error("baselinedb getenv fails",err);
	return cb(error("dbqueryfailed", err));	
    }); // Task
};

// map selected aggregation range to the db table
var rangetotable = function(range) {
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
	t = undefined;
    }
    return t;
}

/** Update user label for a given environment. */
DB.prototype.updateEnvUserLabel = function(envid, label, cb) {
    if (!this.isConnected()) return cb(error("internal","db is not connected"));

    var stmt = "UPDATE env SET userlabel=\"" + label +
	"\" WHERE rowid=" + envid;
    this.conn.execute(stmt, null)
	.then(function onComplete(result) {
	    return cb({}, true);
	},function onError(err) {
	    return cb(error("dbqueryfailed", err));
	});
};

/** Get environment presence timeseries with full env info. */
DB.prototype.getEnvRange = function(range, cb) {
    if (!this.isConnected()) return cb(error("internal","db is not connected"));

    var t = rangetotable(range);
    if (!t) return cb(error("invalidparams", "range=" + range));

    var cols = ["ts","env_id","first_seen_ts","last_seen_ts","default_iface_name","default_iface_mac","gateway_ip","gateway_mac","ssid","bssid","hop1_ip","hop2_ip","hop3_ip","public_ip","country","city","isp","userlabel","net_desc","as_number","as_desc","lookup_ts"];

    var stmt = "SELECT s.ts as ts, e.rowid as env_id, e.first_seen_ts, e.last_seen_ts,  e.default_iface_name,  e.default_iface_mac, e.gateway_ip, e.gateway_mac, e.ssid, e.bssid, e.hop1_ip, e.hop2_ip, e.hop3_ip, e.public_ip, e.country, e.city, e.isp, e.userlabel, e.net_desc, e.as_number, e.as_desc, e.lookup_ts FROM "+t+' as s INNER JOIN env as e ON s.env_id = e.rowid ORDER BY s.ts';

    let res = { metric : 'env', range : range, data : []};
    this.conn.executeCached(stmt, null, function(row) {
	let o = {};
	_.each(cols, function(col) {
	    o[col] = row.getResultByName(col);
	});
	res.data.push(o);
    }).then(function onComplete(result) {
	return cb(res);
    },function onError(err) {
	return cb(error("dbqueryfailed", err));
    });
};

/** Get timeseries of selected baseline metrics. */
DB.prototype.getBaselineRange = function(metric, range, cb) {
    if (!this.isConnected()) 
	return cb(error("internal","db is not connected"));

    var t = rangetotable(range);
    if (!t) return cb(error("invalidparams", "range=" + range));

    // can select multiple metrics groups (or just one)
    if (!_.isArray(metric)) {
	metric = [metric];
    }

    // select columns
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
	    cols = cols.concat(["wifi_noise", "wifi_signal", "wifi_quality"]);
	    break;

	case 'rtt':
	    cols = cols.concat(["rtt0","rtt1", "rtt2", "rtt3", "rttx"]);
	    break;

	case 'pageload':
	    cols = cols.concat(["pageload_total", "pageload_dns", "pageload_firstbyte"]);
	    break;

	case 'pageload_delay':
	    cols = cols.concat(["pageload_total_delay", "pageload_dns_delay", "pageload_firstbyte_delay"]);
	    break;

	default:
	    return cb({error : "Invalid metric: " + metric});
	}
    });
	
    var stmt = "SELECT " + cols.join(', ') + " FROM " + t + " ORDER BY ts"; 	
    let res = { metric : metric, range : range, data : [] };
    this.conn.executeCached(stmt, null, function(row) {
	let o = {};
	_.each(cols, function(col) {
	    o[col] = row.getResultByName(col);
	});
	res.data.push(o);
    }).then(function onComplete(result) {
	return cb(res);
    },function onError(err) {
	return cb(error("dbqueryfailed", err));
    });
}

//-- SQL statements

// list of keys to identify a unique environment 
// TODO: gateway ip/mac can be the same in two environments .. 
const ENV_ID_KEYS = [
    'default_iface_name', 
    'default_iface_mac', 
    'gateway_ip', 
    'gateway_mac', 
    'ssid', 
    'bssid'];

const ENV_EXTRA_KEYS = [
    'userlabel', 
    'lookup_ts',
    'public_ip',
    'country',
    'city',
    'isp',
    'net_desc',
    'as_number',
    'as_desc'];

// env table contains row per unique network environment visited by the device
const SQL_CREATE_ENV = "CREATE TABLE IF NOT EXISTS env(rowid integer primary key autoincrement, first_seen_ts integer, last_seen_ts integer, default_iface_name text, default_iface_mac text, gateway_ip text, gateway_mac text, ssid text, bssid text, hop1_ip text, hop2_ip text, hop3_ip text, userlabel text unique, public_ip text, country text, city text, isp text, net_desc text, as_number text, as_desc text, lookup_ts integer)";

const SQL_INSERT_ENV = "INSERT INTO env(first_seen_ts, default_iface_name, default_iface_mac, gateway_ip, gateway_mac, ssid, bssid, hop1_ip, hop2_ip, hop3_ip) VALUES(:first_seen_ts, :default_iface_name, :default_iface_mac, :gateway_ip, :gateway_mac, :ssid, :bssid, :hop1_ip, :hop2_ip, :hop3_ip)";

// row corresponds to a single measurement round, ~last 24h hours
const SQL_CREATE_BASELINE = "CREATE TABLE IF NOT EXISTS baseline(rowid integer primary key not null, env_id integer not null, ts integer not null, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, wifi_quality real, rx integer, tx integer, rtt0 real, rtt1 real, rtt2 real, rtt3 real, rttx real, pageload_total integer, pageload_dns integer, pageload_firstbyte integer, pageload_total_delay real, pageload_dns_delay real, pageload_firstbyte_delay real)";

const SQL_INSERT_BASELINE = "INSERT INTO baseline(rowid, env_id, ts, tasks_total, tasks_running, tasks_sleeping, loadavg_onemin, loadavg_fivemin, loadavg_fifteenmin, cpu_user, cpu_system, cpu_idle, mem_total, mem_used, mem_free, mem_ff, wifi_signal, wifi_noise, wifi_quality, rx, tx, rtt0, rtt1, rtt2, rtt3, rttx, pageload_total, pageload_dns, pageload_firstbyte, pageload_total_delay, pageload_dns_delay, pageload_firstbyte_delay) VALUES(:rowid, :env_id, :ts, :tasks_total, :tasks_running, :tasks_sleeping, :loadavg_onemin, :loadavg_fivemin, :loadavg_fifteenmin, :cpu_user, :cpu_system, :cpu_idle, :mem_total, :mem_used, :mem_free, :mem_ff, :wifi_signal, :wifi_noise, :wifi_quality, :rx, :tx, :rtt0, :rtt1, :rtt2, :rtt3, :rttx, :pageload_total, :pageload_dns, :pageload_firstbyte, :pageload_total_delay, :pageload_dns_delay, :pageload_firstbyte_delay)";

// row represents aggregate level 1, ~last week
const SQL_CREATE_AGG1 = "CREATE TABLE IF NOT EXISTS agg1(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, wifi_quality real, rx integer, tx integer, rtt0 real, rtt1 real, rtt2 real, rtt3 real, rttx real, pageload_total integer, pageload_dns integer, pageload_firstbyte integer, pageload_total_delay real, pageload_dns_delay real, pageload_firstbyte_delay real)";

// row represents aggregate level 2, ~last month
const SQL_CREATE_AGG2 = "CREATE TABLE IF NOT EXISTS agg2(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, wifi_quality real, rx integer, tx integer, rtt0 real, rtt1 real, rtt2 real, rtt3 real, rttx real, pageload_total integer, pageload_dns integer, pageload_firstbyte integer, pageload_total_delay real, pageload_dns_delay real, pageload_firstbyte_delay real)";

// row represents aggregate level 3, ~last year
const SQL_CREATE_AGG3 = "CREATE TABLE IF NOT EXISTS agg3(rowid integer primary key not null, env_id integer not null, ts integer not null, samples integer, tasks_total integer, tasks_running integer, tasks_sleeping integer, loadavg_onemin real, loadavg_fivemin real, loadavg_fifteenmin real, cpu_user real, cpu_system real, cpu_idle real, mem_total integer, mem_used integer, mem_free integer, mem_ff integer, wifi_signal integer, wifi_noise integer, wifi_quality real, rx integer, tx integer, rtt0 real, rtt1 real, rtt2 real, rtt3 real, rttx real, pageload_total integer, pageload_dns integer, pageload_firstbyte integer, pageload_total_delay real, pageload_dns_delay real, pageload_firstbyte_delay real)";

// insert template -- replace xxx by table name
const SQL_INSERT_AGG = "INSERT INTO xxx(rowid, env_id, ts, samples, tasks_total, tasks_running, tasks_sleeping, loadavg_onemin, loadavg_fivemin, loadavg_fifteenmin, cpu_user, cpu_system, cpu_idle, mem_total, mem_used, mem_free, mem_ff, wifi_signal, wifi_noise, wifi_quality, rx, tx, rtt0, rtt1, rtt2, rtt3, rttx, pageload_total, pageload_dns, pageload_firstbyte, pageload_total_delay, pageload_dns_delay, pageload_firstbyte_delay) VALUES(:rowid, :env_id, :ts, :samples, :tasks_total, :tasks_running, :tasks_sleeping, :loadavg_onemin, :loadavg_fivemin, :loadavg_fifteenmin, :cpu_user, :cpu_system, :cpu_idle, :mem_total, :mem_used, :mem_free, :mem_ff, :wifi_signal, :wifi_noise, :wifi_quality, :rx, :tx, :rtt0, :rtt1, :rtt2, :rtt3, :rttx, :pageload_total, :pageload_dns, :pageload_firstbyte, :pageload_total_delay, :pageload_dns_delay, :pageload_firstbyte_delay)";

