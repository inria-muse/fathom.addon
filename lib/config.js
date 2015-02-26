/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Configuration constants. 
 *
 * TODO: hook somewhere to Firefox's config system so we can change 
 * at runtime ?
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

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

/** Baseline measurement intervals (seconds):
 * 1: ~daily baseline measurements (every 120s)
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
exports.UPLOAD_MAX_BATCH = 50;

/** Upload interval (seconds). */
exports.UPLOAD_INTERVAL = 15*60; // 15min 

/** Upload server address. */
exports.UPLOAD_URL = "https://muse.inria.fr/fathomupload";

/** Set to true do disable uploads. */
exports.UPLOAD_DISABLE = false;

/** Measurement Dedibox at Online.net */
exports.MSERVER_HOSTNAME_FR = '62-210-73-169.rev.poneytelecom.eu';
exports.MSERVER_FR = '62.210.73.169';

/** API server address (IP and MAC lookups). */
exports.API_URL = 'https://muse.inria.fr/fathomapi';

/** Multicast discovery default port. */
exports.DISCOVERY_PORT = 53530;

/** Multicast discovery IP. */
exports.DISCOVERY_IP = '224.0.0.251';

/** JSONRPC API server default port. */
exports.API_PORT = 53531;

/** Default ping service port. */
exports.PING_PORT = 53532;

/** Alexa top ~50 pages, whitelisted by default for pageload monitoring. */
exports.ALEXA_TOP = [
    'google.*', // any country code
    'amazon.*', // any country code
    'yahoo.*',  // any country code
    'facebook.com',
    'youtube.com',
    'baidu.com',
    'wikipedia.org',
    'twitter.com',
    'qq.com',
    'taobao.com',
    'live.com',
    'linkedin.com',
    'sina.com.cn',
    'weibo.com',
    'tmall.com',
    'blogspot.com',
    'ebay.com',
    'hao123.com',
    'reddit.com',
    'bing.com',
    'instagram.com',
    'yandex.ru',
    'sohu.com',
    'tumblr.com',
    'wordpress.com',
    'imgur.com',
    'pinterest.com',
    'msn.com',
    'vk.com',
    'paypal.com',
    'microsoft.com',
    't.co',
    'aliexpress.com',
    'apple.com',
    'imdb.com',
    'fc2.com',
    'ask.com',
    'alibaba.com',
    '360.cn',
    'stackoverflow.com',
    'adcash.com',
    'mail.ru',
    'netflix.com'
];
