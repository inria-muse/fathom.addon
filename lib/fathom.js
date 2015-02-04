/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The main Fathom addon code.
 *
 * This file gets evaluated only if the add-on is enabled, so we do not need
 * any special checks for that. 
 *
 * We do not ask for private-browsing permission in package.json, so 
 * the page_mod does not attach any fathom scripts to private browsing pages. 
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const self = require("sdk/self");
const system = require("sdk/system");
const pageMod = require("sdk/page-mod");
const tabs = require("sdk/tabs");
const ss = require("sdk/simple-storage");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;
const _ = require('underscore');

// set debug logging on
var devmode = system.staticArgs.dev || false;
if (devmode) {
    let name = "extensions."+self.id+".sdk.console.logLevel";
    require("sdk/preferences/service").set(name, "all");
}
console.info("loading " + self.name + " addon v=" + self.version + 
	     " devmode=" + devmode);

// addon modules
const {error, FathomException} = require("error");
const config = require("config");
const sec = require("security");
const upload = require("upload");
const dialogs = require('ui/dialogs');

const baselineapi = require("baselineapi");
const systemapi = require("systemapi");
const socketapi = require("socketapi");
const protoapi = require("protoapi");
const toolsapi = require("toolsapi");

const apilist = [systemapi, socketapi, protoapi, baselineapi, toolsapi];

// Worker messaging constants
const REQ = "req";
const RES = "res";
const UPLOADREQ = "uploaddata";
const PREFREQ = "userpref";

// Resource string consts
const DEBUGURL = self.data.url("tools/debugtool.html");
const WELCOMEURL = self.data.url("welcome.html");
const JQUERYJSURL = self.data.url("scripts/ext/jquery.min.js");
const WELCOMEJSURL = self.data.url("contentscripts/welcome.js");
const MAINJSURL = self.data.url("contentscripts/main.js");
const APIJSURL = self.data.url("contentscripts/api.js");
const ERRORJSURL = self.data.url("contentscripts/error.js");

if (!ss.storage['uuid']) {
    // create unique identifier for this Fathom installation
    // used as the identifier of uploaded data (and can be used
    // by the user to request access to his/her data and its 
    // removal)
    let uuid = require('sdk/util/uuid').uuid().toString();
    uuid = uuid.replace('{','');
    uuid = uuid.replace('}','');
    if (devmode)
	uuid += '-dev';
    ss.storage['uuid'] = uuid;
    console.info("generated uuid " + ss.storage['uuid']);

    // 2nd uuid used as the public node ID upon Fathom 
    // node discovery and API calls
    let uuid2 = require('sdk/util/uuid').uuid().toString();
    uuid2 = uuid2.replace('{','');
    uuid2 = uuid2.replace('}','');
    ss.storage['public_uuid'] = uuid2;
    console.info("generated public_uuid " + ss.storage['public_uuid']);
}

// Page workers that are using Fathom APIs
var pageworkers = {};

/** Send a response to the content-script. */
var sendresp = function(worker, req, data, done) {
    if (done === undefined)
	done = true;

    var res = {
	id : req.id, 
	data : data, // data object or object with error field if fails
	done : done
    }
    worker.port.emit(RES, res);
    return true;
};

/** Handle API request from the content-script. */
var handlereq = function(worker) {
    // unique id of this worker
    var winid = worker.tab.id;
    console.info("new worker, id=" + winid + ", title="+worker.tab.title
		+ ", url=" + worker.tab.url);

    worker.on('detach', function () {
	// tab is closing
	console.info("worker detach, id=" + winid);
	if (pageworkers[winid]) {
	    // cleanup sockets if not done using close
	    if (socketapi)
		socketapi.windowclose(winid);
	    delete pageworkers[winid];
	}
    });

    // actual handler
    return function(req) {	
	var manifest = undefined;

	if (req.module === 'init') {
	    // page requests access to the fathom API
	    console.info("init called by " + worker.tab.url +
			 " isaddon=" + req.params.isaddon +
			 " windowid=" + winid);

	    // parse and validate the requested manifest
	    manifest = sec.parseManifest(req.params);
	    if (manifest.error) {
		// problem with the manifest
		return sendresp(worker, req, manifest, true);
	    }

	    // window information
	    manifest.winid = winid;
	    manifest.taburl = worker.tab.url;
	    manifest.tabtitle = worker.tab.title;

	    var handleuserres = function(userok) {
		if (!userok) {
		    ss.storage['fathom_webpage_na'] += 1;
		    return sendresp(worker, 
				    req, 
				    {error : "user declined the manifest"}, 
				    true);
		}

		pageworkers[winid] = {
		    manifest : manifest,
		    created : new Date().getTime()
		};

		return sendresp(worker, 
				req, 
				{ manifest : manifest}, 
				true);
	    };
	
	    if (!manifest.isaddon) {
		ss.storage['fathom_webpage'] += 1;

		// webpage is requesting fathom privilegies - ask the user
		dialogs.showSecurityDialog(handleuserres, manifest);

	    } else {
		if (manifest.taburl.indexOf('monitoring.html')>0)
		    ss.storage['fathom_monitoring'] += 1;
		if (manifest.taburl.indexOf('debugtool.html')>0)
		    ss.storage['fathom_debugtool'] += 1;
		if (manifest.taburl.indexOf('homenet.html')>0)
		    ss.storage['fathom_homenet'] += 1;

		// no security dialog on addon pages - always allow
		handleuserres(true);
	    }

	} else if (req.module === 'close' && pageworkers[winid]) {
	    // Close: cleanup any resources used by the window
	    manifest = pageworkers[winid].manifest;
	    console.info("'close' called by window=" + winid + 
			 ", reqid=" + req.id + 
			 ", isaddon="+manifest.isaddon);
	    if (socketapi)
		socketapi.windowclose(winid);
	    delete pageworkers[winid];

	} else if (pageworkers[winid]) {
	    // API method call
	    manifest = pageworkers[winid].manifest;

	    // FIXME: timestamp on each call adds overhead.. but
	    // maybe (?) negligible compared to all the callback soup ...
	    pageworkers[winid].lastactive = new Date().getTime();

	    console.info("'" + req.module + "." + req.method + 
			 "' called by window=" + winid + 
			 ", reqid=" + req.id + 
			 ", isaddon="+manifest.isaddon);

	    var cb = function(res, done) {
		return sendresp(worker, req, res, done);
	    };

	    if (req.module.indexOf('.')>=0) {
		let tmp = req.module.split('.');
		req.module = tmp[0];    // main namespace
		req.submodule = tmp[1]; // subnamespace
	    }

	    switch (req.module) {
	    case 'system':
		systemapi.exec(cb, req, manifest);
		break;

	    case 'baseline':
		baselineapi.exec(cb, req, manifest);
		break;

	    case 'socket':
		socketapi.exec(cb, req, manifest);
		break;

	    case 'proto':
		protoapi.exec(cb, req, manifest);
		break;

	    case 'tools':
		toolsapi.exec(cb, req, manifest);
		break;

	    default:
		// should really not happen due to all manifest checking .. ?
		console.war("request for unknown module",req);
		return sendresp(worker, 
				req, 
				error("nosuchmodule", req.module), 
				true);
	    }

	} else {
	    // maybe forgot to call init first?
	    return sendresp(worker, 
			    req, 
			    error("noinit", worker.tab.url), 
			    true);
	}
    }; // handlefunc
}; // handlereq

/** handler for data upload requests (from addon pages only). */
var uploadreq = function(obj) {
    console.debug('dataupload req from addon page ' + obj.datasource);
    dialogs.showUploadDialog(function(res) {
	if (res) {
	    upload.addUploadItem(obj.datasource, obj.data);
	} // else user denied uploads
    }, obj.datasource);    
};

/** handler for welcome page prefs. */
var prefreq = function(obj) {
    console.debug('prefreq',obj);
    if (obj.baselineupload !== undefined)
	if (obj.baselineupload) {
	    userPrefs[config.BASELINE_UPLOAD] = "always";
	} else {
	    userPrefs[config.BASELINE_UPLOAD] = "never";
	}
    if (obj.enablebaseline !== undefined)
	userPrefs[config.BASELINE] = obj.enablebaseline;
    if (obj.enablefathomapi !== undefined)
	userPrefs[config.FATHOMAPI] = obj.enablefathomapi;
};

//--- Module API ---

/** Background tasks (uploads and baseline measurements) are allowed
 *  if no other page is currently using Fathom, or the page(s) only
 *  requested access to the baseline APIs (that do not require network
 *  access). Page is considered idle if there has been no calls in the
 *  last 5 mintues. These checks are done to avoid messing up with 
*   running measurements.
 */
exports.allowBackgroundTask = function() {
    return (_.size(pageworkers)==0 || _.every(pageworkers, function(w) {
	// conditions:
	// 1) only using baseline API
	// 2) monitoring addon page (only accesses baseline API)
	// 3) worker idle since 5 minutes
	return ((_.size(w.manifest.api) == 1 && w.manifest["baseline"]) ||
		(w.manifest.isaddon && 
		 w.manifest.location.href.indexOf("monitoring")>0) ||
		((new Date().getTime() - w.lastactive) > 1000*60*5));
    }));
};

/** Setup components when the addon is loaded and/or installed. */
exports.setup = function(install) {
    console.info("setup called, install="+install);

    var ts = new Date();
    if (install) {
	// onetime setup on install/enable (for apis that create tmp files)
	_.each(apilist, function(api) {
	    if (api && _.isFunction(api.setup))
		api.setup();
	});

	// track some basic statistics about fathom usage
	ss.storage['installed'] = ts.getTime();
	ss.storage['fathom_debugtool'] = 0;     // times used
	ss.storage['fathom_debugtool_onerror'] = 0; // times used due neterror
	ss.storage['fathom_homenet'] = 0;       // times used
	ss.storage['fathom_monitoring'] = 0;    // times used
	ss.storage['fathom_webpage'] = 0;       // times init on webpage
	ss.storage['fathom_webpage_na'] = 0;    // times users says no
	ss.storage['fathom_baselines'] = 0;     // baseline runs
	ss.storage['fathom_uploaded_items'] = 0;// uploaded items
	ss.storage['fathom_uploads'] = 0;       // uploads
	ss.storage['fathom_failed_uploads'] = 0;// upload failures
    }

    // start runs on every load
    upload.start(function() {
	if (install)
	    // send small packet to notify us about the new user
	    upload.addUploadItem("fathomstats",{
		ts : ts,
		timezoneoffset : ts.getTimezoneOffset(),
		action : "install"
	    });	
    });

    _.each(apilist, function(api) {
	if (api && _.isFunction(api.start))
	    api.start();
    });

    if (install) {
	// open welcome page upon install
	tabs.open(WELCOMEURL);
    }
};

/** Cleanup components when the addon is unloaded or uninstalled. */
exports.cleanup = function(uninstall) {
    console.info("cleanup called, uninstall="+uninstall);

    // do shutdown in reverse order
    apilist.reverse();

    if (uninstall) {
	var ts = new Date();
	upload.addUploadItem("fathomstats", {
	    ts : ts.getTime(),
	    timezoneoffset : ts.getTimezoneOffset(),
	    action : "uninstall",
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

	// force last upload before cleaning up
	upload.uploadItems(function() {
	    upload.stop();

	    // stop first
	    _.each(apilist, function(api) {
		if (api && _.isFunction(api.stop))
		    api.stop();
	    });

	    // onetime cleanup on uninstall/disable (remove tmp files etc)
	    _.each(apilist, function(api) {
		if (api && _.isFunction(api.cleanup))
		    api.cleanup();
	    });	    
	});
    } else {
	// stop runs on every unload    
	upload.stop();
	_.each(apilist, function(api) {
	    if (api && _.isFunction(api.stop))
		api.stop();
	});
    }
};

//-- Mods ---

// Make Fathom API available on all regular web pages 
// (http(s) or file protocols)
pageMod.PageMod({
    include: ["*", "file://*"],
    contentScriptFile: [ MAINJSURL, APIJSURL ],
    contentScriptOptions : { isaddon : false,
			     enableapi : userPrefs[config.FATHOMAPI] },
    contentScriptWhen: 'start',
    onAttach: function(worker) {
 	// fathom API request listener
 	worker.port.on(REQ, handlereq(worker));
    }
});

// Fathom API for addon pages
pageMod.PageMod({
    include: ["resource://jid1-u2earnkjgebkpw-at-jetpack/fathom/*"],
    contentScriptFile: [JQUERYJSURL, MAINJSURL, APIJSURL, WELCOMEJSURL],
    contentScriptOptions : { isaddon : true, 
			     enableapi : true },
    contentScriptWhen: 'start', 
    onAttach: function(worker) {
	if (worker.tab.url.indexOf("welcome.html") > 0) {
	    // welcome page user prefs handler
	    worker.port.on(PREFREQ, prefreq);
	} else { // tools page
	    // fathom API request listener
	    worker.port.on(REQ, handlereq(worker));
	    // data upload request listener
	    worker.port.on(UPLOADREQ, uploadreq);
	}
    }
});

// Hook into Firefox about pages to modify the neterror page
pageMod.PageMod({
    include: ["about:*"],
    contentScriptWhen: 'ready',
    contentScriptFile: ERRORJSURL,
    onAttach: function(worker) {
	worker.port.on('fathom', function(req) {
	    // user requests fathom debugtool, passing the
	    // neterror querystring on to the debugtool
	    // for custom tests
	    var url = DEBUGURL;
	    if (req && req.indexOf('extensions-dummy')<0)
		url += '?' + require('sdk/querystring').stringify(req)
	    tabs.open({	url :  url });
	    ss.storage['fathom_debugtool_onerror'] += 1;
	});
    }
});
