/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/** 
 * @fileoverview Fathom popup dialogs.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>
 */

const os = require("sdk/system").platform;
const panel = require("sdk/panel");
const self = require("sdk/self");
const prefs = require("sdk/simple-prefs").prefs;
const ss = require("sdk/simple-storage");

var showAboutDialog = function(cb) {
    if (os !== "android") {
	var p = panel.Panel({
	    contentURL: self.data.url("about.html"),
	    width: 420,
	    height: 260
	});
	p.port.on("resize", function(o) {
	    p.resize(o.width, o.height);
	});
	p.port.on("action", function(o) {
	    p.destroy();
	    p = undefined;
	    if (cb) cb();
	});
	p.show();
	p.port.emit("render", {
	    'fathom_version' : self.version,
	    'fathom_uuid' : ss.storage['uuid']
	});
//	p.port.emit('resize',null);
    } else {
	// TODO: on android
	console.error("android dialogs are missing");
	if (cb) cb();
    }
};
exports.showAboutDialog = showAboutDialog;

const UPLOAD_ASKME = "askme";
const UPLOAD_ALWAYS = "always";
const UPLOAD_NEVER = "never";

var showUploadDialog = function(callback, tool) {
    var key = tool+'upload';
    console.info('upload-dialog for ' + key + ', current pref ' + prefs[key]);
    
    if (!prefs[key] || prefs[key] === UPLOAD_ASKME) {
	if (os !== "android") {
	    // popup panel
	    var p = panel.Panel({
		contentURL: self.data.url("uploadconfirm.html"),
		width: 320,
		height: 220
	    });
	    
	    p.port.on("resize", function(o) {
		p.resize(o.width, o.height);
	    });
	    
	    p.port.on("action", function(res) {
		p.destroy();	
		p = undefined;

		switch (res) {
		case 'always':
		    prefs[key] = UPLOAD_ALWAYS;
		case 'yes':
		    callback(true);
		    break;

		case 'never':
		    prefs[key] = UPLOAD_NEVER;
		case 'no':
		    callback(false);
		    break;

		default: // should not happen
		    callback(false);
		    break;
		}
	    });

	    p.show();
//	    p.port.emit('resize', null);

	} else {
	    // TODO: android !?
	    console.error("android dialogs are missing");
	    callback(false);
	}
    } else {
	// always|never
	callback((prefs[key] === UPLOAD_ALWAYS));
    }
};
exports.showUploadDialog = showUploadDialog;

var showSecurityDialog = function(callback, manifest) {
    if (os !== "android") {
	var p = panel.Panel({
	    contentURL: self.data.url("securitywarning.html"),
	    width: 480,
	    height: 380,
	    position: {
		top: 160
	    }
	});
	
	p.port.on("resize", function(o) {
	    p.resize(o.width, o.height);
	});
	
	p.port.on("action", function(res) {
	    p.destroy();
	    p = null;
	    callback(res);
	});

	var vals = {
	    dst: manifest.destinations,
	    api: manifest.apidesc,
	    origin : manifest.location.href,
	    description : manifest.description
	};

	p.show();
	p.port.emit("render", vals);

    } else {
	// TODO: android ?!
	console.error("android dialogs are missing");
	callback(false);
    }
};
exports.showSecurityDialog = showSecurityDialog;
