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
const timers = require("sdk/timers");

const {Cc, Ci, Cu} = require("chrome");
Cu.import("resource://gre/modules/Task.jsm"); // exports Task
Cu.import("resource://gre/modules/Sqlite.jsm"); // exports Sqlite
Cu.import("resource://gre/modules/FileUtils.jsm"); // exports FileUtils

const _ = require('underscore');

const {error, FathomException} = require("./error");
const config = require('./config');
const utils = require('./utils');

// current DB schema version
const SCHEMA_VERSION = 8;

/** Constructor */
var DB = exports.DB = function() {
    this.version = ss.storage['baseline_dbschema'] || -1;

    this.dbfile = FileUtils.getFile(
        "ProfD", 
        ["fathom", "baseline.sqlite"], 
        true);

    this.dbconf = { 
        path: this.dbfile.path, 
        sharedMemoryCache: false 
    };

    console.log("baselinedb",this.dbfile.path, this.version);

    this.conn = undefined;
};

/** Connect to the db */
DB.prototype.connect = function(cb) {
    var that = this;
    that.close(); // make sure we're closed

    Task.spawn(function() {
        that.conn = yield Sqlite.openConnection(that.dbconf);
        console.log("baselinedb connected");

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
            that.version = SCHEMA_VERSION;

            console.log('baselinedb tables created schema='+
                ss.storage['baseline_dbschema']);

        } else {
            // do various updates to the current schema depending on
            // the DB version
            console.log('check for DB updates from ' + that.version + ' to ' + SCHEMA_VERSION);

            // updates 5&6&7 & 8 (on win only) require resetting the database (bad values)
            if (that.version < 7 || (that.version < 8 && utils.isWin())) {
                // wipe out and re-create the whole database
                that.conn.close();
                if (that.dbfile && fileIO.exists(that.dbfile.path)) {
                    console.log("baselinedb remove",that.dbfile.path);
                    fileIO.remove(that.dbfile.path);
                }
                console.log("baselinedb re-create",that.dbfile.path);
                that.dbfile = FileUtils.getFile(
                        "ProfD", 
                        ["fathom", "baseline.sqlite"], 
                        true);
                that.dbconf = { 
                    path: that.dbfile.path, 
                    sharedMemoryCache: false 
                };

                // re-connect
                that.conn = yield Sqlite.openConnection(that.dbconf);
                console.log("baselinedb re-connected");

                yield that.conn.execute(SQL_CREATE_ENV);
                yield that.conn.execute(SQL_CREATE_BASELINE);
                yield that.conn.execute(SQL_CREATE_AGG1);
                yield that.conn.execute(SQL_CREATE_AGG2);
                yield that.conn.execute(SQL_CREATE_AGG3);    

                ss.storage['baseline_idx'] = -1;
                ss.storage['baseline_idx_agg1'] = -1;
                ss.storage['baseline_idx_agg2'] = -1;
                ss.storage['baseline_idx_agg3'] = -1;

                console.log('baselinedb tables re-created schema='+
                    ss.storage['baseline_dbschema']);
            }

            // update version tag
            if (that.version < SCHEMA_VERSION) {
                ss.storage['baseline_dbschema'] = SCHEMA_VERSION;
                that.version = SCHEMA_VERSION;
            }
        }

    }).then(
        cb, // success
        function(err) { // error handler
            that.close();
            console.error('baselinedb',err);
            cb(error("dbconnfailed",err));
        }
    ); // Task
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
        console.log("baselinedb remove",this.dbfile.path);
        fileIO.remove(this.dbfile.path);
    }
};

/** Store a baseline measurement */
DB.prototype.saveBaseline = function(bs) {
    // baseline row object
    var o = {
        rowid : null,
        env_id : bs.networkenv.env_id, 
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

    if (!bs.load.error && bs.load.result) {
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

    if (o.mem_total == null && !bs.mem.error && bs.mem.result) {
        o.mem_total = bs.mem.result.memtotal; 
        o.mem_used = bs.mem.result.memused;
        o.mem_free = bs.mem.result.memfree;        
    }
    
    if (!bs.wifi.error && bs.wifi.result) {
        o.wifi_signal = bs.wifi.result.signal || null;
        o.wifi_noise = bs.wifi.result.noise || null;
        o.wifi_quality = bs.wifi.result.quality || null;
    }
    
    if (!bs.traffic.error && bs.traffic.result) {
        // traffic counters of the current default interface
        let defiface = _.find(bs.traffic.result, function(r) {
            // netstat -e on windows just gives a single iface counters, assuming it's the default
            return (bs.traffic.os === 'winnt' || r.name === bs.networkenv["default_iface_name"]);
        });
        if (defiface) {
            o.rx = defiface.rx.bytes; 
            o.tx = defiface.tx.bytes;
        }
    }

    if (!bs.rtt.rtt0.error && bs.rtt.rtt0.result && bs.rtt.rtt0.result.stats) {
        o.rtt0 = bs.rtt.rtt0.result.stats.median;
    };
    if (!bs.rtt.rtt1.error && bs.rtt.rtt1.result && bs.rtt.rtt1.result.stats) {
        o.rtt1 = bs.rtt.rtt1.result.stats.median;
    };
    if (!bs.rtt.rtt2.error && bs.rtt.rtt2.result && bs.rtt.rtt2.result.stats) {
        o.rtt2 = bs.rtt.rtt2.result.stats.median;
    };
    if (!bs.rtt.rtt3.error && bs.rtt.rtt3.result && bs.rtt.rtt3.result.stats) {
        o.rtt3 = bs.rtt.rtt3.result.stats.median;
    };
    if (!bs.rtt.rttx.error && bs.rtt.rttx.result && bs.rtt.rttx.result.stats) {
        o.rttx = bs.rtt.rttx.result.stats.median;
    };

    this.saveBaselineRow(o);
};

/** The baseline row save. */
DB.prototype.saveBaselineRow = function(o, cb) {
    if (!this.isConnected()) return;
    var that = this;

    // sliding window index
    var rowid = ss.storage['baseline_idx'];
    o.rowid = (rowid + 1) % config.BASELINE_ROWS[0];

    console.log('baselinedb save row='+o.rowid);

    Task.spawn(function* saveRound() {
        try {
            ss.storage['baseline_idx'] = o.rowid;

            yield that.conn.execute(
                "DELETE FROM baseline WHERE rowid="+o.rowid);

            yield that.conn.executeCached(SQL_INSERT_BASELINE,o);

            if (cb)
                cb(true);

        } catch(err) {
            console.error("baselinedb save error",err);
            ss.storage['baseline_idx'] = rowid;
            if (cb)
                cb(false);
        }
    }); // Task
};

/** Update aggregation tables. */
DB.prototype.baselineAgg = function(ts, cb) {
    if (!this.isConnected()) return;
    var that = this;

    let dbs = ['baseline','agg1','agg2', 'agg3'];

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
            for (var level = 1; level <= 3; level += 1) {

                // 2nd test is a regression bug fix of v2.0.22 ..
                if (!ss.storage['baseline_ts_agg'+level] || (typeof ss.storage['baseline_ts_agg'+level] !== 'number')) {
                    // first aggregation, look for the time of the first sample at level-1
                    var res = yield that.conn.execute('SELECT MIN(ts) AS firstsample FROM '+dbs[level-1]+';');
                    if (res && res.length > 0 && res[0].getResultByName('firstsample') !== null) {
                        ss.storage['baseline_ts_agg'+level] = res[0].getResultByName('firstsample');
                    } else {
                        console.debug('baselinedb nothing to aggregate at level ' + level);
                        continue;
                    }
                }

                console.log("baselinedb handle agg"+level+" since "+ss.storage['baseline_ts_agg'+level]);

                let wstart = ss.storage['baseline_ts_agg'+level];
                let wend = wstart + config.BASELINE_INTERVALS[level]*1000;                
                while (wend < ts) {
                    console.debug("baselinedb handle agg"+level+" window ["+wstart+","+wend+"]");

                    // get one window of data from the previous level's table
                    let aggs = _.map(o, function(v,k) {
                        return "SUM("+k+") AS " + k;
                    }).join(", ");

                    let stmt = "SELECT env_id, COUNT(*) as n, "+aggs+
                        ", MAX(rx) as rx, MAX(tx) as tx, MIN(ts) as wstart, MAX(ts) as wend FROM "+
                        dbs[level-1]+" WHERE ts > " + wstart + " AND " + " ts <= " + wend + " GROUP BY env_id";

                    let rows = yield that.conn.execute(stmt);
                    console.debug("baselinedb got " + rows.length + " rows");

                    for (let i = 0; i < rows.length; i++) {
                        // each result row corresponds to aggregate data
                        // in some environment
                        let row = rows[i];
                        let n = row.getResultByName('n');
                        console.debug("baselinedb " + n + " samples for env=" + row.getResultByName('env_id'));

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
                        oo.ts = row.getResultByName('wstart'); // timestamp at window start

                        let rowid = ss.storage['baseline_idx_agg'+level] + 1;
                        rowid = rowid % config.BASELINE_ROWS[level];
                        oo.rowid = rowid;
                        
                        console.debug("baselinedb",oo);
                        
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
        if (cb) cb(true);
    }); // Task
};

// list of keys to identify a unique environment 
const ENV_ID_KEYS = [
    'default_iface_name', 
    'default_iface_mac', 
    'gateway_ip',
    'gateway_mac',
    'ssid'
];
var env_lookup_query = function(env) {
    var stmt = "SELECT * FROM env WHERE ";
    stmt += _.map(ENV_ID_KEYS, function(k) {
        if (env[k]===null) {
            return k+" IS NULL";
        } else {
            return k+"='"+env[k]+"'";
        }
    }).join(' AND ');
    stmt += ' LIMIT 1';
    return stmt;
};

// list of keys inserted once upon creation
const ENV_CREATE_KEYS = [
    'default_iface_name',
    'default_iface_mac',
    'gateway_ip',
    'gateway_mac', 
    'ssid', 
    'bssid', 
    'hop1_ip', 
    'hop2_ip',
    'hop3_ip',
    'first_seen_ts'
];

// list of keys that are looked up from the db
const ENV_LOOKUP_KEYS = [
    'public_ip',
    'country',
    'city',
    'isp',
    'net_desc',
    'as_number',
    'as_desc',
    'lookup_ts',
    'first_seen_ts',
    'userlabel'
];

/** Update the environment description in the db.*/
DB.prototype.updateEnv = function(env, cb) {
    if (!this.isConnected()) return cb(env);

    var that = this;
    Task.spawn(function* updateEnv() {
        let res = yield that.conn.executeCached(env_lookup_query(env));
        if (!res || res.length == 0) {
            // insert new env to the DB
            env.first_seen_ts = env.ts;     
            var stripped_env = _.pick(env, ENV_CREATE_KEYS);            
            yield that.conn.executeCached(SQL_INSERT_ENV, stripped_env);
            
            res = yield that.conn.executeCached(
                "SELECT last_insert_rowid() AS rowid");
            
            env.env_id = res[0].getResultByName("rowid");
            
            console.debug("baselinedb insert and uppdate env", env);
            
        } else {
            env.env_id = res[0].getResultByName("rowid");
            env.first_seen_ts = res[0].getResultByName("first_seen_ts");     
            env.userlabel = res[0].getResultByName("userlabel");     

            console.debug("baselinedb update env", env);
        }

        yield that.conn.execute(
            "UPDATE env SET public_ip='"+env.public_ip +
            "', country='"+env.country + 
            "', city='"+env.city + 
            "', isp='"+env.isp + 
            "', net_desc='"+env.net_desc + 
            "', as_number='"+env.as_number + 
            "', as_desc='"+env.as_desc + 
            "', lookup_ts="+env.lookup_ts + 
            ", last_seen_ts=" + env.ts +  
            " WHERE rowid="+env.env_id);
                
        // if we get here, return the updated env
        return env;

    }).then(cb, function(err) {
        console.error("baselinedb updateEnv fails",err);
        return cb(error("dbqueryfailed", err)); 
    }); // Task
}

/** Lookup env, and if found extend the env object with db info, else creates and returns env.*/
DB.prototype.lookupEnv = function(env, cb) {
    if (!this.isConnected()) return cb(env);

    var that = this;
    Task.spawn(function* getEnv() {
        let res = yield that.conn.executeCached(env_lookup_query(env));
        if (!res || res.length == 0) {
            // insert new env to the DB
            env.first_seen_ts = env.ts;     
            var stripped_env = _.pick(env, ENV_CREATE_KEYS);            
            yield that.conn.executeCached(SQL_INSERT_ENV, stripped_env);
            
            res = yield that.conn.executeCached(
                "SELECT last_insert_rowid() AS rowid");
            
            env.env_id = res[0].getResultByName("rowid");
            
            console.debug("baselinedb insert and lookup env", env);
            
        } else {
            // already in the database -- update missing values
            env.env_id = res[0].getResultByName("rowid");
            _.each(ENV_LOOKUP_KEYS, function(k) {
                let dbv = res[0].getResultByName(k);
                if (env[k] === null && dbv) {
                    env[k] = dbv;
                }
            });            

            console.debug("baselinedb lookup env", env);
        }
        
        // seen now
        yield that.conn.execute(
            "UPDATE env SET last_seen_ts=" + env.ts + 
            " WHERE rowid=" + env.env_id);
        
        // if we get here, return the updated env
        return env;

    }).then(cb, function(err) {
        console.error("baselinedb loookupEnv fails",err);
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

    var cols = [
        "ts",
        "env_id",
        "first_seen_ts",
        "last_seen_ts",
        "default_iface_name",
        "default_iface_mac",
        "gateway_ip",
        "gateway_mac",
        "ssid",
        "bssid",
        "hop1_ip",
        "hop2_ip",
        "hop3_ip",
        "public_ip",
        "country",
        "city",
        "isp",
        "userlabel",
        "net_desc",
        "as_number",
        "as_desc",
        "lookup_ts"];

    var stmt = "SELECT s.ts as ts, e.rowid as env_id, e.first_seen_ts, e.last_seen_ts, "+
        "e.default_iface_name, e.default_iface_mac, e.gateway_ip, e.gateway_mac, e.ssid, "+
        "e.bssid, e.hop1_ip, e.hop2_ip, e.hop3_ip, e.public_ip, e.country, e.city, e.isp, "+
        "e.userlabel, e.net_desc, e.as_number, e.as_desc, e.lookup_ts FROM "+t+
        ' as s INNER JOIN env as e ON s.env_id = e.rowid ORDER BY s.ts';

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
    if (t !== 'baseline')
        cols.push('samples');

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

