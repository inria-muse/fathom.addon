/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Configuration constants. TODO: hook somewhere to
 * Firefox's config system so we can change at runtime ?
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

/** Enable Fathom API on any page pref. */
exports.FATHOMAPI = 'enablefathomapi';

/** Enable baseline pref. */
exports.BASELINE = 'enablebaseline';

/** Enable baseline uploads pref. */
exports.BASELINE_UPLOAD = 'baselineupload';

/** Enable homenet uploads pref. */
exports.HOMENET_UPLOAD = 'homenetupload';

/** Enable debug uploads pref. */
exports.DEBUGTOOL_UPLOAD = 'debugtoolupload';

/** Baseline measurement intervals (seconds):
 * 1: baseline measurements (every 120s)
 * 2: ~weekly (aggregate over 10min or at env change)
 * 3: ~monthly (aggregate over 1h or at env change)
 * 4: ~yearly (aggregate over 6h or at env change)
 */
exports.BASELINE_INTERVALS = [120,600,3600,6*3600];

/** Size of baseline tables (sliding window). */
exports.BASELINE_ROWS = [1000, 1600, 1000, 1600];

/** Max num of items to queue for upload. */
exports.UPLOAD_MAX_QUEUE = 1000;

/** Max num of items to upload in a single batch. */
exports.UPLOAD_MAX_BATCH = 100;

/** Upload interval (seconds). */
exports.UPLOAD_INTERVAL = 15*60; // 15min 

/** Upload server address. */
exports.UPLOAD_URL = "https://muse.inria.fr/fathomupload";

/** Measurement Dedibox at Online.net */
exports.MSERVER_HOSTNAME_FR = '62-210-73-169.rev.poneytelecom.eu';
exports.MSERVER_FR = '62.210.73.169';

/** API server address. */
exports.API_URL = 'https://muse.inria.fr/fathomapi';

/** JSONRPC API server local port. */
exports.API_LOCAL_PORT = 53531;

/** Multicast discovery local port. */
exports.DISCOVERY_LOCAL_PORT = 53530;

/** Multicast discovery IP. */
exports.DISCOVERY_LOCAL_IP = '224.0.0.251';
