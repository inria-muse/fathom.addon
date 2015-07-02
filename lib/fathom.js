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
const timers = require("sdk/timers");
const system = require("sdk/system");
const pageMod = require("sdk/page-mod");
const tabs = require("sdk/tabs");
const ss = require("sdk/simple-storage");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;
const _ = require('underscore');

// set full debug logging on in dev versions / mode
var devmode = system.staticArgs.dev || self.version.indexOf('-dev')>0;
if (devmode) {
	let name = "extensions."+self.id+".sdk.console.logLevel";
	require("sdk/preferences/service").set(name, "all");
}
console.info("loading " + self.name + " addon v=" + self.version + 
	" devmode=" + devmode);

// addon modules
const {error, FathomException} = require("error");
const config = require("config");
const consts = require("consts");
const utils = require("utils");
const sec = require("security");
const upload = require("upload");

const dialogs = require('ui/dialogs');

const baselineapi = require("baselineapi");
const systemapi = require("systemapi");
const socketapi = require("socketapi");
const protoapi = require("protoapi");
const toolsapi = require("toolsapi");

const apilist = [sec, systemapi, socketapi, protoapi, baselineapi, toolsapi];

// Worker messaging constants
const REQ = "req";
const RES = "res";

if (!ss.storage['uuid']) {
    // create unique identifier for this Fathom installation
    // used as the identifier of uploaded data (and can be used
    // by the user to request access to his/her data and its 
    // removal)
	const uuidlib = require('sdk/util/uuid');
	
	let uuid = uuidlib.uuid().toString();
	uuid = uuid.replace('{','');
	uuid = uuid.replace('}','');
	if (devmode)
		uuid += '-dev';
	ss.storage['uuid'] = uuid;
	console.info("generated uuid " + ss.storage['uuid']);

    // 2nd uuid used as the public node ID upon Fathom 
    // node discovery and API calls
    let uuid2 = uuidlib.uuid().toString();
    uuid2 = uuid2.replace('{','');
    uuid2 = uuid2.replace('}','');
    ss.storage['public_uuid'] = uuid2;
    console.info("generated public_uuid " + ss.storage['public_uuid']);
}

// this is the per device unique salt used for anonymizing data
if (!ss.storage['salt']) {
	ss.storage['salt'] = Math.floor((Math.random() * Date.now()) + 1); 
}

// Page workers that are using Fathom APIs
var pageworkers = {};

// Pageload times of currently active tabs
var activetabs = {};

/** Handle API request from the content-scripts. */
var handlereq = function(worker) {
    if (!worker || !worker.tab) // latter seems to happen sometimes ... a bug ?!?
    	return function() {};

    // unique id of this worker (several workers per tab is possible)
    var winid = worker.tab.id+"."+Date.now();

    console.info("new worker, tab=" + worker.tab.id + 
    	", title="+worker.tab.title +
    	", url=" + worker.tab.url +
    	", winid=" + winid);

    worker.on('detach', function () {
		// tab is closing -- cleanup any state we had for the page
		console.info("worker detach, id=" + winid);
		if (pageworkers[winid]) {
			if (socketapi) {
				socketapi.windowclose(winid);
			}
			delete pageworkers[winid];
		}	
	});

    var sendresp = function(req, data, done) {
		if (!pageworkers[winid] && !req.module === 'internal') return; // unregistered
		if (done === undefined) done = true;

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
		if (!pageworkers[winid] && !req.module === 'internal') return; // unregistered
		return sendresp(req, error(err,msg), true);
	};

	return function(req) {	
		if (req.module === 'internal') {
		    // addon internal management methods
			console.info("internal method called by " + worker.tab.url +
				" method=" + req.method +
				" winid=" + winid);

		    switch (req.method) {
	    	case 'init':
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
				if (pageworkers[winid]) {
					if (socketapi)
						socketapi.windowclose(winid);
					delete pageworkers[winid];
				}

				sendresp(req,true,true);
				break;

			case 'upload':
				// tools page uploading data
				var obj = req.params;
				var manifest = pageworkers[winid].manifest;
				dialogs.showUploadDialog(function(userok) {
					if (userok) {
						upload.addUploadItem(manifest.tool, obj);
					}
					sendresp(req,userok,true);
				}, manifest.tool);
				break;

			case 'getuserpref':
				// various tools may ask for user prefs
				if (_.isArray(req.params)) {
					sendresp(req,
						_.map(req.params, 
							function(p) { return userPrefs[p]; }),
						true);	
				} else {
					sendresp(req,userPrefs[req.params],true);
				}
				break;

			case 'getjson':
				// TODO: offer as public API ?
				// various tools may ask for the latest baseline jsons
				baselineapi.exec(function(res) {
					sendresp(req,res,true);
				}, req); 
				break;

			case 'setenvlabel':
				baselineapi.exec(function(res) {
					sendresp(req,res,true);
				}, req); 
				break;

			case 'setuserpref':
				// from welcome.js
				var obj = req.params;

				if (obj[consts.BASELINE_UPLOAD] !== undefined) {
					userPrefs[consts.BASELINE_UPLOAD] = (obj[consts.BASELINE_UPLOAD] ? consts.UPLOAD_ALWAYS : consts.UPLOAD_NEVER);
				}

				if (obj[consts.PAGELOAD_UPLOAD] !== undefined) {
					userPrefs[consts.PAGELOAD_UPLOAD] = (obj[consts.PAGELOAD_UPLOAD] ? consts.UPLOAD_ALWAYS : consts.UPLOAD_NEVER);
				}

				if (obj.enablebaseline !== undefined)
					userPrefs[consts.BASELINE] = obj.enablebaseline;
				if (obj.enablepageload !== undefined)
					userPrefs[consts.PAGELOAD] = obj.enablepageload;
				if (obj.enablefathomapi !== undefined)
					userPrefs[consts.FATHOMAPI] = obj.enablefathomapi;
				
				sendresp(req,true,true);
				break;

			case 'forceupload':
				// add a stats object to the queue for debugging
				var ts = new Date();
				upload.addUploadItem("fathomstats", {
					ts : ts.getTime(),
					timezoneoffset : ts.getTimezoneOffset(),
					action : "debugupload",
					stats : {
						'fathom' : ss.storage['fathom'],
						'security' : ss.storage['security'],
						'baseline' : ss.storage['baseline'],
						'upload' : ss.storage['upload']
					}
				}, function() {
					upload.uploadItems();
					sendresp(req,true,true);
				});
				break;

			case 'purgeupload':
				upload.purgeUploadItems();
				sendresp(req,true,true);
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
				};
				sendresp(req,stats,true);
				break;

			case 'getwhitelist':
				// from whitelist.js: get whitelist
				var blacklist = ss.storage['blacklist'] || [];
				var res = _.map(config.ALEXA_TOP, function(v) {
					return { host : v, disabled : _.contains(blacklist, v) };
				});
				sendresp(req,res,true);
				break;

			case 'setwhitelist':
				// from whitelist.js: remove selected entries from whitelist
				var blacklist = [];
				_.each(req.params, function(v) {
					if (v.disabled)
						blacklist.push(v.host)
				});
				ss.storage['blacklist'] = blacklist;
				sendresp(req,true,true);
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
				senderrresp(req,"nosuchmodule",req.module); 
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

/** Get active tab + pageload stats if available. */
exports.getActiveTab = function() {
	var res = {
		readyState : tabs.activeTab.readyState,
		id : tabs.activeTab.id,
		url : tabs.activeTab.url,
		objects : 0,
		pageloadtime : 0,
		monitenabled : userPrefs[consts.PAGELOAD]
	};
	if (activetabs[res.id+'.'+res.url] && res.readyState === 'complete') {
		let p = activetabs[res.id+'.'+res.url];
		res.objects = p.performance.resourcetiming.length + 1; // the html doc + all resources
		res.pageloadtime = (p.performance.timing.loadEventStart-p.performance.timing.navigationStart);
	}
	return res;
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
		upload.setup();
	}

	if (!ss.storage['fathom']) {
		ss.storage['fathom'] = {
			'installed': ts,
			'upgraded': ts,
			'total_uptime' : 0,
			'current_starttime' : ts,
			'baseline' : 0,
			'homenet' : 0,
			'debugtool' : 0,
			'debugtool_neterror' : 0,
			'webpage' : 0,
			'webpage_denied' : 0
		}
	}

    // handle previous shutdown
    var prevstats = undefined;

    if (ss.storage['fathom']['shutdown']) {
    	var sts = new Date(ss.storage['fathom']['shutdown']);
    	delete ss.storage['fathom']['shutdown'];
    	prevstats = {
    		ts : sts.getTime(),
    		timezoneoffset : sts.getTimezoneOffset(),
    		action : "browserstop",
    		stats : {
    			'fathom' : ss.storage['fathom'],
    			'security' : ss.storage['security'],
    			'baseline' : ss.storage['baseline'],
    			'upload' : ss.storage['upload']
    		}
    	};
    }

    ss.storage['fathom']['current_starttime'] = ts;
    if (upgrade)
    	ss.storage['fathom']['upgraded'] = ts;

    // start runs on every load
    _.each(apilist, function(api) {
    	if (api && _.isFunction(api.start))
    		api.start();
    });

    upload.start(function() {
		// these are not so critical, do later
		if (prevstats) {
			timers.setTimeout(function() {
				upload.addUploadItem("fathomstats",prevstats);
			}, 3000);
		}

		if (install || upgrade) {
			var obj = {
				ts : ts.getTime(),
				timezoneoffset : ts.getTimezoneOffset(),
				action : (install ? "install" : "upgrade")
			}
			timers.setTimeout(function() {
				upload.addUploadItem("fathomstats",obj);
			}, 3250);	
		}
	});

    // track pref changes
    sprefs.on("", function(prefname) {
    	ss.storage['fathom'][prefname] = userPrefs[prefname];
    	ss.storage['fathom'][prefname+'_ts'] = new Date();
    	if (!ss.storage['fathom'][prefname+'_count'])
    		ss.storage['fathom'][prefname+'_count'] = 0;
    	ss.storage['fathom'][prefname+'_count'] += 1;

    	if (prefname === consts.BASELINE) {
		    // start/stop background monitoring
		    if (userPrefs[consts.BASELINE])
		    	baselineapi.start();
		    else
		    	baselineapi.stop();
		}
	});
    
    // listener for whitelist pref button
    sprefs.on(consts.WHITELIST,function() {
    	tabs.open({url : consts.WHITELISTURL});
    });

	// open the welcome page from the settings
    sprefs.on('welcome', function() {
    	tabs.open({url : consts.WELCOMEURL});    	
    });

    if (install) {
		// open welcome page upon install
		tabs.open(consts.WELCOMEURL);
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
    ss.storage['fathom']['shutdown'] = ts;

    // do shutdown in reverse order
    apilist.reverse();

    if (uninstall) {
		// TODO: all these take a bit time ...

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
		}, function() {
		    // last upload and cleanup
		    upload.uploadItems(function() {
		    	upload.purgeUploadItems(function() {
		    		upload.stop();
		    		upload.cleanup();

		    		_.each(apilist, function(api) {
		    			if (api && _.isFunction(api.stop))
		    				api.stop();
		    		});

		    		_.each(apilist, function(api) {
		    			if (api && _.isFunction(api.cleanup))
		    				api.cleanup();
		    		});

		    		delete ss.storage['fathom'];
		    	});
		    });
		});        
	} else {
        // regular shutdown - just close the API components
        upload.stop();
        _.each(apilist, function(api) {
        	if (api && _.isFunction(api.stop))
        		api.stop();
        });
    }
};

//-- Page Mods ---

// Pageload times monitoring (http & https protocols)
pageMod.PageMod({
	include: ["*"],
	contentScriptFile: [ consts.PAGELOADJSURL ],
	contentScriptOptions : { 
		enableperf : userPrefs[consts.PAGELOAD]
	}, 
	attachTo: ["top"], // top level document
	contentScriptWhen: 'end',
	onAttach: function(worker) {
		var page = worker.tab.id+'.'+worker.tab.url;
		console.log('fathom pageload ' + page);

		worker.port.on("perf", function(p) {
			p.type = 'page';
			p.pageid = utils.getHash(page+ss.storage['salt']);				
			activetabs[page] = p;
			baselineapi.handlepageload(p);
		});

	    worker.on('detach', function () {
    		if (page)
	    		delete activetabs[page];
		});
	}
});
pageMod.PageMod({
	include: ["*"],
	contentScriptFile: [ consts.PAGELOADJSURL ],
	contentScriptOptions : { 
		enableperf : userPrefs[consts.PAGELOAD]
	}, 
	attachTo: ["frame"],  // embedded stuff e.g. iframes
	contentScriptWhen: 'end',
	onAttach: function(worker) {
		worker.port.on("perf", function(p) {
			if (worker.tab) {
				// same tab+url with the top level doc
				var page = worker.tab.id+'.'+worker.tab.url;
				console.log('fathom frameload on page ' + page);
				p.type = 'frame';
				p.pageid = utils.getHash(page+ss.storage['salt']);
				baselineapi.handlepageload(p);
			}
		});
	}
});

// Make Fathom API available on all regular web pages 
// (http(s) or file protocols)
pageMod.PageMod({
	include: ["*", "file://*"],
	contentScriptFile: [ consts.MAINJSURL, consts.APIJSURL ],
	contentScriptOptions : { 
		isaddon : false,                         // flag as normal page, full security checks on
		enableapi : userPrefs[consts.FATHOMAPI], // user may have disabled, handled on the content script
		fathom_version : self.version
	},
	attachTo: ["top"],
	contentScriptWhen: 'start',
	onAttach: function(worker) {
	 	// fathom API request listener
	 	worker.port.on(REQ, handlereq(worker));
	}
});

// Fathom API for addon pages
pageMod.PageMod({
	include: [self.data.url("*")],
	contentScriptFile: [consts.MAINJSURL, consts.APIJSURL],
	contentScriptOptions : { 
		isaddon : true,                          // flag as addon page, no manifest required
		enableapi : true,                        // always enabled
		fathom_version : self.version
	},
	attachTo: ["top"],
	contentScriptWhen: 'start', 
	onAttach: function(worker) {
		worker.port.on(REQ, handlereq(worker));
	}
});

// Hook into Firefox about pages to modify the neterror page
pageMod.PageMod({
	include: ["about:*"],
	contentScriptWhen: 'end',
	contentScriptFile: consts.ERRORJSURL,
	onAttach: function(worker) {
		worker.port.on('fathom', function(req) {
			console.log('neterror',req);			
		    // user requests fathom debugtool, passing the
		    // neterror querystring on to the debugtool
		    // for custom tests
		    var url = consts.DEBUGURL;
		    if (req && req['u'].indexOf('extensions-dummy')<0) {
		    	url += '?' + require('sdk/querystring').stringify(req)
		    }
		    tabs.open({	url :  url });
		    ss.storage['fathom']['debugtool_neterror'] += 1;
		});
	}
});