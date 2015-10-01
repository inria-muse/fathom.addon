/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Fathom configuration management. 
 *
 * The extension has a build-in default configuration in ./data/fathom.json. 
 * Upon first install we store this file to the simple storage, and then request 
 * updates from the configuration server periodically. Configuration updates
 * overwrite the current config in the simple storage. All the other components
 * of the extension access the configuration values via this module so that 
 * they will always see the most recent values.
 * 
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const self = require("sdk/self");
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");
const Request = require("sdk/request").Request;

/** Get the current configuration. If module is defined, only module config
 *  is returned; and if param is defined, the value. Otherwise returns the full
 *  configuration object.
 */
var get = exports.get = function(module, param) {
    var cfg = ss.storage['config'];

    if (module && param) {
        if (cfg[module] === undefined) {
            throw "no such config module: " + module;
        } else if (cfg[module][param] === undefined) {
            throw "no such config param: " + module + "." + param;
        }
        return cfg[module][param];

    } else if (module) {
        if (cfg[module] === undefined)
            throw "no such config module: " + module;

        return cfg[module];
    } else {
        return cfg;
    }
};

var set = function(cfg) {
    if (!cfg) {
        ss.storage['config'] = JSON.parse(self.data.load('fathom.json'));
        console.log("config (re)set to defaults");
    } else {
        ss.storage['config'] = cfg;
        console.log("config updated to " +  ss.storage['config']['config']['version']);
    }
    ss.storage['config']['config']['last_update'] = new Date(); 
};

/* Check if a new config is available. */
var update = exports.update = function() {    
    console.log("config check for update " + ss.storage['config']['config']['url']);

    Request({
        url: ss.storage['config']['config']['url'],
        onComplete: function(res) {
            if (res.status == 200) {
                var newcfg = res.json;
                if (newcfg['config'] && newcfg['config']['version'] === 0) {
                    set();
                } else if (newcfg['config'] && (newcfg['config']['version'] > ss.storage['config']['config']['version'])) {
                    set(newcfg);
                } // else nothing to do
            } else {
                console.log("config failed to check updates: [" + res.status + "] " + res.statusText);
            }

            // schedule next
            timers.setTimeout(function() {
                update();
            }, ss.storage['config']['config']['update_freq_days'] * 24 * 3600 * 1000);
        }
    }).get();
};

if (!ss.storage['config']) {
    set();
}

timers.setTimeout(function() { 
    update();
}, 1000);