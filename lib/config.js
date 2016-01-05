/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Fathom configuration management. 
 *
 * The extension has a built-in default configuration in ./data/fathom.json. 
 * Upon first install we store this file to the simple storage, and then request 
 * updates from the configuration server periodically. Configuration updates
 * overwrite the current config in the simple storage. All the other components
 * of the extension access the configuration values via this module so that 
 * they will always see the most recent values.
 * 
 * This module itself depends on the following configuration values (fathom.json):
 *
 * "config" : {
 *    "version"          : 0,                                           // config file version
 *    "url"              : "https://muse.inria.fr/fathom/fathom.json",  // update url
 *    "update_freq_days" : 3                                            // update check frequency
 * }
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const self = require("sdk/self");
const timers = require("sdk/timers");
const ss = require("sdk/simple-storage");

const utils = require("./utils");

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

/* Update stored config. */
var set = function(cfg, reset) {
    if (!cfg || reset) {
        // default configs
        var cfgfile = 'fathom.json';
        if (ss.storage['devmode']) {
            cfgfile = 'fathom-dev.json';
        }
        cfg = JSON.parse(self.data.load(cfgfile));
    }

    if (reset || !ss.storage['config'] || cfg['config']['version'] > ss.storage['config']['config']['version']) {
        if (reset || !ss.storage['config'])
           console.log("config (re)set to defaults from " + cfgfile + " version=" + cfg['config']['version']);
        else
           console.log("config update to version=" +  cfg['config']['version']);

        ss.storage['config'] = cfg;
        ss.storage['config']['config']['last_update'] = new Date(); 
    }
};

/* Check if a new config is available. */
var update = exports.update = function() {    
    console.log("config check for update " + ss.storage['config']['config']['url']);

    utils.getJSON(function(newcfg) {
        if (newcfg && !newcfg.error && newcfg['config']) {
            if (newcfg['config']['version'] === 0) {
                set(undefined, true);
            } else if ((newcfg['config']['version'] > ss.storage['config']['config']['version'])) {
                set(newcfg);
            }
        } else {
            console.log("config update check failed", newcfg);
        }

        // schedule next
        timers.setTimeout(function() {
            update();
        }, ss.storage['config']['config']['update_freq_days'] * 24 * 3600 * 1000);

    }, ss.storage['config']['config']['url']);
};

// init or update if shipped with a new config
set(); 

// first update timer
timers.setTimeout(function() { 
    update();
}, 10000);