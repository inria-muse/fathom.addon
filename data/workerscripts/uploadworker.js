/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Background thread to handle data uploads. 
 *
 * FIXME: starting from FF37 we should be able to read directly the 
 * upload queue of the indexedDB in the worker (API will be available)
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

// from: http://stackoverflow.com/questions/2219526/how-many-bytes-in-a-javascript-string
function byteCount(s) {
    return encodeURI(s).split(/%(?:u[0-9A-F]{2})?[0-9A-F]{2}|./).length - 1;
}

onerror = function(event) { 
    dump("error: fathom: ChromeWorker [uploadworker]: " + 
	 JSON.stringify(event) + "\n");
    postMessage(JSON.stringify({error : event}));
};

// messages should be of form { url : <dst>, data : [<objs>] }
onmessage = function(event) {
    var msg,msgdata;
    var evdata = (event.data ? event.data : "");

    try {
	msg = JSON.parse(evdata);
	if (!msg || !msg.url || !msg.data) {
	    postMessage(JSON.stringify({error : "invalid msg: " + data}));
	    return;
	}
	msgdata = JSON.stringify(msg.data);
    } catch (e) {
	postMessage(JSON.stringify({error : "invalid msg: " + e}));
	return;
    }

    var req = new XMLHttpRequest();
    var starttime = performance.now();
    req.open("POST", msg.url);
    req.onreadystatechange = function() {
	var endtime = performance.now();
        if (req.readyState === 4) {
	    var elapsed = (endtime - starttime);

	    if (req.status === 200) {
		var bcount = byteCount(msgdata);
		postMessage(JSON.stringify({
		    elapsed : elapsed,
		    datalen : bcount,
		    rate : (elapsed > 0 ?
			    (bcount * 8.0) / (elapsed/1000.0) : // bits / s
			    undefined)
		}));
	    } else {
		postMessage(JSON.stringify({
		    elapsed : elapsed,
		    error: req.status + '/' + req.statusText,
		}));
	    }
	}
    };
    req.setRequestHeader("Content-Type", "application/json");
    req.send(msgdata);
};
