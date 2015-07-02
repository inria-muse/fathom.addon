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
(function() {
	if (typeof self !== "undefined" && self.options.enableperf) {
	 	// delay slightly so we get the LoadEventEnd to the stats
 		setTimeout(function() {
		    var ts = new Date();
			var obj = { 
			    ts : ts.getTime(),
			    timezoneoffset : ts.getTimezoneOffset(),
			    performance: {
			    	navigation : window.performance.navigation,
			    	timing : window.performance.timing,		    
			    	resourcetiming : window.performance.getEntries()
			    },
				protocol : window.location.protocol.replace(':',''),
			    location: {
					host : window.location.host,
					origin : window.location.origin,
					name : window.location.pathname
			    }
			}
			self.port.emit('perf', obj);
		}, 5);
 	}
}());