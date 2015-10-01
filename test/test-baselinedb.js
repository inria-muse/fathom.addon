const baselinedb = require("../lib/baselinedb");
var config = require('../lib/config');
const fileIO = require('sdk/io/file');
const ss = require("sdk/simple-storage");
const timers = require('sdk/timers');

exports["test1"] = function(assert, done) {
	var db = new baselinedb.DB();
	var file = db.dbfile.path;
	assert.ok(db!==undefined, 'created');
	assert.ok(db.version < 0, 'schema not created ' + db.version);
	assert.ok(!fileIO.exists(file),'file does not exist');
	assert.ok(!db.isConnected(), 'not connected after create');

	db.connect(function(res) {
		console.log(res);
		assert.ok(fileIO.exists(file),'file exists after connect');
		assert.ok(!res || (res && !res.error), 'connect ok');
		assert.ok(db.isConnected(), 'is connected after connect');
		assert.ok(db.version >= 7, 'schema created ' + db.version);

		db.close();
		assert.ok(!db.isConnected(), 'not connected after close');
		assert.ok(fileIO.isFile(file),'file exists after close');
		db = undefined;

		// test update from 4 to current (will remove the prev version)
		ss.storage['baseline_dbschema'] = 4;
		db = new baselinedb.DB();
		assert.ok(db.version === 4, 'schema ok ' + db.version);
		db.connect(function(res) {
			console.log(res);
			assert.ok(!res || (res && !res.error), 're-connect ok');			
			assert.ok(db.isConnected(), 'is connected after connect');
			assert.ok(db.version >= 7, 'schema ok after update');
			assert.ok(ss.storage['baseline_dbschema'] === db.version, 'schema ok after update');

			db.cleanup();
			assert.ok(!fileIO.exists(file),'file removed');

			done();
		});
	});
};

// insert max num of baseline rows and test that the wrap works
exports["test2"] = function(assert, done) {
	config.BASELINE_ROWS[0] = 20;
	var start = Date.now();

	var db = new baselinedb.DB();
	db.connect(function(res) {
		assert.ok((!res || !res.error), 'no error');

		var next = function() {
			db.getBaselineRange('rtt', 'day', function(res) {
				console.log(res);
				assert.ok(!res.error, 'get baseline no error');
				assert.ok(res.data.length === config.BASELINE_ROWS[0], 'got correct number of baselines ' + res.data.length);
				timers.setTimeout(function() {
					db.close();
					done();
				},0);						
			});
			
		}

		var loop = function(i) {
			var o = {
		        rowid : null,
		        env_id : 1, 
		        ts : start + i * config.BASELINE_INTERVALS[0] * 1000,
		        tasks_total : 10,
		        tasks_running : 1,
		        tasks_sleeping : 9,
		        loadavg_onemin : 1.0,
		        loadavg_fivemin : 1.0,
		        loadavg_fifteenmin : 1.0,
		        cpu_user : 3.0,
		        cpu_system : 1.0,
		        cpu_idle : 96.0,
		        mem_total : 1000000,
		        mem_used : 800000,
		        mem_free : 200000,
		        mem_ff : null,
		        wifi_signal : -79,
		        wifi_noise : -50,
		        wifi_quality : null,
		        rx : 123456,
		        tx : 23456,
		        rtt0 : Math.random()*0.1,
		        rtt1 : Math.random()*1.0,
		        rtt2 : Math.random()*10.0,
		        rtt3 : Math.random()*15.0,
		        rttx : Math.random()*100.0,
		        pageload_total : null,
		        pageload_dns : null,
		        pageload_firstbyte : null, 
		        pageload_total_delay : null, 
		        pageload_dns_delay : null, 
		        pageload_firstbyte_delay : null
		    };
		    db.saveBaselineRow(o, function() {
			    assert.ok((i%config.BASELINE_ROWS[0] === ss.storage['baseline_idx']), 'rowid='+ss.storage['baseline_idx']);
			    if (i < config.BASELINE_ROWS[0]+2) {
				    loop(i+1)
				} else {
					next();
				}
		    });
		}

		loop(0);
	});
};

// insert a window of baselines and test agg1
exports["test3"] = function(assert, done) {
	var start = Date.now();

	var db = new baselinedb.DB();
	db.connect(function(res) {
		assert.ok((!res || !res.error), 'no error on connect');

		var next = function(ts) {
			console.log('agg start');
			db.baselineAgg(ts, function() {
				console.log('agg done');
				db.getBaselineRange('tasks', 'week', function(res) {
					console.log(res);
					assert.ok(!res.error, 'get agg1 no error');
					assert.ok(res.data.length === 1, 'got correct number of agg1 rows: ' + res.data.length);
					assert.ok(res.data[0].samples === 5, 'got correct number of samples: ' + res.data[0].samples);
					assert.ok(res.data[0].tasks_total === 10, 'got correct tasks_total agg value: ' + res.data[0].tasks_total);

					db.getBaselineRange('tasks', 'month', function(res) {
						console.log(res);
						assert.ok(!res.error, 'get agg2 no error');
						assert.ok(res.data.length === 0, 'got correct number of agg2 rows: ' + res.data.length);
						timers.setTimeout(function() {
							db.close();
							done();
						},0);						
					});
				});
			});
		}

		var loop = function(i) {
			var o = {
		        rowid : null,
		        env_id : 1, 
		        ts : start + i * config.BASELINE_INTERVALS[0] * 1000, // fake timestamp
		        tasks_total : 10,
		        tasks_running : 1,
		        tasks_sleeping : 9,
		        loadavg_onemin : 1.0,
		        loadavg_fivemin : 1.0,
		        loadavg_fifteenmin : 1.0,
		        cpu_user : 3.0,
		        cpu_system : 1.0,
		        cpu_idle : 96.0,
		        mem_total : 1000000,
		        mem_used : 800000,
		        mem_free : 200000,
		        mem_ff : null,
		        wifi_signal : -79,
		        wifi_noise : -50,
		        wifi_quality : null,
		        rx : 123456,
		        tx : 23456,
		        rtt0 : Math.random()*0.1,
		        rtt1 : Math.random()*1.0,
		        rtt2 : Math.random()*10.0,
		        rtt3 : Math.random()*15.0,
		        rttx : Math.random()*100.0,
		        pageload_total : null,
		        pageload_dns : null,
		        pageload_firstbyte : null, 
		        pageload_total_delay : null, 
		        pageload_dns_delay : null, 
		        pageload_firstbyte_delay : null
		    };

		    db.saveBaselineRow(o, function() {
			    if (i <= 5) {
				    loop(i+1)
				} else {
					next(o.ts);
				}
		    });
		}

		loop(0);
	});
};


require("sdk/test").run(exports);
