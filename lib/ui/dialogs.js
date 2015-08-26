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

 const self = require("sdk/self");
 const ss = require("sdk/simple-storage");
 const panel = require("sdk/panel");
 const winutils = require('sdk/window/utils');
 const os = require("sdk/system").platform;
 const prefs = require("sdk/simple-prefs").prefs;

 const consts = require('../consts');

 var showAboutDialog = function(cb) {
    if (os !== "android") {
        var p = panel.Panel({
            contentURL: self.data.url("about.html"),
            width: 420,
            height: 240
        });

        // HACK: panels get lost if they loose focus
        p.on('hide', function() {
            p.show();
        });

        p.on('show', function() {
            p.port.emit("render", {
                'fathom_version' : self.version,
                'fathom_uuid' : ss.storage['uuid']
            });
        });

        p.port.on("resize", function(o) {
            p.resize(o.width, o.height);
        });

        p.port.on("close", function() {
            p.destroy();
            p = undefined;
            if (cb) cb();
        });

        p.show();

    } else {
        // TODO: on android
        console.error("android dialogs are missing");
        if (cb) cb();
    }
};
exports.showAboutDialog = showAboutDialog;

var showUploadDialog = function(callback, tool) {
    var key = tool+'upload';
    if (!prefs[key] || prefs[key] === consts.UPLOAD_ASKME) {
        if (os !== "android") {
            // popup panel
            var p = panel.Panel({
                contentURL: self.data.url("uploadconfirm.html"),
                width: 320,
                height: 200
            });
            
            // HACK: panels get lost if they loose focus
            p.on('hide', function() {
                p.show();
            });

            p.on('show', function() {
                p.port.emit('resize', null);        
            });

            p.port.on("resize", function(o) {
                p.resize(o.width, o.height);
            });
            
            p.port.on("action", function(res) {
                p.destroy();    
                p = undefined;

                switch (res) {
                case 'always':
                    prefs[key] = consts.UPLOAD_ALWAYS;
                case 'yes':
                    callback(true);
                    break;
                case 'never':
                    prefs[key] = consts.UPLOAD_NEVER;
                case 'no':
                    callback(false);
                    break;
                default: // should not happen
                    callback(false);
                    break;
                }
            });
            p.show();

        } else {
            // TODO: android !?
            console.error("android dialogs are missing");
            callback(false);
        }
    } else {
        // always|never
        callback((prefs[key] === consts.UPLOAD_ALWAYS));
    }
};
exports.showUploadDialog = showUploadDialog;

var showSecurityDialog = function(callback, manifest) {
    if (os !== "android") {
        var p = panel.Panel({
            contentURL: self.data.url("securitywarning.html"),
            width: 480,
            height: 400
        });

        p.port.on("resize", function(o) {
            p.resize(o.width, o.height);
        });

        // HACK: panels get lost if they loose focus
        p.on('hide', function() {
            p.show();
        });
        
        p.on('show', function() {
            var vals = {
                dst: manifest.destinations,
                api: manifest.apidesc,
                origin : manifest.location.href,
                description : manifest.description
            };
            p.port.emit("render", vals);
        }); 
        
        p.port.on("action", function(res) {
            p.destroy();
            p = null;
            callback(res);
        });

        p.show();

    } else {
        // TODO: android ?!
        console.error("android dialogs are missing");
        callback(false);
    }
};
exports.showSecurityDialog = showSecurityDialog;
