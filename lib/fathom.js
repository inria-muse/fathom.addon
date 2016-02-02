/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
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
const qstring = require('sdk/querystring');
const url = require("sdk/url");

const _ = require('underscore');

const userPrefs = sprefs.prefs;

// set full debug logging on in dev versions / mode
const extname = "extensions."+self.id+".sdk.console.logLevel";	
ss.storage['devmode'] = (system.staticArgs && system.staticArgs.dev) || self.version.indexOf('-dev')>0 || self.version.indexOf('-beta')>0;
if (ss.storage['devmode']) {
	require("sdk/preferences/service").set(extname, "all"); // verbose
} else {
	require("sdk/preferences/service").set(extname, "warn");
}

// addon modules
const {error, FathomException} = require("./error");
const config = require("./config");
const consts = require("./consts");
const utils = require("./utils");
const sec = require("./security");
const db = require('./db');
const env = require("./env");
const upload = require("./upload");

const dialogs = require('./ui/dialogs');

const baselineapi = require("./baselineapi");
const systemapi = require("./systemapi");
const socketapi = require("./socketapi");
const protoapi = require("./protoapi");
const toolsapi = require("./toolsapi");

const apilist = [upload, sec, systemapi, socketapi, protoapi, baselineapi, toolsapi];

// Worker messaging constants
const REQ = "req";
const RES = "res";

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
		    // these methods are not part of the public Fathom API and only 
		    // available to the addon pages (./data/*)

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
				baselineapi.exec(function(res) {
					sendresp(req,res,true);
				}, req); 
				break;

			case 'setenvlabel':
				// name env with user label
				env.setenvlabel(function(res) {
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
						'fathom_public_uuid' : ss.storage['public_uuid'],
						'fathom_config_version' : ss.storage['config']['config']['version'],
						'fathom_config_updated' : ss.storage['config']['config']['last_update']
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
				var res = _.map(config.get('pageload', 'whitelist'), function(v) {
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

			case 'debugtool':
			    // user requests fathom debugtool, passing the
			    // neterror querystring on to the debugtool
			    // for custom tests
			    var toolurl = consts.DEBUGURL;
			    if (req && req.params.indexOf('extensions-dummy')<0) {
			    	let q = qstring.parse(req.params.split('?')[1]);
			    	let u = new url.URL(q.u);
			    	console.log(u);
			    	toolurl += '?' + qstring.stringify({
			    		protocol:u.protocol.replace(':',''),
			    		hostname:u.hostname,
			    		pathname:u.pathname 
			    	});
			    	console.log(toolurl);
			    }
			    tabs.open({	url :  toolurl });
			    ss.storage['fathom']['debugtool_neterror'] += 1;
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

var create_pagemods = function() {
	// Fathom API for addon pages - always available
	pageMod.PageMod({
		include: [self.data.url("*")],
		contentScriptFile: [consts.MAINJSURL, consts.APIJSURL],
		contentScriptOptions : { isaddon : true, version : self.version },
		attachTo: ["top"],
		contentScriptWhen: 'ready', 
		onAttach: function(worker) {
			worker.port.on(REQ, handlereq(worker));
		}
	});

	// Pageload times monitoring (http & https protocols)
	var pltmods = undefined;
	var loadPltMod = function() {
		console.log("load pageload page_mod");
		pltmods = [];
		pltmods.push(pageMod.PageMod({
			include: ["*"],
			contentScriptFile: [consts.PAGELOADJSURL],
			attachTo: ["top"], // top level document
			contentScriptWhen: 'end',
			onAttach: function(worker) {
				if (worker && worker.tab) {
					var page = worker.tab.id+'.'+worker.tab.url;
					console.log('fathom pageload ' + page);

					worker.port.on("perf", function(p) {
						p.type = 'page';
						p.pageid = utils.getHash(page+ss.storage['salt']);
						activetabs[page] = p;
						if (userPrefs[consts.PAGELOAD])
							baselineapi.handlepageload(p);
					});

				    worker.on('detach', function () {
						delete activetabs[page];
					});
				} // else disabled
			}
		}));
		pltmods.push(pageMod.PageMod({
			include: ["*"],
			contentScriptFile: [consts.PAGELOADJSURL],
			attachTo: ["frame"],  // embedded stuff e.g. iframes
			contentScriptWhen: 'end',
			onAttach: function(worker) {
				if (worker && worker.tab) {
					var page = worker.tab.id+'.'+worker.tab.url;
					console.log('fathom frameload on page ' + page);

					worker.port.on("perf", function(p) {
						p.type = 'frame';
						p.pageid = utils.getHash(page+ss.storage['salt']);
						if (userPrefs[consts.PAGELOAD])
							baselineapi.handlepageload(p);
					});
				}
			}
		}));
	};
	var unloadPltMod = function() {
		console.log("unload pageload page_mod");
		_.each(pltmods, function(m) { m.destroy(); })
		pltmods = [];
	};

	// Mediaload times monitoring (http & https protocols)
	var mediamods = undefined;
	var loadMediaMod = function() {
		console.log("load media load page_mod");
		mediamods = [];
		mediamods.push(pageMod.PageMod({
			include: ["*"],
			contentScriptFile: [consts.MEDIALOADJSURL],
			attachTo: ["top"], // top level document
			contentScriptWhen: 'end',
			onAttach: function(worker) {
				if (worker && worker.tab) {
					var page = worker.tab.id+'.'+worker.tab.url;
					console.log('fathom mediaload page ' + page);

					worker.port.on("perf", function(p) {
						p.type = 'page';
						p.pageid = utils.getHash(page+ss.storage['salt']);				
						activetabs[page] = p;
						if (userPrefs[consts.MEDIALOAD])
							baselineapi.handlemediaload(p);
					});

				    worker.on('detach', function () {
						delete activetabs[page];
					});
				} // else disabled
			}
		}));
		mediamods.push(pageMod.PageMod({
			include: ["*"],
			contentScriptFile: [consts.MEDIALOADJSURL],
			attachTo: ["frame"],  // embedded stuff e.g. iframes
			contentScriptWhen: 'end',
			onAttach: function(worker) {
				if (worker && worker.tab) {
					var page = worker.tab.id+'.'+worker.tab.url;
					console.log('fathom mediaload on frame in page ' + page);

					worker.port.on("perf", function(p) {
						p.type = 'frame';
						p.pageid = utils.getHash(page+ss.storage['salt']);
						if (userPrefs[consts.MEDIALOAD])
							baselineapi.handlemediaload(p);
					});
				} // else disabled
			}
		}));
	};
	var unloadMediaMod = function() {
		console.log("unload media load page_mod");
		_.each(mediamods, function(m) { m.destroy(); })
		mediamods = [];
	};

	// API for http, https and file content
	var apiMod = undefined;
	var loadApiMod = function() {
		console.log("load api page_mod");
		// Make Fathom API available on all regular web pages 
		// (http(s) or file protocols)
		apiMod = pageMod.PageMod({
			include: ["*", "file://*"],
			contentScriptFile: [consts.MAINJSURL, consts.APIJSURL],
			contentScriptOptions : { isaddon : false, version : self.version },
			attachTo: ["top"],
			contentScriptWhen: 'start',
			onAttach: function(worker) {
			 	worker.port.on(REQ, handlereq(worker));
			}
		});		
	}
	var unloadApiMod = function() {
		console.log("unload api page_mod");
    	apiMod.destroy();
    	apiMod = undefined;		
	}


	// load selected mods
	if (userPrefs[consts.FATHOMAPI]) {
		loadApiMod();
	}
	if (userPrefs[consts.PAGELOAD]) {
		loadPltMod();
	}
	if (userPrefs[consts.MEDIALOAD]) {
		loadMediaMod();
	}

    // track pref changes that impact pagemods
    sprefs.on("", function(prefname) {
    	// stats
    	ss.storage['fathom'][prefname] = userPrefs[prefname];
    	ss.storage['fathom'][prefname+'_ts'] = new Date();
    	if (!ss.storage['fathom'][prefname+'_count'])
    		ss.storage['fathom'][prefname+'_count'] = 0;
    	ss.storage['fathom'][prefname+'_count'] += 1;

    	if (prefname === consts.BASELINE) {
		    if (userPrefs[consts.BASELINE])
		    	baselineapi.start();
		    else
		    	baselineapi.stop();

		} else if (prefname === consts.FATHOMAPI) {
		    if (userPrefs[consts.FATHOMAPI]) {
		    	loadApiMod();
		    } else {
		    	unloadApiMod();
		    }
		} else if (prefname === consts.PAGELOAD) {
		    if (userPrefs[consts.PAGELOAD]) {
		    	loadPltMod();
		    } else {
		    	unloadPltMod();
		    }
		} else if (prefname === consts.MEDIALOAD) {
		    if (userPrefs[consts.MEDIALOAD]) {
		    	loadMediaMod();
		    } else {
		    	unloadMediaMod();
		    }
		}
	});
}


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
	var res = { monitenabled : userPrefs[consts.PAGELOAD] };
	if (res.monitenabled && tabs.activeTab) {
		res.id = tabs.activeTab.id;
		res.url = tabs.activeTab.url;
		res.objects = 0;
		res.pageloadtime = 0;

		if (res.url && !res.url.startsWith('https') && !res.url.startsWith('http')) {
			res.url = undefined;	
		}

		if (res.url) {
			if (activetabs[res.id+'.'+res.url]) {
				let p = activetabs[res.id+'.'+res.url];
				res.objects = p.performance.resourcetiming.length + 1; // the html doc + all resources
				res.pageloadtime = (p.performance.timing.loadEventStart-p.performance.timing.navigationStart);
				res.loading = false;
			} else {
				res.loading = true;
			}
		}
	}
	return res;
};

/** Setup components when the addon is loaded and/or installed. */
exports.setup = function(reason) {
	var ts = new Date();
	console.info("setup " + self.name + " version=" + self.version + " devmode=" + ss.storage['devmode'] + " reason=" + reason);

	if (!ss.storage['uuid']) {
	    // create unique identifier for this Fathom installation
	    // used as the identifier of uploaded data (and can be used
	    // by the user to request access to his/her data and its 
	    // removal)
		const uuidlib = require('sdk/util/uuid');
		
		let uuid = uuidlib.uuid().toString();
		uuid = uuid.replace('{','');
		uuid = uuid.replace('}','');
		if (ss.storage['devmode'])
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

	// connect baseline db
    db.getInstance().connect(function(res) {
        if (res && res.error) {
            console.error("fathom failed to open db connection",res.error);
        } else {
            console.log("fathom db connected");
        }
    });

    if (ss.storage['fathom'] && ss.storage['fathom']['shutdown']) {
	    // handle previous shutdown
    	var sts = new Date(ss.storage['fathom']['shutdown']);
    	var prevstats = {
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
		timers.setTimeout(function() {
			upload.addUploadItem("fathomstats",prevstats);
		}, 120000);

    	delete ss.storage['fathom']['shutdown'];
    }

    if (ss.storage['fathom']!==undefined) {
	    ss.storage['fathom']['current_reason'] = reason;
	    ss.storage['fathom']['current_starttime'] = ts;
    } else {
		ss.storage['fathom'] = {
			'current_reason' : reason,
			'current_starttime' : ts,
			'total_uptime' : 0,
			'baseline' : 0,
			'homenet' : 0,
			'debugtool' : 0,
			'debugtool_neterror' : 0,
			'webpage' : 0,
			'webpage_denied' : 0
		}
	}

	var obj = {
		ts : ts.getTime(),
		timezoneoffset : ts.getTimezoneOffset(),
		action : 'browserstart',
		reason : reason
	}
	timers.setTimeout(function() {
		upload.addUploadItem("fathomstats",obj);
	}, 120001);	

    _.each(apilist, function(api) {
    	if (api && _.isFunction(api.start))
    		api.start(reason);
    });

    create_pagemods();
    
    // listener for whitelist pref button
    sprefs.on(consts.WHITELIST, function() {
    	tabs.open({url : consts.WHITELISTURL});
    });

    if (reason === 'install') {
		// open welcome page upon install
		tabs.open(consts.WELCOMEURL);

	} else if (reason === 'upgrade') {
		// TODO: open upgrade info ?
		//tabs.open(consts.UPGRADEURL);
	}
};

/** Cleanup components when the addon is unloaded or uninstalled. */
exports.cleanup = function(reason) {
	var ts = new Date();
	console.info("cleanup called, reason="+reason);

    // uptime stats
    ss.storage['fathom']['total_uptime'] += 
    	(ts.getTime() - ss.storage['fathom']['current_starttime'].getTime())/1000.0;
    ss.storage['fathom']['shutdown'] = ts;

    // close db
	db.getInstance().close();    

    // do shutdown in reverse order
    apilist.reverse();

    if (reason === 'uninstall') {
    	// FIXME: this is never triggered - bug in the SDK
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
		    		_.each(apilist, function(api) {
		    			if (api && _.isFunction(api.stop))
		    				api.stop();
		    		});
		    		delete ss.storage['fathom'];
		    		delete ss.storage['security'];
		    		delete ss.storage['baseline'];
		    		delete ss.storage['upload'];
		    	});
		    });
		});        
	} else {
        _.each(apilist, function(api) {
        	if (api && _.isFunction(api.stop))
        		api.stop();
        });
    }
};