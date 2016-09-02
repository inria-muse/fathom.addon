const timers = require("sdk/timers");
const upload = require("../lib/upload");

const ss = require("sdk/simple-storage");
ss.storage['uuid'] = 'testscript-dev';

//const HOST = 'http://localhost:3000';
const HOST = 'http://muse2.paris.inria.fr/fathomupload';

exports["teststartstop"] = function(assert, done) {
    upload.start();
    timers.setTimeout(function() {
		upload.stop();
		assert.ok(true, "start-stop ok");
		done();
	}, 1000);
};

exports["testadduploadgood"] = function(assert, done) {
    // queue some items to the storage 
    console.log('test uplaod to ' + HOST);
    upload.start();
    timers.setTimeout(function() {
		console.log('add items');
		upload.addUploadItem(
		    'test',                                 // collection
		    [{values : [1,2,3,4], ts : Date.now()}, // data
		     {values : [8,2,2,4], ts : Date.now()}], 
		    function(succ) {
				// add done
				console.log('add items: ' + succ);
				assert.ok(succ, "add item(s) ok");

				// req upload
				upload.uploadItems(function(succ) {
				    // upload done
					console.log('upload items: ' + succ);
				    assert.ok(succ, "upload item(s) ok");
				    done();
				}, HOST);
		    }
		);
    }, 1000);
};

exports["testadduploadbad"] = function(assert, done) {
    // queue some items to the storage 
    upload.start();
    timers.setTimeout(function() {
		upload.addUploadItem(
		    'test',                                 // collection
		    [{'val.ues' : [8,1,1,4], ts : Date.now()},
		     {'val$ues' : [8,1,1,4], ts : Date.now()},
		     {'values' : [{ 'asd$' : 1},1,1,4], ts : Date.now()}], 
		    function(succ) {
				// add done
				assert.ok(succ, "add item(s) ok");

				// req upload
				upload.uploadItems(function(succ) {
				    // upload done
				    assert.ok(succ, "upload item(s) ok");
				    done();
				}, HOST);
		    }
		);
    }, 1000);
};


exports["testadduploaddupl"] = function(assert, done) {
    // queue some items to the storage 
    upload.start();
    setTimeout(function() {
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
					}, HOST);
			    }, 100);
		    }
		);
    }, 1000);
};


require("sdk/test").run(exports);

