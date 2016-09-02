/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
   */

/**
 * @fileoverfiew Data upload modules.
 *
 * Uses IndexedDB to queue data locally. Actual uploads are handled  
 * asynchronously by a background web worker at a low interval.
 *
 * FF37 should add IndexedDB API to worker threads. We should move
 * majority of the functionality here to a separate worker ?
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
const consts = require('./consts');
const utils = require('./utils');
const fathom = require('./fathom');
const env = require('./env');

const wscript = self.data.url("workerscripts/uploadworker.js");

// IndexedDB handle
var db = undefined;

var uploadtimer = undefined;
var backoffCounter = 1.0;

/** Start background uploads. */
var start = exports.start = function(reason) {
    console.log("upload start " + reason);

    ss.storage['upload'] = {
        'last_stats_ts' : new Date(), // last usage stats upload 
        'total' : 0,                  // number of items added so far
        'queue_size' : 0,             // current upload queue size
        'queue_last_ts' : null,       // time of last item queued
        'queue_last_status' : 'na',   // status (full|succ|fail|running)
        'upload_count' : 0,           // number of time we have tried to upload
        'upload_skip' : 0,            // - skipped due to fathom busy etc
        'upload_succ' : 0,            // - succ uploads
        'upload_fail' : 0,            // - failures
        'upload_items' : 0,           // number of items uploaded so far
        'upload_bytes' : 0,           // number of bytes uploaded so far
        'upload_next_ts' : null,      // next upload
        'upload_last_ts' : null,      // last upload
        'upload_last_status' : 'na',  // status (skip|succ|fail)
        'upload_last_items' : 0,      // objects uploaded
        'upload_last_bytes' : 0       // bytes uploaded
    }

    var request = indexedDB.open("FathomUploadQueue", 1);

    request.onerror = function(event) {
        console.error("upload database open onerror: " + event.target.errorCode);
    };

    request.onupgradeneeded = function(event) {
        // called if the DB is not created yet or version has changed
        var tmpdb = event.target.result;
        var objectStore = tmpdb.createObjectStore("uploads", { 
            autoIncrement: false,
            keyPath: 'objectid'
        });
    };

    request.onsuccess = function(event) {
        db = event.target.result;
        db.onerror = function(event) {
            console.warn('upload db error', event);
        };
        schedNext(true, true);
    };
};

/** Stop background uploads. */
var stop = exports.stop = function() {
    if (uploadtimer)
        timers.clearTimeout(uploadtimer);
    uploadtimer = undefined;
    db = undefined;
};

/* Schedule next upload. If backoff == true, do exponential backoff else
 * use the configured default interval (with some randomization).
 */
var schedNext = function(backoff, first) {
    var cfg = config.get("upload");
    if (first)
        backoffCounter = 0.01;
    else if (!backoff || backoffCounter > 100.0) // reset at somepoint ..
        backoffCounter = 1.0;
    else
        backoffCounter += 1.0;

    // next upload within [delay, delay + rand] seconds
    var rand = Math.random()*1.0;
    var next = Math.round(backoffCounter*cfg['interval'] + rand*cfg['interval']);
    ss.storage['upload']['upload_next_ts'] = new Date(Date.now() + next*1000);
    uploadtimer = timers.setTimeout(function() { uploadTimerTask(); }, next*1000);
};

/** The upload timer task. */
var uploadTimerTask = function() {
    uploadItems(function(succ) {
        schedNext(!succ);
    });
};

/**
 * Upload items from the queue.
 */
var uploadItems = exports.uploadItems = function(cb, url) {
    if (!db) {
        console.error('upload uploadItems: db is not available');
        if (cb) cb(false);
        return;
    };

    var ts = new Date();
    var cfg = config.get('upload');
    var uploadurl = url || cfg['url'];
    if (uploadtimer)
        timers.clearTimeout(uploadtimer);

    console.log('upload items to ' + uploadurl);

    // make sure this is initialized
    if (!ss.storage['upload']['last_stats_ts'])
        ss.storage['upload']['last_stats_ts'] = ts;

    // upload usage stats every couple of days
    if (((ts.getTime() - 
      new Date(ss.storage['upload']['last_stats_ts']).getTime()) > 
       Math.floor((Math.random()*5)+1)*24*60*60*1000)) 
    {
        addUploadItem("fathomstats", {
            ts : ts.getTime(),
            timezoneoffset : ts.getTimezoneOffset(), 
            action : "stats",
            stats : {
                'fathom' : ss.storage['fathom'],
                'security' : ss.storage['security'],
                'baseline' : ss.storage['baseline'],
                'upload' : ss.storage['upload']
            }
        });
        ss.storage['upload']['last_stats_ts'] = ts;
    }

    // this run stats
    ss.storage['upload']['upload_count'] += 1;
    ss.storage['upload']['upload_last_ts'] = ts;
    ss.storage['upload']['upload_last_items'] = 0;
    ss.storage['upload']['upload_last_bytes'] = 0;
    ss.storage['upload']['upload_last_status'] = 'running';

    // TODO: can we know if the user is active in general, not just fathom?
    if (!fathom.allowBackgroundTask()) {
            ss.storage['upload']['upload_last_status'] = 'skip';
            ss.storage['upload']['upload_skip'] += 1;
        if (cb) cb(false);
        return false;
    }

    var uploadworker = undefined;
    var done = function(succ) {
        if (uploadworker)
            uploadworker.terminate();
        uploadworker = undefined;

        if (succ) {
            ss.storage['upload']['upload_succ'] += 1;
            ss.storage['upload']['upload_last_status'] = 'succ';
        } else {
            ss.storage['upload']['upload_fail'] += 1;
            ss.storage['upload']['upload_last_status'] = 'fail';
        }
        if (cb) cb(succ);
        return succ;
    };

    // FIXME: starting from FF37 we should be able to access 
    // the indexedDB in the worker thread !
    var batch = [];
    var counter = 0;
    function fetchloop() {
        batch = []; // reset

        var store = db.transaction(["uploads"],"readwrite").objectStore("uploads");        
        store.openCursor().onsuccess = function(event) {
            var cursor = event.target.result;
            if (cursor && batch.length < cfg['max_batch']) {
                var o = cursor.value;
                o.uploadts = ts.getTime();
                batch.push(o);
                cursor.continue();

            } else if (batch.length>0) {        
                // batch ready, send to the worker
                counter += 1;
                console.log("upload batch" + counter + " " + 
                            batch.length + " items");

                uploadworker.postMessage(JSON.stringify({
                    url : uploadurl, 
                    data : batch }));
            } else {
                // no more objects found - we're done
                return done(true);
            }
        };
    }; // fetchloop

    // worker thread
    uploadworker = new ChromeWorker(wscript);

    uploadworker.onerror = function(event) {
        console.warn("upload worker error",event);
        return done(false);
    };

    uploadworker.onmessage = function(event) {
        var msg = JSON.parse(event.data);
        if (msg.error) {
            console.warn("upload worker error",msg);
            return done(false);
        }

        ss.storage['upload']['upload_bytes'] += msg.bytes;
        ss.storage['upload']['upload_last_bytes'] += msg.bytes;

        // remove all uploaded objs from the queue
        _.each(batch,function(obj) {
            db.transaction(["uploads"],"readwrite")
            .objectStore("uploads")
            .delete(obj.objectid)
            .onsuccess = function(event) {
                ss.storage['upload']['upload_items'] += 1;
                ss.storage['upload']['upload_last_items'] += 1;
                ss.storage['upload']['queue_size'] -= 1;
                if (ss.storage['upload']['queue_size']<0)
                    ss.storage['upload']['queue_size'] = 0;
            };
        });

        // continue fetching
        fetchloop();
    };

    fetchloop();
};

/** Empty the upload queue. */
var purgeUploadItems = exports.purgeUploadItems = function(cb) {
    if (!db) {
        console.error('upload purgeUploadItems: db is not available');
        if (cb) cb(false);
        return;
    }

    // FIXME: apparently this is not the most efficient way ..
    var store = db.transaction(["uploads"],"readwrite").objectStore("uploads");
    store.openCursor().onsuccess = function(event) {
        var cursor = event.target.result;
        if (cursor) {
            var o = cursor.value;
            store.delete(o.objectid);
            cursor.continue();
        } else {
            ss.storage['upload']['queue_size'] = 0;
            if (cb) cb(true);
        }
    };
};

/** Queue new item(s) for uploading. Assumes that the user consent
 * is already handled and no more checks are needed.
 */
var addUploadItem = exports.addUploadItem = function(collection, objs, cb) {
    var cfg = config.get('upload');
    console.log('add stuff to ' + collection);
    if (!cfg['enable']) {
        // uploads turned off by configuration
        if (cb) cb(false);
        return;
    }

    if (!db) {
        console.error('upload addUploadItem: db is not available');
        if (cb) cb(false);
        return;
    } else if (!collection) {
        console.error('upload addUploadItem: no collection');
        if (cb) cb(false);
        return;
    } else if (!objs || objs.length == 0) {
        console.error('upload addUploadItem: nothing to upload');
        if (cb) cb(false);
        return;
    }

    if (!_.isArray(objs)) objs = [objs];

    var ts = new Date();
    ss.storage['upload']['queue_last_ts'] = ts;
    if (ss.storage['upload']['queue_size'] >= cfg['max_queue']) {
        // max number of items in queue already, do not add more
        console.warn('upload addUploadItem: upload queue is full!!');
        ss.storage['upload']['queue_last_status'] = 'full';
        // FIXME: could remove older items to make space for the new ?
        if (cb) cb(false);
        return;
    }

    var addall = function(env) {
        // open a db transaction
        var store = db.transaction(["uploads"],"readwrite").objectStore("uploads");
        
        var loop = function() {
            if (!objs || objs.length == 0) { 
                // done
                ss.storage['upload']['queue_last_status'] = 'succ';
                if (cb) cb(true);
                return;

            } else if (ss.storage['upload']['queue_size'] >= cfg['max_queue']) {
                // max number of items in queue, do not add more
                console.warn('upload addUploadItem: upload queue is full!!');
                ss.storage['upload']['queue_last_status'] = 'full';
                if (cb) cb(false);
                return;
            }

            var o = objs.shift();
            if (!o.networkenv) {
                o.networkenv = env;           // current network
            }
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

            var req = store.add(o);
            req.onsuccess = function(event) {
                ss.storage['upload']['queue_size'] += 1;
                ss.storage['upload']['total'] += 1;
                loop();
            };
            req.onerror = function(event) {
                console.warn('upload addUploadItem: add error',event);
                loop();
            };
        }; // end loop

        loop();
    }; // addall

    // check if we need to resolve current env to avoid overhead
    var hasenv = _.every(objs, function(o) {
        return (o.networkenv && true);
    });

    if (hasenv) {
        addall();
    } else {
        // missing networkenv - resolve first 
        env.getnetworkenvp().then(function(env) {
            addall(env);
        }).then(null, function(err) {
            console.warn('upload addUploadItem: env lookup error', err);            
            if (cb) cb(false);            
        });
    }
};