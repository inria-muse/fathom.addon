/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Configuration values. 
 *
 * TODO: store values to a json and add an auto-update mechanism.
 * 
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

/** Baseline measurement intervals (seconds):
 * 1: ~daily baseline measurements (every 120s)
 * 2: ~weekly (aggregate over 10min or at env change)
 * 3: ~monthly (aggregate over 1h or at env change)
 * 4: ~yearly (aggregate over 6h or at env change)
 */
exports.BASELINE_INTERVALS = [120,600,3600,6*3600];

/** Size of baseline tables (sliding window). */
exports.BASELINE_ROWS = [1000, 1600, 1000, 1600];

/** Baseline RTT measurements options. */
exports.BASELINE_PING_OPTS = { 
    count : 10, 
    timeout : 3,
    interval : 0.5 
};

/** Baseline traceroute options. */
exports.BASELINE_TR_OPTS = { 
    count : 2, 
    timeout : 3 
};

/** TTL of network environment (in seconds). */
exports.BASELINE_ENV_TTL = 15;

/** Extra baseline ping/traceroute destination. */
exports.BASELINE_HOST = 'www.google.com';

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

/** Default ping measurement port. */
exports.PING_PORT = 5790;

/** Default iperf measurement port. */
exports.IPERF_PORT = 5791;

/** Propability to run extra measurements towards the whitelisted domains. */
exports.P_MEASURE = 0.33;

/** Alexa top ~50 domains, whitelisted by default for page load monitoring. */
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
