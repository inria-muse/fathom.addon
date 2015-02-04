const upload = require("./upload");
const timers = require("sdk/timers");

exports["teststartstop"] = function(assert, done) {
    upload.start(function(ok) {
	assert.ok(ok, "start ok");
	upload.stop(function(ok) {
	    assert.ok(ok, "stop ok");
	    done();
	});
    });
};

exports["testaddupload"] = function(assert, done) {
    // queue some items to the storage 
    upload.start(function(ok) {
	assert.ok(ok, "start ok");
	upload.addUploadItem(
	    'test',                                 // collection
	    [{values : [1,2,3,4], ts : Date.now()}, // data
	     {values : [8,2,2,4], ts : Date.now()}], 
	    function(succ) {
		// add done
		assert.ok(succ, "add item(s) ok");

		// req upload
		upload.uploadItems(function(succ) {
		    // upload done
		    assert.ok(succ, "upload item(s) ok");
		    done();
		});
	    }
	);
    });
};

require("sdk/test").run(exports);

