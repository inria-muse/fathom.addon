/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
   */

/** 
 * @fileoverview Fathom popup dialogs.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>
 */
const self = require("sdk/self");
const ss = require("sdk/simple-storage");
const prefs = require("sdk/simple-prefs").prefs;

const utils = require('../utils');
const consts = require('../consts');

if (utils.isAndroid()) {

    console.warn("android ui not implemented");

    // FIXME: implement as new tabs ?    
    exports.showSecurityDialog = function(cb) { cb(false); };
    exports.showUploadDialog = function(cb) { cb(false); };
    exports.showAboutDialog = function(cb) { cb(false); };

} else {
    // desktop dialogs
    const panel = require("sdk/panel");
    const tabs = require("sdk/tabs");

    var showAboutDialog = function(cb) {
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
                'fathom_version' : self.version+'.'+ss.storage['config']['config']['version'],
                'fathom_uuid' : ss.storage['uuid']
            });
        });

        p.port.on("action", function(action) {
            switch (action.what) {
            case "resize":
                p.resize(action.arg.width, action.arg.height);
                break;

            case "open":
                p.destroy();
                p = null;
                tabs.open({url: action.arg});
                break;

            case "close":
            default:
                p.destroy();
                p = null;
                if (cb) cb();
            }
        });

        p.show();
    };
    exports.showAboutDialog = showAboutDialog;

    var showUploadDialog = function(callback, tool) {
        var key = tool+'upload';
        if (!prefs[key] || prefs[key] === consts.UPLOAD_ASKME) {
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

            p.port.on("action", function(action) {
                switch (action.what) {
                case "resize":
                    p.resize(action.arg.width, action.arg.height);
                    break;

                case "allow":
                    p.destroy();
                    p = null;

                    switch (action.arg) {
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
                    break;

                default:
                    p.destroy();
                    p = null;
                    callback(false);
                }
            });

            p.show();
        } else {
            // always|never
            callback((prefs[key] === consts.UPLOAD_ALWAYS));
        }
    };
    exports.showUploadDialog = showUploadDialog;

    var showSecurityDialog = function(callback, manifest) {
        var p = panel.Panel({
            contentURL: self.data.url("securitywarning.html"),
            width: 480,
            height: 420
        });

        // HACK: panels get lost if they loose focus
        p.on('hide', function() {
            p.show();
        });

        // send manifest to be rendered
        p.on('show', function() {
            var vals = {
                dst: manifest.destinations,
                api: manifest.apidesc,
                origin : manifest.location.href,
                description : manifest.description
            };
            p.port.emit("render", vals);
        }); 

        p.port.on("action", function(action) {
            switch (action.what) {
            case "resize":
                p.resize(action.arg.width, action.arg.height);
                break;

            case "allow":
            default:
                p.destroy();
                p = null;
                callback(action.arg || false);
            }
        });

        p.show();
    };
    exports.showSecurityDialog = showSecurityDialog;
}