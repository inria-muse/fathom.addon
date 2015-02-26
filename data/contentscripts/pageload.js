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
    setTimeout(function() {
	self.port.emit('perf', { 
	    performance: window.performance,
	    location: {
		host : window.location.host,
		href : window.location.href,
		origin : window.location.origin,
		protocol : window.location.protocol,
	    }
	});
    }, 250);
}
