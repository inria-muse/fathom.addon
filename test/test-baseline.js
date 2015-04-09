var baseline = require("./baselineapi");
var timers = require("sdk/timers");

require('./systemapi').setup();
baseline.setup();

exports["testnetworkbasic"] = function(assert, done) {
    baseline.getnetworkenv(function(res) {
		console.log(JSON.stringify(res));
		assert.ok(!res.error, "no error");
		done();	
    });
};

exports["testnetworkfull"] = function(assert, done) {
    baseline.start();
    // delay so that the DB connection is up
    timers.setTimeout(function() {
		baseline.getnetworkenv(function(res) {
		    console.log(JSON.stringify(res));
		    assert.ok(!res.error, "no error");
			baseline.getnetworkenv(function(res) {
			    console.log(JSON.stringify(res));
			    assert.ok(!res.error, "no error");
			    assert.ok(res.cached, "got cached on 2nd req");
		    	baseline.stop();
			    done();	
			});
		});
    },15);
};

exports["testmeasurements"] = function(assert, done) {
    baseline.domeasurements(function(res) {
		console.log(JSON.stringify(res, null, 4));
		assert.ok(!res.error, "no error");
		done();	
    });
};

exports["testexecday1"] = function(assert, done) {
    baseline.start();
    timers.setTimeout(function() {
		baseline.exec(function(res) {
		    assert.ok(!res.error, "no error");
		    assert.ok(res.data.length>0, "got data " + res.data.length);
		    if (res.data.length>0)
			console.log(res.data[0]);
		    baseline.stop();
		    done();	
		}, { method : 'get', params : ['cpu','day']});
    }, 15);
};

exports["testexecday2"] = function(assert, done) {
    baseline.start();
    timers.setTimeout(function() {
	    baseline.exec(function(res) {
			assert.ok(!res.error, "no error");
			assert.ok(res.data.length>0, "got data " + res.data.length);
			if (res.data.length>0)
			    console.log(res.data[0]);
			baseline.stop();
			done();	
	    }, { method : 'get', params : [['cpu','load'],'day']});
    }, 15);
};

exports["testexecweek"] = function(assert, done) {
    baseline.start();
    timers.setTimeout(function() {
	    baseline.exec(function(res) {
			assert.ok(!res.error, "no error");
			assert.ok(res.data.length>0, "got data " + res.data.length);
			if (res.data.length>0)
			    console.log(res.data[0]);
			baseline.stop();
			done();	
	    }, { method : 'get', params : ['cpu','week']});
    }, 15);
};

exports["testexecenv"] = function(assert, done) {
    baseline.start();
    timers.setTimeout(function() {
	    baseline.exec(function(res) {
			assert.ok(!res.error, "no error");
			assert.ok(res.data.length>0, "got data " + res.data.length);
			if (res.data.length>0)
			    console.log(res.data[0]);
			baseline.stop();
			done();	
	    }, { method : 'get', params : ['env', 'day']});
    }, 15);
};

require("sdk/test").run(exports);
