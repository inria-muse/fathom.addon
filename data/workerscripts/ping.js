/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew tools.ping.* implementation.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

tools.ping = (function() {
    // default settings
    var settings = {
        id : -1,
        client : undefined,   // client destination
        port : undefined,     // ping port
        proto : 'udp',        // one of UDP, TCP, HTTP, WS, XMLHTTPREQ 
        count : 3,            // number of packets to send
        interval : 1.0,      // interval between packets (s)
        timeout : 10.0,       // time to wait for answer (s)
        size : 56,            // number of bytes to send (except HTTP reqs)
        reports : false,      // periodic reports
        socket : undefined    // active socket
    };

    // Helper to get high-res timestamps
    var timestamper = function() {
	// current time is calculated as 
	// baseTime + (process.hrtime() - baseTimeHr)
	var baseTime = gettimets()*1.0; // milliseconds since epoch
	var baseTimeHr = gettime(); // high-res timestamp
	
	// get base reference time
	this.getbasets = function() {
            return baseTime + 0.0;
	};

	// get current time
	this.getts = function() {
            var hrt = gettime();
            var diff = hrt-baseTimeHr;
            return baseTime + diff;
	};

	// diff between now and ts
	this.diff = function(ts) {
            return Math.abs(ts - this.getts());
	};
    };

    // Results reporter
    var reporter = function() {
	var reports = [];// raw reports
	var times = [];  // rtts
	var upj = [];    // uplink jitter
	var downj = [];  // downlink jitter
	
	var updv = [];   // uplink delay variation
	var downdv = []; // downlink delay variation
	
	var minupdv = undefined;
	var mindowndv = undefined;
	
	var succ = 0;
	var fail = 0;
	var prevreport = undefined;

	// additional reporting depending on proto
	var extra = {};

	var addextra = function(key, value) {
	    extra[key] = value;
	}

	var add = function(r,s) {
            if (r.payload)
		delete r.payload;
            reports.push(r);

            if (s) {
		succ += 1;
		times.push(r.time); // rtt

		if (r.r) {
		    // we have server timestamp

		    r.upd = r.r - r.s; // uplink delay
		    updv.push(r.upd);

		    // keep track of the smallest uplink delay
		    if (minupdv === undefined)
			minupdv = r.upd;
		    minupdv = Math.min(minupdv,r.upd);

		    r.downd = r.rr - r.r; // downlink delay
		    downdv.push(r.downd);

		    // keep track of the smallest downlink delay
		    if (mindowndv === undefined)
			mindowndv = r.downd;
		    mindowndv = Math.min(mindowndv,r.downd);

		    if (prevreport && prevreport.seq == r.seq-1) {
			// jitter (RFC 1889)
			if (prevreport.upj) {
			    r.upj = 15.0/16.0 * prevreport.upj +
				1.0/16.0 * Math.abs(r.upd-prevreport.upd)
			    r.downj = 15.0/16.0 * prevreport.downj +
				1.0/16.0 * Math.abs(r.downd-prevreport.downd)
			} else {
			    // first jitter (we've got at least two measurements)
			    r.upj = Math.abs(r.upd-prevreport.upd)
			    r.downj = Math.abs(r.downd-prevreport.downd)
			}
			upj.push(r.upj);
			downj.push(r.downj);
		    }
		}
            } else {
		fail += 1;
            }
            prevreport = r;
	};

	var stats = function(data) {
            if (!data || data.length<=1) return {};

            var min = undefined;
            var max = undefined;

            // mean
            var sum = 0.0;
            for (var i = 0; i< data.length; i++) {
		var v = data[i];
		sum += v;
		if (min === undefined)
                    min = v;
		min = Math.min(min,v);
		if (max === undefined)
                    max = v;
		max = Math.max(max,v);
            };
            var avg = (1.0 * sum) / data.length;

            // variance
            var v = 0.0;
            for (var i = 0; i< data.length; i++) {
		var v = data[i];
		v += (v-avg)*(v-avg);
            };
            v = (1.0 * v) / data.length;

            return {
		min : min,
		max : max,
		avg : avg,
		variance : v,
		mdev : Math.sqrt(v),
            };
	};
	
	var get = function() {
            // this will be called only when everything is sent?
            // TODO : may not always be true?
            var sent = settings.count;
            fail = sent - succ; // not all failures get reported...

            // scale one-way-delays so that min is 0
            // measures variation with respect to the
            // fastest one-way-delay (could think of as buffering!)
            var tmp = [];
            for (var i = 0; i < updv.length; i++)
		tmp.push(Math.abs(updv[i] - minupdv));
            updv = tmp;

            tmp = [];
            for (var i = 0; i < downdv.length; i++)
		tmp.push(Math.abs(downdv[i] - mindowndv));
            downdv = tmp;

            var res = {
		proto : settings.proto,
		domain : settings.client,
		ip : settings.client,
		port : settings.port,
		pings : reports,
		extra : extra,
		stats : {
                    packets : {
			sent : sent,
			received : succ,
			lost : fail,
			lossrate : (fail*100.0) / sent,
			succrate : (succ*100.0) / sent,
                    },
                    rtt : stats(times),
                    upjitter : stats(upj),
                    downjitter : stats(downj),
                    updv : stats(updv),
                    downdv : stats(downdv),
		}
            };
            return res;
	};

	// reporter API
	return {
	    addreport : add,
	    addextra : addextra,
	    getlen : function() { return reports.length;},
	    getreport : get
	};
    }; // Reporter

    // get JSON object from ctype buffer
    var getobj = function(buf,strbuf) {
	var data = buf.readString();

	if (settings.proto === "udp") {
            // object per UDP datagram
            try {
		var obj = JSON.parse(data);
		return obj;
            } catch (e) {
		debug('malformed ping response: '+e);
		debug(data);
            }
	} else {
            // in TCP stream objects are separated by double newline
            var delim = data.indexOf('\n\n');
            while (delim>=0) {
		strbuf += data.substring(0,delim);
		try {
                    var obj = JSON.parse(strbuf);
                    return obj;
		} catch (e) {
                    debug('malformed ping response: '+e);
                    debug(strbuf);
		}
		data = data.substring(delim+2);
		delim = data.indexOf('\n\n');
		strbuf = '';
            } // end while

            strbuf += data;
	}
	return undefined;
    };

    // put obj to ArrayBuffer
    var setobj = function(obj,buf) {
	var str = JSON.stringify(obj);
	if (settings.proto === "tcp")
            str += "\n\n";

	var bufView = new Uint8Array(buf);
	for (var i=0; i<str.length; i++) {
            bufView[i] = str.charCodeAt(i);
	}
	bufView[i] = 0;
	return str.length;
    };

    // HTTP cli using Fathom sockets + HTTP HEAD
    var httpcli = function() {
	var tr = new timestamper();
	return {error : "not implemented"};
    };

    // HTTP cli using XMLHttpRequest HEAD
    var xmlhttpreqcli = function() {
	var tr = new timestamper();

	// reporting
	var rep = reporter(true);
	var sent = 0;
	var resp = 0;

	var done = function() {
	    settings.callback(undefined, rep.getreport(), true);
	    setTimeout(cleanup,0);
	};

	// request sender
	var snd = function() {
            var pstats = {
		seq:sent,     // seq no
		s:null,       // time sent
            };


	    // create unique url for each req to avoid cached responses
	    var url = 'http://'+settings.client+'/?ts='+tr.getts();
	    debug('ping','xmlhttpreq ' + url);

	    var req = new XMLHttpRequest({ 
		mozAnon : true, 
		mozSystem : true
	    });
	    req.timeout = settings.timeout;
	    req.open('HEAD', url, true);
	    req.setRequestHeader('Connection','keep-alive');
	    req.onreadystatechange = function() {
		var ts = tr.getts();
		
		// ignore the first request (includes conn setup)
		if (req.readyState==4 && pstats.seq>0) {
		    resp += 1;
		    if (req.status >= 200 && req.status < 400) {
			pstats.status = req.status; // status code
			pstats.rr = ts;             // time resp received
			pstats.time = pstats.rr - pstats.s; // rtt

			// server date for owd calculations if avail
			var serverd = req.getResponseHeader('Date');
			if (serverd)
			    pstats.r = Date.parse(serverd);

			rep.addreport(pstats, true);

			// send intermediate reports?
			if (settings.reports) {
			    settings.callback(undefined, pstats, false);
			}
		    }

		    if (resp === settings.count) {
			done();		    
		    }
	    
		} else if (req.readyState==4 && pstats.seq==0) {
		    // handle the first response (includes conn setup delay)
		    if (req.status >= 200 && req.status < 400) {
			var tmp = 
			    req.getAllResponseHeaders().trim().split('\n'); 
			var h = {};
			for (var i = 0; i < tmp.length; i++) {
			    var headline = tmp[i].trim().split(': ');
			    if (headline.length == 2) {
				var k = headline[0].trim().toLowerCase();
				h[k] = headline[1].trim();
				if (k === 'date')
				    h['server_ts'] = Date.parse(h[k]);
			    } // else some weird format - just ignore
			}
			rep.addextra('headers',h);
		    }
		    pstats.status = req.status;         // status code
		    pstats.rr = ts;                     // time resp received
		    pstats.time = pstats.rr - pstats.s; // connection rtt
		    rep.addextra('conn_setup',pstats);
		} // else some other state
	    }

	    pstats.s = tr.getts();
	    req.send();
            sent += 1;
	    
            // schedule next round (sending 1 extra ping due to conn setup)
            if (sent <= settings.count) {
		var diff = tr.diff(pstats.s);
		var sleep = settings.interval*1000.0 - diff;
		if (sleep<0 || sent == 1) // dont sleep after first ping
		    sleep = 0;
		setTimeout(snd, sleep);
            }
	}; // snd

	// start pinging
        setTimeout(snd,0);

	// dummy socketid (socketworker requires a ret value)
	return -1;	
    };

    // WebSocket cli
    var wscli = function() {
	var tr = new timestamper();
	return {error : "not implemented"};
    };

    // Fathom UDP & TCP ping client.
    var cli = function() {
	var tr = new timestamper();

	// fill the request with dummy payload upto requested num bytes
	var stats = {
            seq:0,
            s:tr.getts(),
	};
	if (settings.size && settings.size>0) {
            var i = 0;
            for (i = 0; i < settings.size; i++) {
		if (JSON.stringify(stats).length >= settings.size)
                    break;
		
		if (!stats.payload)
                    stats.payload = "";
		stats.payload += ['1','2','3','4'][i%4];
            }
	};

	// reporting
	var rep = reporter(true);
	var sent = 0;

	var done = function() {
	    settings.callback(undefined, rep.getreport(), true);
	    setTimeout(cleanup,0);
	};

	// Practical limit for IPv4 TCP/UDP packet data length is 65,507 bytes.
	// (65,535 - 8 byte TCP header - 20 byte IP header)
	var bufsize = settings.size*2;
	if (bufsize > 65507)
            bufsize = 65507;
	var buf = new ArrayBuffer(bufsize);

	// incoming data handler
	var recvbuf = getBuffer(bufsize);
	var strbuf = '';

	// request sender
	var reqs = {};
	var pd = new NSPR.types.PRPollDesc();
	var snd = function() {
            var pstats = {
		seq:sent,
		s:tr.getts(),
            };
            if (stats.payload)
		pstats.payload = stats.payload;
            reqs[pstats.seq] = pstats;
	    
            var len = setobj(pstats,buf);
            NSPR.sockets.PR_Send(settings.socket, 
				 buf, 
				 len, 
				 0, 
				 NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);
            sent += 1;
	    pstats.sent_len = len;

            // now block in Poll for the interval (or until we get
	    // an answer back from the receiver)
            pd.fd = settings.socket;
            pd.in_flags = NSPR.sockets.PR_POLL_READ;
	    
            var diff = tr.diff(pstats.s);
            var sleep = settings.interval*1000.0 - diff;
            if (sleep<0)
		sleep = 0;
	    
            var prv = NSPR.sockets.PR_Poll(pd.address(), 1, Math.floor(sleep));
            if (prv < 0) {
		// Failure in polling
		error("ping: poll fails: " + NSPR.errors.PR_GetError());
		done();
		return;
            } else if (prv > 0) {
		rcv(true);
            } // else timeout
	    
            // schedule next round ?
            if (sent < settings.count) {
		diff = tr.diff(pstats.s);
		sleep = settings.interval*1000.0 - diff;
		if (sleep<0)
                    sleep = 0;
		setTimeout(snd, sleep);
            } else {
		rcv(false); // make sure we have all answers
            }
	}; // snd
	
	var rcv = function(noloop) {
            if (!settings.socket)
		return;
	    
            var rv = NSPR.sockets.PR_Recv(settings.socket, 
					  recvbuf, 
					  bufsize, 
					  0, 
					  settings.timeout*1000);
            var ts = tr.getts();
	    
            if (rv == -1) {
		var e = NSPR.errors.PR_GetError();
		if (e !== NSPR.errors.PR_IO_TIMEOUT_ERROR) {
		    error("ping: recv fails: " + e);
		} // else nothing more to read
		done();
		return;

            } else if (rv == 0) {
		error("ping: network connection closed");
		done();
		return;

            } // else got response
	    
            // make sure the string terminates at correct place as buffer reused
            recvbuf[rv] = 0;
	    var obj = getobj(recvbuf,strbuf);

            if (obj && obj.seq!==undefined && obj.seq>=0) {
		var pstats = reqs[obj.seq];
		pstats.recv_len = rv;     // reply bytes
		pstats.rr = ts;           // resp received
		pstats.s = obj.s;         // req sent
		pstats.r = obj.r;         // server received
		pstats.time = pstats.rr - pstats.s; // rtt
		rep.addreport(pstats, true);
		delete reqs[obj.seq]; // TODO: could count duplicates?

		// send intermediate reports?
		if (settings.reports) {
		    settings.callback(undefined, pstats, false);
		}
            }

            if (rep.getlen() === settings.count) {
		done();
            } else if (!noloop) {
		setTimeout(rcv,0); // keep reading
            }
	}; // rcv

	// create and connect the socket
	if (settings.proto === 'tcp') {
            settings.socket = 
		NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
	} else {
            settings.socket = 
		NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
	}

	var addr = new NSPR.types.PRNetAddr();
	addr.ip = NSPR.util.StringToNetAddr(settings.client);
	NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrNull,
				   NSPR.sockets.PR_AF_INET,
				   settings.port, addr.address());
	
	var rc = NSPR.sockets.PR_Connect(settings.socket, 
					 addr.address(), 
					 settings.timeout*1000);
	if (rc < 0) {
	    NSPR.sockets.PR_Close(settings.socket);
	    return {error : "Error connecting : code = " + 
		    NSPR.errors.PR_GetError()};
	}

        setTimeout(snd,0);

	// for cleanup with the socketworker
	return settings.socket;	
    }; // cli

    // UDP ping server
    var serv = function() {
	// Practical limit for IPv4 TCP&UDP packet data length is 65,507 bytes.
	// (65,535 - 8 byte UDP header - 20 byte IP header)
	var bufsize = 65507;
	var recvbuf = getBuffer(bufsize);
	var buf = new ArrayBuffer(bufsize);

	var pd = new NSPR.types.PRPollDesc();
	var tr = new timestamper();

	var rcv = function() {
            if (worker.multirespstop) {
		setTimeout(cleanup,0);
		return;
            }

            // now block in Poll for the interval (or until we get an answer back from the receiver)
            pd.fd = settings.socket;
            pd.in_flags = NSPR.sockets.PR_POLL_READ;

            var prv = NSPR.sockets.PR_Poll(pd.address(), 1, 250);

            if (worker.multirespstop) {
		setTimeout(cleanup,0);
		return;
            }

            if (prv > 0) {
		// something to read
		var peeraddr = new NSPR.types.PRNetAddr();
		var rv = NSPR.sockets.PR_RecvFrom(settings.socket, recvbuf, bufsize, 0,
						  peeraddr.address(), NSPR.sockets.PR_INTERVAL_NO_WAIT);
		var ts = tr.getts();
		if (rv > 0) {
                    // make sure the string terminates at correct place as buffer reused
                    recvbuf[rv] = 0;
                    var obj = getobj(recvbuf);
                    if (obj && obj.seq!==undefined) {
			obj.r = ts;
			obj.ra = NSPR.util.NetAddrToString(peeraddr);
			obj.rp = NSPR.util.PR_ntohs(peeraddr.port);
			
			var len = setobj(obj,buf);
			NSPR.sockets.PR_SendTo(settings.socket, buf, len, 0,
                                               peeraddr.address(), NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);
                    }
		}
            } // else nothing to read

            if (worker.multirespstop) {
		setTimeout(cleanup,0);
		return;
            }

	    setTimeout(rcv, 0); // reloop
	}; // rcv

	// create and connect the socket
	settings.socket = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);

	var addr = new NSPR.types.PRNetAddr();
	NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrAny,
				   NSPR.sockets.PR_AF_INET,
				   settings.port, addr.address());

	if (NSPR.sockets.PR_Bind(settings.socket, addr.address()) < 0) {
	    NSPR.sockets.PR_Close(settings.socket);
            return {error : "Error binding : code = " + NSPR.errors.PR_GetError()};
	} 

        setTimeout(rcv,0); // start receiving pings

	return settings.socket;
    }; // serv

    // ------ API ------
    var start = function(callback, dst, args) {
	if (!dst) {
            return {error : "no destination!"};
	}
	settings.client = dst;

	// override default settings with given arguments
	args = args || {};
	for (var k in args) {
	    if (args.hasOwnProperty(k))
		settings[k] = args[k];
	}

	debug('ping',settings);

	settings.callback = callback;
	settings.timeout =  NSPR.util.PR_MillisecondsToInterval(settings.timeout * 1000);
	
	if (settings.proto === 'http') {
	    return httpcli();
	} else if (settings.proto === 'xmlhttpreq') {
	    return xmlhttpreqcli();
	} else if (settings.proto === 'ws') {
	    return wscli();
	} else if (settings.proto === 'udp' || settings.proto === 'tcp') {
	    return cli();
	} else {
	    return {
		error : "unsupported ping client protocol: " + settings.proto
	    };
	}
    };

    var start_server = function(callback, args) {
	// override default settings with given arguments
	args = args || {};
	for (var k in args) {
	    if (args.hasOwnProperty(k))
		settings[k] = args[k];
	}

	debug('ping',settings);

	settings.callback = callback;
	settings.timeout =  NSPR.util.PR_MillisecondsToInterval(settings.timeout * 1000);
	
	if (settings.proto === 'udp')
	    return serv();
	else
	    return {
		error : "unsupported ping server protocol: " + settings.proto
	    };
    };

    var stop_server = function() {
	worker.multirespstop = true;
	return {};
    };

    // API tools.ping.*
    return { start : start, 
	     start_server : start_server, 
	     stop_server : stop_server 
	   };
}());
