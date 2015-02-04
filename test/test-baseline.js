var baseline = require("./baselineapi");

exports["testmeasurements"] = function(assert, done) {
    baseline.domeasurements(function(res) {
	console.log(res);
	assert.ok(!res.error, "no error");
	done();	
    });
};

exports["testexecday"] = function(assert, done) {
    baseline.exec(function(res) {
	assert.ok(!res.error, "no error");
	assert.ok(res.data.length>0, "got data " + res.data.length);
	if (res.data.length>0)
	    console.log(res.data[0]);
	done();	
    }, { method : 'get', params : ['cpu','day']});
};


exports["testexecday2"] = function(assert, done) {
    baseline.exec(function(res) {
	assert.ok(!res.error, "no error");
	assert.ok(res.data.length>0, "got data " + res.data.length);
	if (res.data.length>0)
	    console.log(res.data[0]);
	done();	
    }, { method : 'get', params : [['cpu','load'],'day']});
};


exports["testexecweek"] = function(assert, done) {
    baseline.exec(function(res) {
	assert.ok(!res.error, "no error");
	assert.ok(res.data.length>0, "got data " + res.data.length);
	if (res.data.length>0)
	    console.log(res.data[0]);
	done();	
    }, { method : 'get', params : ['cpu','week']});
};

exports["testexecenv"] = function(assert, done) {
    baseline.exec(function(res) {
	assert.ok(!res.error, "no error");
	assert.ok(res.data.length>0, "got data " + res.data.length);
	if (res.data.length>0)
	    console.log(res.data[0]);
	done();	
    }, { method : 'get', params : ['env', 'day']});
};

require("sdk/test").run(exports);
