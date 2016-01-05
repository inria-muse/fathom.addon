/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Misc constants that do not change (config.js for varying consts).
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const self = require("sdk/self");

// Resource string consts
exports.DEBUGURL = self.data.url("tools/debugtool.html");
exports.WELCOMEURL = self.data.url("welcome.html");
exports.WHITELISTURL = self.data.url("whitelist.html");

exports.MAINJSURL = self.data.url("contentscripts/main.js");
exports.APIJSURL = self.data.url("contentscripts/api.js");
exports.ERRORJSURL = self.data.url("contentscripts/error.js");
exports.PAGELOADJSURL = self.data.url("contentscripts/pageload.js");

/** Uploda prefs. */
exports.UPLOAD_ASKME = "askme";
exports.UPLOAD_ALWAYS = "always";
exports.UPLOAD_NEVER = "never";

/** Whitelist control pref. */
exports.WHITELIST = 'whitelist';

/** Enable Fathom API on any page pref. */
exports.FATHOMAPI = 'enablefathomapi';

/** Enable baseline pref. */
exports.BASELINE = 'enablebaseline';

/** Enable baseline uploads pref. */
exports.BASELINE_UPLOAD = 'baselineupload';

/** Enable pageloads pref. */
exports.PAGELOAD = 'enablepageload';

/** Enable pageload uploads. */
exports.PAGELOAD_UPLOAD = 'pageloadupload';

/** Enable homenet uploads pref. */
exports.HOMENET_UPLOAD = 'homenetupload';

/** Enable debug uploads pref. */
exports.DEBUGTOOL_UPLOAD = 'debugtoolupload';

/** 802.11 Hz freqs to channel number mappings. */
exports.freq2channel = {
    // 2.4GHz
    2412 : 1,
    2417 : 2,
    2422 : 3,
    2427 : 4,
    2432 : 5,
    2437 : 6,
    2442 : 7,
    2447 : 8,
    2452 : 9,
    2457 : 10,
    2462 : 11, 
    2467 : 12, 
    2472 : 13, 
    2484 : 14,
    // 5GHz
    5180 : 36,
    5190 : 38,
    5200 : 40,
    5210 : 42,
    5220 : 44,
    5230 : 46,
    5240 : 48,
    5260 : 52,
    5280 : 56,
    5300 : 60,
    5320 : 64,
    5500 : 100,
    5520 : 104,
    5540 : 108,
    5560 : 112,
    5580 : 116,
    5600 : 120,
    5620 : 124,
    5640 : 128,
    5660 : 132,
    5680 : 136,
    5700 : 140,
    5745 : 149,
    5765 : 153,
    5785 : 157,
    5805 : 161,
    5825 : 165,
};

/** Fathom discovery service multicast group */
exports.DISCOVERY_IP = '224.0.0.251';

/** Fathom discovery service port */
exports.DISCOVERY_PORT = 53530;

/** Fathom API service port */
exports.API_PORT = 53531;

/** Fathom default udp/tcp ping server port */
exports.PING_PORT = 5790;

/** Fathom default iperf server port */
exports.IPERF_PORT = 5791;