var timers = require("sdk/timers");
var sysapi = require('../lib/systemapi');
sysapi.start();

exports["testmeasurements1"] = function(assert, done) {
    var baseline = require("../lib/baselineapi");
    baseline.domeasurements(function(res) {
		console.log(JSON.stringify(res, null, 4));
		console.log(JSON.stringify(res.rtt, null, 4));
		assert.ok(!res.error, "no error");
		assert.ok(!res.traceroute.error, "no traceroute error");
		done();	
    }, new Date(), 1);
};

exports["testmeasurements2"] = function(assert, done) {
    var baseline = require("../lib/baselineapi");
    baseline.domeasurements(function(res) {
		console.log(JSON.stringify(res, null, 4));
		console.log(JSON.stringify(res.traceroute, null, 4));
		assert.ok(!res.error, "no error");
		assert.ok(res.traceroute.error, "traceroute not run");
		done();	
    }, new Date(), 2);
};

exports["testexecday1"] = function(assert, done) {
    var baseline = require("../lib/baselineapi");
    timers.setTimeout(function() {
		baseline.exec(function(res) {
		    assert.ok(!res.error, "no error");
		    assert.ok(res.data.length>0, "got data " + res.data.length);
		    if (res.data.length>0)
			    console.log(res.data[0]);
		    done();	
		}, { method : 'get', params : ['cpu','day']});
    }, 15);
};

require("sdk/test").run(exports);