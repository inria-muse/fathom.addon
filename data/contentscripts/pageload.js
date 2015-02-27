/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew A simple content script to fetch the performance
 * object of the page for pageload times monitoring.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
if (typeof self !== "undefined" && self.options.enableperf) {
    var ts = new Date();
    setTimeout(function() {
	self.port.emit('perf', { 
	    ts : ts.getTime(),
	    timezoneoffset : ts.getTimezoneOffset(),
	    performance: window.performance,
	    https : (window.location.protocol === 'https:'),
	    http : (window.location.protocol === 'http:'),
	    location: {
		origin : window.location.origin,
		host : window.location.host
	    }
	});
    }, 250);
}
