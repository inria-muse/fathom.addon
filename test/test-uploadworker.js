const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);
const self = require("sdk/self");

exports["testWorker"] = function(assert, done) {
    var wscript = self.data.url("workerscripts/uploadworker.js");
    uploadworker = new ChromeWorker(wscript);

    uploadworker.onerror = function(event) {
	console.log("Uploadworker error: " + JSON.stringify(event));
	uploadworker.terminate();
	assert.ok(false, "upload fails");
	done();
    };

    uploadworker.onmessage = function(event) {
	console.log("msg: " + event.data);
	var msg = JSON.parse(event.data);
	uploadworker.terminate();
	assert.ok(!msg.error, "uploaded");
	done();
    };

    var obj = { 'url' : 'http://localhost:3001',
		'data' : [
		    { 
			'collection' : 'test',
			'uuid' : 'foobar',
			'objectid' : 1,
			'values' : [1,2,3,4]
	            }
		]
	      };

    uploadworker.postMessage(JSON.stringify(obj));
};

require("sdk/test").run(exports);
