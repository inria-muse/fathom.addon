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

const apilist = [security, systemapi, socketapi, protoapi, baselineapi, toolsapi];

// Worker messaging constants
const REQ = "req";
const RES = "res";

// Resource string consts
const DEBUGURL = self.data.url("tools/debugtool.html");
const WELCOMEURL = self.data.url("welcome.html");

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

// Compatibility hack: cleanup previous stats and replace with the new system
if (ss.storage['installed']) {
    var ts = new Date();
    ss.storage['fathom'] = {
	'installed': ts,
	'total_uptime' : 0.0,
	'baseline' : 0,
	'homenet' : 0,
	'debugtool' : 0,
	'debugtool_neterror' : 0,
	'webpage' : 0,
	'webpage_denied' : 0
    }

    delete ss.storage['installed'];
    delete ss.storage['fathom_debugtool'];
    delete ss.storage['fathom_debugtool_onerror'];
    delete ss.storage['fathom_homenet'];
    delete ss.storage['fathom_monitoring'];
    delete ss.storage['fathom_webpage'];
    delete ss.storage['fathom_webpage_na'];
    delete ss.storage['fathom_baselines'];
    delete ss.storage['fathom_uploaded_items'];
    delete ss.storage['fathom_uploads'];
    delete ss.storage['fathom_failed_uploads'];
}

// Page workers that are using Fathom APIs
var pageworkers = {};

/** Handle API request from the content-scripts. */
var handlereq = function(worker) {
    // unique id of this worker
    var winid = worker.tab.id;
    console.info("new worker, id=" + winid + ", title="+worker.tab.title
		+ ", url=" + worker.tab.url);

    worker.on('detach', function () {
	// tab is closing -- cleanup any state we had for the page
	console.info("worker detach, id=" + winid);
	if (pageworkers[winid]) {
	    if (socketapi)
		socketapi.windowclose(winid);
	    delete pageworkers[winid];
	}
    });

    var sendresp = function(req, data, done) {
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

    // shortcut for errors
    var senderrresp = function(req, err, msg) {
	return sendresp(req, error(err,msg), true);
    };

    return function(req) {	
	if (req.module === 'internal') {
	    // addon internal management methods
	    switch (req.method) {
	    case 'init':
		// page requests access to the fathom API
		console.info("init called by " + worker.tab.url +
			     " isaddon=" + req.params.isaddon +
			     " windowid=" + winid);

		// parse and validate the requested manifest
		var manifest = sec.parseManifest(req.params);
		if (manifest.error) {
		    // problem with the manifest
		    return sendresp(req, manifest, true);
		}

		// window information
		manifest.winid = winid;
		manifest.taburl = worker.tab.url;
		manifest.tabtitle = worker.tab.title;

		var handleuserres = function(userok) {
		    if (!userok) {
			ss.storage['fathom']['webpage_denied'] += 1;
			return senderrresp(req,"notallowed"); 
		    }

		    pageworkers[winid] = {
			manifest : manifest,
			created : new Date().getTime()
		    };

		    return sendresp(req, {manifest : manifest}, true);
		};
	
		if (!manifest.isaddon) {
		    // webpage is requesting fathom APIs - ask the user
		    ss.storage['fathom']['webpage'] += 1;
		    dialogs.showSecurityDialog(handleuserres, manifest);
		    
		} else {
		    if (manifest.taburl.indexOf('monitoring.html')>=0) {
			manifest.tool = 'baseline';
			ss.storage['fathom']['baseline'] += 1;
		    } else if (manifest.taburl.indexOf('debugtool.html')>=0) {
			manifest.tool = 'debugtool';
			ss.storage['fathom']['debugtool'] += 1;
		    } else if (manifest.taburl.indexOf('homenet.html')>=0) {
			manifest.tool = 'homenet';
			ss.storage['fathom']['homenet'] += 1;
		    }
		    
		    // no security dialog on addon pages - always allow
		    handleuserres(true);
		}
		break;

	    case 'close':
		console.info("close called by " + worker.tab.url +
			     " windowid=" + winid);
		if (pageworkers[winid]) {
		    if (socketapi)
			socketapi.windowclose(winid);
		    delete pageworkers[winid];
		}
		sendresp(req,true,true);
		break;

	    case 'upload':
		// tools page uploading data
		console.debug('fathom upload req from addon page ' + 
			    worker.tab.url);
		var obj = req.params;
		var manifest = pageworkers[winid].manifest;

		dialogs.showUploadDialog(function(userok) {
		    if (userok) {
			upload.addUploadItem(manifest.tool, obj);
		    }
		    sendresp(req,userok,true);
		}, manifest.tool);
		break;

	    case 'userpref':
		// from welcome.js
		var obj = req.params;
		console.debug('fathom userpref req',obj);
		if (obj.baselineupload !== undefined) {
		    if (obj.baselineupload) {
			userPrefs[config.BASELINE_UPLOAD] = "always";
		    } else {
			userPrefs[config.BASELINE_UPLOAD] = "never";
		    }
		}

		if (obj.enablebaseline !== undefined)
		    userPrefs[config.BASELINE] = obj.enablebaseline;

		if (obj.enablefathomapi !== undefined)
		    userPrefs[config.FATHOMAPI] = obj.enablefathomapi;
		
		break;

	    case 'forceupload':
		// from debug.js: force upload
		console.debug('fathom force-upload req from addon page ' + 
			    worker.tab.url);
		upload.uploadItems();
		break;

	    case 'purgeupload':
		// from debug.js: purge upload queue
		console.debug('fathom purge-upload req from addon page ' + 
			    worker.tab.url);
		upload.purgeUploadItems();
		break;

	    case 'getstats':
		// from debug.js: get stats
		var stats = {
		    'instance' : {
			'fathom_version' : self.version,
			'fathom_uuid' : ss.storage['uuid'],
			'fathom_public_uuid' : ss.storage['public_uuid']
		    },
		    'fathom' : ss.storage['fathom'],
		    'security' : ss.storage['security'],
		    'baseline' : ss.storage['baseline'],
		    'upload' : ss.storage['upload']
		}
		sendresp(req,stats,true);
		break;
	    default:
		console.warn("fathom no such method: internal." + req.method);
		senderrresp(req,"nosuchmethod",req.method); 
	    }

	} else if (pageworkers[winid]) {
	    // API method call
	    var manifest = pageworkers[winid].manifest;
	    pageworkers[winid].lastactive = new Date().getTime();

	    console.info("'" + req.module + "." + req.method + 
			 "' called by window=" + winid + 
			 ", reqid=" + req.id + 
			 ", isaddon="+manifest.isaddon);

	    var cb = function(res, done) {
		return sendresp(req, res, done);
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
		return senderrresp(req,"nosuchmodule",req.module); 
	    }

	} else {
	    return senderrresp(req,"noinit",worker.tab.url); 
	}
    }; // handlefunc
}; // handlereq

//--- Module API methods ---

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
	// 1) page is only using baseline API
	// 2) monitoring addon page (only accesses baseline API)
	// 3) worker idle since 5 minutes (maybe forgot to call close?)
	return ((_.size(w.manifest.api) == 1 && w.manifest["baseline"]) ||
		(w.manifest.isaddon && w.manifest.tool === 'baseline') ||
		((new Date().getTime() - w.lastactive) > 1000*60*5));
    }));
};

/** Setup components when the addon is loaded and/or installed. */
exports.setup = function(install, upgrade) {
    console.info("setup called, install="+install+", upgrade="+upgrade);

    var ts = new Date();
    if (install) {
	// onetime setup on install/enable (for apis that create tmp files)
	_.each(apilist, function(api) {
	    if (api && _.isFunction(api.setup))
		api.setup();
	});
        
	// track some basic statistics about fathom usage
	ss.storage['fathom'] = {
	    'installed': ts,
	    'total_uptime' : 0,
	    'current_starttime' : ts,
	    'baseline' : 0,
	    'homenet' : 0,
	    'debugtool' : 0,
	    'debugtool_neterror' : 0,
	    'webpage' : 0,
	    'webpage_denied' : 0
	}
        upload.setup();
    }
    ss.storage['fathom']['current_starttime'] = ts;

    // start runs on every load
    _.each(apilist, function(api) {
	if (api && _.isFunction(api.start))
	    api.start();
    });

    upload.start(function() {
	if (install) {
	    // send small packet to notify us about the new user
	    upload.addUploadItem("fathomstats",{
		ts : ts.getTime(),
		timezoneoffset : ts.getTimezoneOffset(),
		action : "install"
	    });	

	} else if (upgrade) {
	    if (self.version === '2.0.5') {
		// hack: objects prior 2.0.5 may have some probs, just remove
		upload.purgeUploadItems(function() {
		    // send a small packet to notify us that the upgrade is done
		    upload.addUploadItem("fathomstats",{
			ts : ts.getTime(),
			timezoneoffset : ts.getTimezoneOffset(),
			action : "upgrade"
		    });
		});
	    } else {
		// send a small packet to notify us that the upgrade is done
		upload.addUploadItem("fathomstats",{
		    ts : ts.getTime(),
		    timezoneoffset : ts.getTimezoneOffset(),
		    action : "upgrade"
		});
	    }
	}
    });

    if (install) {
	// open welcome page upon install
	tabs.open(WELCOMEURL);
    }
};

/** Cleanup components when the addon is unloaded or uninstalled. */
exports.cleanup = function(uninstall) {
    var ts = new Date();
    console.info("cleanup called, uninstall="+uninstall);

    // uptime stats
    ss.storage['fathom']['total_uptime'] += 
    (ts.getTime() - ss.storage['fathom']['current_starttime'].getTime())/1000.0;
	
    ss.storage['fathom']['current_starttime'] = null;

    // do shutdown in reverse order
    apilist.reverse();

    if (uninstall) {
	upload.addUploadItem("fathomstats", {
	    ts : ts.getTime(),
	    timezoneoffset : ts.getTimezoneOffset(),
	    action : "uninstall",
	    stats : {
		'fathom' : ss.storage['fathom'],
		'security' : ss.storage['security'],
		'baseline' : ss.storage['baseline'],
		'upload' : ss.storage['upload']
	    }
	});

	// force last upload and clean everything up
	upload.uploadItems(function() {
            upload.purgeUploadItems(function() {
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

                // seems like the storage remains availabe between if re-installing ...
                delete ss.storage['baseline'];
                delete ss.storage['security'];
                delete ss.storage['fathom'];
                delete ss.storage['upload'];
            });
	});
        
    } else {
        // regular shutdown        
	upload.addUploadItem("fathomstats",{
	    ts : ts.getTime(),
	    timezoneoffset : ts.getTimezoneOffset(),
	    action : "browserstop",
	    stats : {
		'fathom' : ss.storage['fathom'],
		'security' : ss.storage['security'],
		'baseline' : ss.storage['baseline'],
		'upload' : ss.storage['upload']
	    }
	}, function() {
	    upload.stop();
	});
        
	_.each(apilist, function(api) {
	    if (api && _.isFunction(api.stop))
		api.stop();
	});
    }
};

//-- Page Mods ---

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
    include: [self.data.url("*")],
    contentScriptFile: [MAINJSURL, APIJSURL],
    contentScriptOptions : { isaddon : true, 
			     enableapi : true },
    contentScriptWhen: 'start', 
    onAttach: function(worker) {
	worker.port.on(REQ, handlereq(worker));
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
	    ss.storage['fathom']['debugtool_neterror'] += 1;
	});
    }
});
