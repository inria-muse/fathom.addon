/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Data upload modules.
 *
 * Uses IndexedDB to queue data locally. Actual uploads are handled  
 * asynchronously by a background web worker at a low interval.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");
const {ChromeWorker} = Cu.import("resource://gre/modules/Services.jsm", null);
const {indexedDB} = require('sdk/indexed-db');
const ss = require("sdk/simple-storage");
const self = require("sdk/self");
const system = require("sdk/system");
const timers = require("sdk/timers");

const _ = require("underscore");

const config = require('./config');
const utils = require('./utils');
const fathom = require('./fathom');
const tools = require('./toolsapi');

const wscript = self.data.url("workerscripts/uploadworker.js");

/** Start background uploads. */
var db = undefined;
var start = exports.start = function(cb) {
    var request = indexedDB.open("FathomUploadQueue", 1);
    request.onerror = function(event) {
	console.error("Database open error: " + event.target.errorCode);
	if (cb) cb(false);
    };

    request.onupgradeneeded = function(event) {
	console.info('Init FathomUploadQueue');

	// called if the DB is not created yet or version has changed
	var db = event.target.result;
    
	// Create an objectStore for this database
	var objectStore = db.createObjectStore("uploads", { 
	    autoIncrement: false,
	    keyPath: 'objectid'
	});
    };

    request.onsuccess = function(event) {
	console.debug('FathomUploadQueue open');	
	db = event.target.result;
	db.onerror = function(event) {
	    console.error("Database request error: " + event.target.errorCode);
	};    
	timers.setTimeout(schedNext,0);
	if (cb) cb(true);
    };
};

/** Stop background uploads. */
var stop = exports.stop = function(cb) {
    if (uploadtimer)
	timers.clearTimeout(uploadtimer);
    uploadtimer = undefined;
    if (cb) cb(true);
};

/* Schedule next upload. If backoff == true, do exponential backoff else
 * use the configured default interval (with some randomization).
 */
var uploadtimer = undefined;
var backoffCounter = 1;
var schedNext = function(backoff) {
    if (!backoff)
	backoffCounter = 1;  // reset
    else
	backoffCounter += 1; // increase the size of the rand window

    // next upload within [delay, delay + rand] minutes
    var rand = Math.random();
    var next = Math.round(config.UPLOAD_INTERVAL*1.0 + 
			  backoffCounter*config.UPLOAD_INTERVAL*rand);
    console.debug("next upload in " + next/60.0 + " minutes");

    uploadtimer = timers.setTimeout(function() {
	uploadtimer = undefined;
	uploadItems();
    }, next*1000);
};

/**
 * Upload all queued items. Runs periodically or upon request (resets timer). 
 */
var uploadItems = exports.uploadItems = function(cb) {
    var ts = new Date();

    // usage stats check
    if (ss.storage['uploadts'] && 
	((ts.getTime() - ss.storage['uploadts']) > 
	 Math.floor((Math.random()*5)+1)*24*60*60*1000)) 
    {
	// upload some usage stats every couple of days
	console.log("upload queue usage stats");
	upload.addUploadItem("fathomstats", {
	    ts : ts.getTime(),
	    timezoneoffset : ts.getTimezoneOffset(), 
	    action : "stats",
	    stats : {
		fathom_installed : ss.storage['installed'],
		fathom_debugtool : ss.storage['fathom_debugtool'],
		fathom_debugtool_onerror : ss.storage['fathom_debugtool_onerror'],
		fathom_homenet : ss.storage['fathom_homenet'],
		fathom_monitoring : ss.storage['fathom_monitoring'],
		fathom_webpage : ss.storage['fathom_webpage'],
		fathom_webpage_na : ss.storage['fathom_webpage_na'],
		fathom_baselines : ss.storage['fathom_baselines'],
		fathom_uploaded_items : ss.storage['fathom_uploaded_items'],
		fathom_uploads : ss.storage['fathom_uploads'],
		fathom_failed_uploads : ss.storage['fathom_failed_uploads']
	    }
	});
    }

    ss.storage['uploadts'] = ts.getTime();

    if (uploadtimer) {
	// reset current timer
	timers.clearTimeout(uploadtimer);
	uploadtimer = undefined;
    }

    var done = function(succ) {
	if (succ)
	    ss.storage['fathom_failed_uploads'] += 1;
	else
	    ss.storage['fathom_uploads'] += 1;
	ss.storage['uploadstatus'] = (succ ? 'succ' : 'fail');
	schedNext(!succ); // trigger backoff on errors
	if (cb) cb(succ);
	return undefined;
    };

    // TODO: can we know if the user is active in general, not just fathom?
    if (!fathom.allowBackgroundTask()) {
	console.debug("upload items not run, somebody is using fathom");
	return done(false);
    }

    console.debug("upload start uploading items");
    var batch = [];

    // FIXME: starting from FF37 we should be able to access 
    // the indexedDB in the worker thread !
    function fetchloop() {
	batch = [];
	var store = db.transaction(["uploads"],
				   "readwrite").objectStore("uploads");
	store.openCursor().onsuccess = function(event) {
	    var cursor = event.target.result;
	    if (cursor && batch.length < config.UPLOAD_MAX_BATCH) {
		// fetch up to MAX_BATCH items from DB
		var o = cursor.value;
		o.uploadts = ts.getTime();
		batch.push(o);
		cursor.continue();
	    } else if (batch.length>0) {	    
		// batch ready, send to the worker
		uploadworker.postMessage(JSON.stringify({
		    url : config.UPLOAD_URL, 
		    data : batch}));
	    } else {
		// no more objects found - we're done
		return done(true);
	    }
	};
    }; // fetchloop

    // worker thread
    var uploadworker = new ChromeWorker(wscript);
    uploadworker.onerror = function(event) {
	console.warn("Uploadworker error",event);
	uploadworker.terminate();
	return done(false);
    };

    uploadworker.onmessage = function(event) {
	uploadworker.terminate();
	var msg = JSON.parse(event.data);
	if (msg.error) {
	    console.warn("Uploadworker error",event.data);
	    return done(false);
	}

	// remove all uploaded objs from the queue
	_.each(batch,function(obj) {
	    db.transaction(["uploads"],"readwrite")
		.objectStore("uploads")
                .delete(obj.objectid)
		.onsuccess = function(event) {
		    // It's gone!
		    ss.storage['fathom_uploaded_items'] += 1;
		};
	});

	// continue fetching
	fetchloop();
    };

    // first iteration
	if (!config.UPLOAD_DISABLE)
      fetchloop();
};

/** Queue new item(s) for uploading. Assumes that the user consent
 * is already handled and no more checks are needed.
 */
var addUploadItem = exports.addUploadItem = function(collection, objs, cb) {
    var ts = new Date();
    if (!db || !collection || !objs) {
	console.error('addUploadItem: db not available or missing parameters');
	if (cb) cb(false);
	return;
    }
    if (!_.isArray(objs)) objs = [objs];

    // resolve network environment
    tools.getnetworkenv(function(env) {
	// open a db transaction
	var store = db.transaction(["uploads"],
				   "readwrite").objectStore("uploads");

	// check the current queue size
	store.count().onsuccess = function(event) {
	    if (event.target.result >= config.UPLOAD_MAX_QUEUE) {
		// max number of items in queue already, do not add more
		console.error('addUploadItem: upload queue is full!!');
		// FIXME: could remove older items to make space for the new ?
		if (cb) cb(false);
		return;
	    }

	    var loop = function() {
		if (!objs || objs.length == 0) { 
		    // done
		    if (cb) cb(true);
		    return;
		}

		var o = objs.shift();
		if (!o.networkenv)
		    o.networkenv = env;           // current network
		o.queuets = ts.getTime();         // timestamp
		o.collection = collection;        // target db collection
		o.fathomversion = self.version;   // fathom version
	    
		o.platform = system.platform;     // os + other sys info
		o.system_architecture = system.architecture;
		o.system_name = system.name;
		o.system_vendor = system.vendor;
		o.system_version = system.version;
		o.system_platform_version = system.platform_version;

		// uuid + objectid form the unique ID of this object in
		// the collection, so make sure we have them
		o.uuid = ss.storage['uuid'];      // user id
		if (!o.objectid)
		    o.objectid = utils.generateUUID(new Date().getTime());
		
		console.debug("upload queue object",o);
		store.add(o).onsuccess = function(event) {
		    console.debug("addUploadItem: objectid="+
				  event.target.result);
		    loop();
		};
	    }; // end loop
	    loop();
	}; // count
    }); // getenv
};
