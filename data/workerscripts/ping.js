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
        client : undefined,   // if defined, run ping cli to this address, else server
        proto : 'udp',        // one of UDP, TCP, HTTP
        port : 5790,          // destination port
        count : 5,            // number of packets
        interval : 1.0,       // interval between packets (s)
        timeout : 10.0,       // time to wait for answer (s)
        srciface : undefined, // src IP
        size : 56,            // number of bytes to send (except HTTP HEAD)
        reports : false,      // periodic reports
        socket : undefined,   // active socket
    };

    // Helper to get high-res timestamps
    var timestamper = function() {
	// current time is calculated as baseTime + (process.hrtime() - baseTimeHr)
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

	var add = function(r,s) {
            if (r.payload)
		delete r.payload;
            reports.push(r);

            if (s) {
		succ += 1;
		r.upd = r.r - r.s; // uplink delay
		updv.push(r.upd);

		r.downd = r.rr - r.r; // downlink delay
		downdv.push(r.downd);

		times.push(r.time); // rtt

		// keep track of the smallest uplink delay
		if (minupdv === undefined)
                    minupdv = r.upd;
		minupdv = Math.min(minupdv,r.upd);

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
            } else {
		fail += 1;
            }
            prevreport = r;
	};

	var stats = function(data) {
            if (!data || data.length<=0) return {};

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
            for (var v in updv)
		tmp.push(v - minupdv);
            updv = tmp;

            tmp = [];
            for (var v in downdv)
		tmp.push(v - mindowndv);
            downdv = tmp;

            var res = {
		proto : settings.proto,
		domain : settings.client,
		ip : settings.client || undefined,
		port : settings.port || 80,
		pings : reports,
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
		},
            };
            return res;
	};

	// reporter API
	return {
	    addreport : add,
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

    // HTTP cli using XMLHttpRequest / HTTP HEAD
    var httpcli = function() {
	if (!settings.client) {
            return {error : "no destination!"};
	}
	return {error : "not implemented"};
    };

    // UDP & TCP ping client.
    var cli = function() {
	if (!settings.client) {
            return {error : "no destination!"};
	}

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
	    settings.callback(rep.getreport(), true); // final report
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
            NSPR.sockets.PR_Send(settings.socket, buf, len, 0, NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);
            sent += 1;

            // now block in Poll for the interval (or until we get an answer back from the receiver)
            pd.fd = settings.socket;
            pd.in_flags = NSPR.sockets.PR_POLL_READ;
	    
            var diff = tr.diff(pstats.s);
            var sleep = settings.interval*1000 - diff;
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
		sleep = settings.interval*1000 - diff;
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
	    
            var rv = NSPR.sockets.PR_Recv(settings.socket, recvbuf, bufsize, 0, settings.timeout*1000);
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
		pstats.rr = ts;           // resp received
		pstats.s = obj.s;         // req sent
		pstats.r = obj.r;         // server received
		pstats.time = pstats.rr - pstats.s; // rtt
		rep.addreport(pstats, true);
		delete reqs[obj.seq]; // TODO: could count dublicates?

		// send intermediate reports?
		if (settings.reports) {
		    settings.callback(pstats, false);
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
            settings.socket = NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
	} else {
            settings.socket = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
	}

	var addr = new NSPR.types.PRNetAddr();
	addr.ip = NSPR.util.StringToNetAddr(settings.client);
	NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrNull,
				   NSPR.sockets.PR_AF_INET,
				   settings.port, addr.address());
	
	if (NSPR.sockets.PR_Connect(settings.socket, addr.address(), settings.timeout*1000) < 0) {
	    NSPR.sockets.PR_Close(settings.socket);
	    return {error : "Error connecting : code = " + NSPR.errors.PR_GetError()};
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

    var start = function(callback, args) {
	// override default settings with given arguments
	args = args || {};
	for (var k in args) {
	    if (args.hasOwnProperty(k))
		settings[k] = args[k];
	}

	debug(settings);

	settings.callback = callback;
	settings.timeout =  NSPR.util.PR_MillisecondsToInterval(settings.timeout * 1000);
	
	if (settings.client) {
	    if (settings.proto === 'http') {
		return httpcli();
	    } else if (settings.proto === 'udp' || settings.proto === 'tcp') {
		return cli();
	    } else {
		return {error : "unsupported client protocol: " + settings.proto};
	    }
	} else {
	    if (settings.proto === 'udp')
		return serv();
	    else
		return {error : "unsupported server protocol: " + settings.proto};
	}
    };

    var stop = function() {
	worker.multirespstop = true;
	return {};
    };

    return { start : start, stop : stop };
}());
