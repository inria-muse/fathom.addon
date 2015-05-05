const timers = require("sdk/timers");
const upload = require("upload");

exports["teststartstop"] = function(assert, done) {
	const upload = require("upload");
    upload.start(function(ok) {
	assert.ok(ok, "start ok");
	upload.stop(function(ok) {
	    assert.ok(ok, "stop ok");
	    done();
	});
    });
};

exports["testadduploadgood"] = function(assert, done) {
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
				}, 'http://localhost:3000');
		    }
		);
    });
};

exports["testadduploadbad"] = function(assert, done) {
    // queue some items to the storage 
    upload.start(function(ok) {
		assert.ok(ok, "start ok");
		upload.addUploadItem(
		    'test',                                 // collection
		    [{'val.ues' : [8,1,1,4], ts : Date.now()},
		     {'val$ues' : [8,1,1,4], ts : Date.now()}], 
		    function(succ) {
				// add done
				assert.ok(succ, "add item(s) ok");

				// req upload
				upload.uploadItems(function(succ) {
				    // upload done
				    assert.ok(succ, "upload item(s) ok");
				    done();
				}, 'http://localhost:3000');
		    }
		);
    });
};


exports["testadduploaddupl"] = function(assert, done) {
    // queue some items to the storage 
    upload.start(function(ok) {
		assert.ok(ok, "start ok");
		upload.addUploadItem(
		    'test',                                 // collection
		    [{'values' : [8,1,1,4], ts : Date.now(), objectid : 1},
		     {'values' : [8,1,1,4], ts : Date.now(), objectid : 1}], 
		    function(succ) {
				// add done
				assert.ok(succ, "add item(s) ok");

				timers.setTimeout(function() {
					// req upload
					upload.uploadItems(function(succ) {
					    // upload done
					    assert.ok(succ, "upload item(s) ok");
					    done();
					}, 'http://localhost:3000');
			    }, 100);
		    }
		);
    });
};


require("sdk/test").run(exports);

