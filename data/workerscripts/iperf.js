/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew tools.iperf.* implementation.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * The code follows roughly the iperf 2.0.5:
 * http://sourceforge.net/projects/iperf/
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

tools.iperf = (function() {
    const kKilo_to_Unit = 1024;
    const kMega_to_Unit = 1024 * 1024;
    const kGiga_to_Unit = 1024 * 1024 * 1024;

    const kkilo_to_Unit = 1000;
    const kmega_to_Unit = 1000 * 1000;
    const kgiga_to_Unit = 1000 * 1000 * 1000;

    const HEADER_VERSION1 = 0x80000000;
    const RUN_NOW = 0x00000001;
    const RUN_CLIENT = 0x00000002;

    const kDefault_UDPRate = 1024 * 1024; // -u  if set, 1 Mbit/sec
    const kDefault_UDPBufLen = 1470;      // -u  if set, read/write 1470 bytes

    const ThreadMode = {
	kMode_Unknown : 0,
	kMode_Server : 1,
	kMode_Client : 2,
	kMode_Reporter : 3, // not used
	kMode_Listener : 4,
    };

    const TestMode = {
	kTest_Normal : 0,
	kTest_DualTest : 1,
	kTest_TradeOff : 2,
	kTest_ServeClient : 3, // server acts as client
	kTest_Unknown : 4,
    };

    // the final result object, posted upon client ready or
    // in server mode after a client is served
    var initres = function() {
	return {
            snd_reports : [],  
            snd_total : undefined,
	    snd_rcv_total : undefined,
            rcv_reports : [],     
            rcv_total : undefined,
	};
    };

    // convert input string to bytes based on suffix [GMKgmk]
    // i.e. 1K -> 1024 bytes, 1k -> 1000 bytes and so on
    var bytestrtonum = function(str) {
	var num;
	var suffix = '0';

	var pattern = /(\d+)([A-Za-z]*)/;
	var tmp = str.match(pattern);
	num = parseInt(tmp[1]);
	suffix = tmp[2];

	/* convert according to [Gg Mm Kk] */
	switch (suffix) {
	case 'G':  num *= kGiga_to_Unit; break;
	case 'M':  num *= kMega_to_Unit; break;
	case 'K':  num *= kKilo_to_Unit; break;
	case 'g':  num *= kgiga_to_Unit; break;
	case 'm':  num *= kmega_to_Unit; break;
	case 'k':  num *= kkilo_to_Unit; break;
	default: break;
	}
	return num;
    };

    // convert bytes to a number based on format [GMKgmk]
    var numtoformat = function(num, format) {
	var islower = (format == format.toLowerCase());
	if (islower) {
            num *= 8; // bytes -> bits
	}

	switch (format) {
	case 'G':  num *= (1.0/kGiga_to_Unit); break;
	case 'M':  num *= (1.0/kMega_to_Unit); break;
	case 'K':  num *= (1.0/kKilo_to_Unit); break;
	case 'g':  num *= (1.0/kgiga_to_Unit); break;
	case 'm':  num *= (1.0/kmega_to_Unit); break;
	case 'k':  num *= (1.0/kkilo_to_Unit); break;
	default: break;
	}
	return num;
    };

    var tv_sec = function(ts) {
	// ts in in milliseconds, get seconds (truncate)
	return ~~(ts/1000.0);
    };

    var tv_usec = function(ts) {
	// ts in milliseconds, get microseconds (truncate)
	var s = ~~(ts/1000.0); // seconds
	var us = 1000000.0*(ts/1000.0 - s); // microsec
	return ~~(us);
    };

    var tv_msec = function(ts) {
	// ts in milliseconds, get milliseconds (truncate)
	return Math.round(ts);
    };

    // corresponds to iperf struct thread_Settings
    // just removed stuff we don't support (writing files for example)
    //
    // Initialized with iperf default settings, overriden by user args
    var settings = {
	mBuf : undefined, 

	mHost : undefined,              // -c
	mLocalhost : undefined,         // -B

	// int's
	mBufLen : 128 * 1024,            // -l
	mMSS : 0,                        // -M
	mTCPWin : 0,                     // -w
	mSock : undefined,
	mTransferID : 0,

	// flags
	mBufLenSet : false,              // -l
	mNodelay : false,                // -N
	//    mPrintMSS : false,               // -m
	mUDP : false,                    // -u
	mMode_Time : true,
	mSingleUDP : false,              // -U

	// enums (which should be special int's)
	mThreadMode : ThreadMode.kMode_Unknown,  // -s or -c
	mMode : TestMode.kTest_Normal,   // -r or -d

	// Hopefully int64_t's -> 53bits in javascript reality
	mUDPRate : 0,                    // -b or -u
	mAmount : 10000,                 // -n or -t

	// doubles
	mInterval : 1000,                // -i

	// shorts
	mListenPort : 0,                 // -L
	mPort : 5001,                    // -p

	// chars
	//    mTTL : 1                         // -T
    };

    var configure = function(args) {
	if (args.client) {
	    // client mode
	    settings.mHost = args.client;
	    settings.mThreadMode = ThreadMode.kMode_Client;

	} else {
	    // start in listener mode
	    settings.mThreadMode = ThreadMode.kMode_Listener;
	    if (args.proto==='udp') {
		settings.mUDP = true;
		// serve single client only?
		settings.mSingleUDP = (args.multi ? false : true);
		settings.mBufLen = kDefault_UDPBufLen;
	    }
	}

	// common options of clients and servers

	settings.mLocalhost = args.bind || settings.mLocalhost;

	if (args.len && args.len>0) {
	    settings.mBufLen = bytestrtonum(args.len);
	    settings.mBufLenSet = true;
	}

	if (args.ttl && args.ttl>0) {
	    settings.mTTL = args.ttl;
	}
	
	if (args.mss && args.mss>0) {
	    settings.mMSS = args.mss;
	}
	
	if (args.window && args.window>0) {
	    settings.mTCPWin = bytestrtonum(args.window);
	}

	if (args.interval && args.interval>0) {
	    settings.mInterval = args.interval*1000.0; // ms
	}

	//    if (args.print_mss) {
	//	settings.mPrintMSS = true;
	//    }

	if (args.nodelay) {
	    settings.mNodelay = true;
	}

	if (args.port) {
	    settings.mPort = args.port;
	}

	// client specific options
	if (settings.mThreadMode == ThreadMode.kMode_Client) {
	    if (args.proto === "udp") {
		settings.mUDP = true;
		if (!settings.mBufLenSet)
		    settings.mBufLen = kDefault_UDPBufLen;

		if (args.bandwidth) {
		    settings.mUDPRate = bytestrtonum(args.bandwidth);
		} else {
		    settings.mUDPRate = kDefault_UDPRate;
		}
	    }

	    // duration by bytes or time
	    if (args.time && args.time>0) {
		settings.mMode_Time = true;
		settings.mAmount = args.time * 1000.0; // ms
	    } else if (args.num) {
		settings.mMode_Time = false;
		settings.mAmount = bytestrtonum(args.num);
	    }

	    // test modes
	    if (args.tradeoff) {
		settings.mMode = TestMode.kTest_TradeOff;
//	    } else if (args.dualtest) {
//		settings.mMode = TestMode.kTest_DualTest;
	    } else if (args.serveclient) {
		settings.mMode = TestMode.kTest_ServeClient;
	    }

	    if (args.listenport) {
		settings.mListenPort = args.listenport;
	    }
	}

	// single shared send/recv buffer
	settings.mBuf = new ArrayBuffer(settings.mBufLen, 0, settings.mBufLen);

	settings.configured = true;
    };

    // udp headers:
    //    int32_t id
    //    u_int32_t tv_sec
    //    u_int32_t tv_usec
    //
    var write_UDP_header = function(message, id, ts) {
	message.setInt32(0*4, id, false);
	message.setUint32(1*4, tv_sec(ts), false);
	message.setUint32(2*4, tv_usec(ts), false);
    };
    var read_UDP_header = function(message, obj) {
	// sec.usec -> milliseconds (double)
	var sec = message.getUint32(1*4, false);
	var usec = message.getUint32(2*4, false);
	var ts = 1000.0*sec + usec/1000.0;

	obj.packetID = message.getInt32(0*4, false);
	obj.ts = ts;
    };

    // client headers for bidirectional testing:
    //    int32_t flags
    //    int32_t numThreads
    //    int32_t mPort
    //    int32_t bufferlen
    //    int32_t mWinBand
    //    int32_t mAmount
    //
    var write_client_header = function(message) {
	var offset = 0; // first cli header word
	if (settings.mUDP)
	    offset = 3; // comes after the packet header

	// dual test mode
	if (settings.mMode === TestMode.kTest_DualTest) {
	    // parallel bidirectional test
	    var a = Long.fromBits(0x00000000, HEADER_VERSION1);
	    var b = Long.fromBits(0x00000000, RUN_NOW);
	    message.setInt32((offset + 0)*4, a.or(b).getHighBits(), false);

	} else if (settings.mMode === TestMode.kTest_ServeClient) {
	    // reverse client/server roles
	    var a = Long.fromBits(0x00000000, HEADER_VERSION1);
	    var b = Long.fromBits(0x00000000, RUN_CLIENT);
	    message.setInt32((offset + 0)*4, a.or(b).getHighBits(), false);

	} else if (settings.mMode === TestMode.kTest_TradeOff) {
	    // sequential bidirectional test
	    message.setInt32((offset + 0)*4, HEADER_VERSION1, false);	

	} else {
	    message.setInt32((offset + 0)*4, 0, false);

	}

	// num threads
	message.setInt32((offset + 1)*4, 1, false);

	// dual test return port
	if (settings.mListenPort != 0 ) {
	    message.setInt32((offset + 2)*4, settings.mListenPort, false);
	} else {
	    // use same as for the server
	    message.setInt32((offset + 2)*4, settings.mPort, false);
	}

	// pkt size
	if (settings.mBufLenSet) {
	    message.setInt32((offset + 3)*4, settings.mBufLen, false);
	} else {
	    message.setInt32((offset + 3)*4, 0, false);
	}

	// UDP rate or TCP window
	if (settings.mUDP) {
	    message.setInt32((offset + 4)*4, settings.mUDPRate, false);
	} else {
	    message.setInt32((offset + 4)*4, settings.mTCPWin, false);
	}

	// duration in sec * 100.0 or bytes
	if (settings.mMode_Time) {
	    message.setInt32((offset + 5)*4, ~~(-1.0*settings.mAmount/10.0), false);
	} else {
	    var a = Long.fromNumber(settings.mAmount);
	    var b = Long.fromBits(0x00000000, 0x7FFFFFFF);
	    message.setInt32((offset + 5)*4, a.add(b).getHighBits(), false);
	}
    };

    // reverse of above for server mode ...
    var read_client_header = function(message) {
	var offset = 3; // first cli header word

	// TODO
    };

    // server report header:
    //    int32_t flags
    //    int32_t total_len1
    //    int32_t total_len2
    //    int32_t stop_sec
    //    int32_t stop_usec
    //    int32_t error_cnt
    //    int32_t outorder_cnt
    //    int32_t datagrams
    //    int32_t jitter1
    //    int32_t jitter2
    //
    var write_server_header = function(report, message, ts) {
	var offset = 3; // first word

	var len = Long.fromNumber(report.totalLen);

	message.setInt32((offset+0)*4, 0x80, true); // flags
	message.setInt32((offset+1)*4, len.getHighBits(), false);
	message.setInt32((offset+2)*4, len.getLowBits(), false);
	message.setInt32((offset+3)*4, tv_sec(ts-report.startTime), false);
	message.setInt32((offset+4)*4, tv_usec(ts-report.startTime), false);
	message.setInt32((offset+5)*4, report.errorCnt, false);
	message.setInt32((offset+6)*4, report.outOfOrderCnt, false);
	message.setInt32((offset+7)*4, report.lastPacketID, false);
	message.setInt32((offset+8)*4, tv_sec(report.jitter), false); // jitter1
	message.setInt32((offset+9)*4, tv_usec(report.jitter), false); // jitter2
    };

    // the inverse operation
    var read_server_header = function(message) {
	var offset = 3; // first word

	var flags = message.getInt32((offset+0)*4, true); 
	if (flags !== 0x80)
	    debug("invalid ack header flag " + flags);

	var total_len1 = message.getInt32((offset+1)*4, false);
	var total_len2 = message.getInt32((offset+2)*4, false);
	var stop_sec = message.getInt32((offset+3)*4, false);
	var stop_usec = message.getInt32((offset+4)*4, false);
	var error_cnt = message.getInt32((offset+5)*4, false);
	var outorder_cnt = message.getInt32((offset+6)*4, false);
	var datagrams = message.getInt32((offset+7)*4, false);
	var jitter1 = message.getInt32((offset+8)*4, false);
	var jitter2 = message.getInt32((offset+9)*4, false); 

	// fill result object
	var obj = {};
	obj.startTime = 0;
	obj.endTime = 1000.0 * (stop_sec + stop_usec/1000000.0);
	obj.bytes = Long.fromBits(total_len2, total_len1).toNumber();
	obj.jitter = (jitter1 + jitter2/1000000.0)*1000.0;
	obj.errorCnt = error_cnt;
	obj.dgramCnt = datagrams;
	obj.outOfOrder = outorder_cnt;
	// %
	obj.errorRate = obj.errorCnt * 100.0 / obj.dgramCnt;
	return obj;
    };

    var getSocketOption = function(option) {
	if (!settings.mSock || !option) {
	    return -1;
	}
	return 0;
	// FIXME: this stuff crashes firefox .... ?

	var opt = new NSPR.types.PRSocketOptionData();
	opt.option = option;
	var rv = NSPR.sockets.PR_GetSocketOption(settings.mSock, opt.address());
	if (rv < 0) {
	    debug("failed to get socket option " + opt.option);
	    return rv;
	}
	return opt.value;
    };

    var setSocketOptions = function(isClient) {
	var ret = 0;
	var setopt = function(opt) {
	    var rv = NSPR.sockets.PR_SetSocketOption(settings.mSock, 
						     opt.address());
	    if (rv < 0) {
		error("failed to set option " + 
		      opt.option + "=" + opt.value);
	    }
	    return rv;
	}

	if (settings.mTCPWin > 0) {
	    var opt = new NSPR.types.PRSocketOptionData();
	    if (isClient) {
		opt.option = NSPR.sockets.PR_SockOpt_SendBufferSize;
	    } else {
		opt.option = NSPR.sockets.PR_SockOpt_RecvBufferSize;
	    }
	    opt.value = settings.mTCPWin;	
	    ret = setopt(opt);
	}
	
	if (!settings.mUDP) {
	    if (settings.mMSS > 0) {
		var opt = new NSPR.types.PRSocketOptionData();
		opt.option = NSPR.sockets.PR_SockOpt_MaxSegment;
		opt.value = settings.mMSS;	
		ret = setopt(opt);
	    }

	    if (settings.mNodelay) {
		var opt = new NSPR.types.PRSocketOptionData();
		opt.option = NSPR.sockets.PR_SockOpt_NoDelay;
		opt.value = NSPR.sockets.PR_TRUE;	
		ret = setopt(opt);
	    }
	}

	if (!isClient) {
	    var opt = new NSPR.types.PRSocketOptionData();
	    opt.option = NSPR.sockets.PR_SockOpt_Reuseaddr;
	    opt.value = NSPR.sockets.PR_TRUE;	
	    ret = setopt(opt);
	}

	return 0;
    };

    // client/server pkt report
    var reportPkt = function(report, bytes, ts) {
	report.totalLen += bytes;
	if (report.nextReportTime && report.nextReportTime>0)
	    report.currLen += bytes;

	if (bytes>0) {
	    report.totalDgrams += 1;
	    if (report.nextReportTime && report.nextReportTime>0)
		report.currDgrams += 1;
	}

	if (report.nextReportTime && report.nextReportTime>0 && 
	    (ts >= report.nextReportTime || bytes == 0)) 
	{
	    // progress report
            var obj = {
		timestamp : (new Date()).getTime(),
		sendip : report.clientIP,
		sendport : report.clientPort,
		recvip :  report.serverIP,
		recvport :  report.serverPort,
		startTime : (report.currStartTime-report.startTime)/1000.0,
		endTime : (report.nextReportTime-report.startTime)/1000.0,
		dgramCnt : report.currDgrams,
		bytes : report.currLen,
            };

	    // bits / s
	    obj.rate = obj.bytes / (obj.endTime - obj.startTime);
	    obj.ratebit = (obj.bytes * 8.0) / (obj.endTime - obj.startTime); 

	    // human readable report values
	    obj.rateKbit = numtoformat(obj.rate, 'k'); // Kbit
	    obj.rateMbit = numtoformat(obj.rate, 'm'); // Mbit
	    obj.bytesK = numtoformat(obj.bytes, 'K');  // KB
	    obj.bytesM = numtoformat(obj.bytes, 'M');  // MB

	    if (settings.mThreadMode === ThreadMode.kMode_Client) {
		// client always sends
		report.finalres.snd_reports.push(obj);
	    } else {
		// server recvs
		obj.errorCnt = report.currErrorCnt;
		obj.jitter = report.jitter;
		obj.outOfOrder = report.currOutOfOrder;
		if (report.currDgrams>0) {
		    obj.errorRate = 
			100.0 * (report.currErrorCnt/report.currDgrams);
		} else {
		    obj.errorRate = 100.0;
		}
		
		report.finalres.rcv_reports.push(obj);
	    }

	    // reset
	    report.currStartTime = report.nextReportTime;
	    report.nextReportTime += settings.mInterval;
	    report.currLen = 0;
	    report.currDgrams = 0;
	    report.currErrorCnt = 0;
	    report.currOutOfOrder = 0;
	}
    };

    // client received summary report from the server
    var addServerReport = function(report, sobj) {
	var obj = {
	    timestamp : (new Date()).getTime(),
	    sendip : report.clientIP,
	    sendport : report.clientPort,
	    recvip : report.serverIP,
	    recvport : report.serverPort,
	    socketBufferSize : report.socketBufferSize,
	    startTime : sobj.startTime/1000.0,
	    endTime : sobj.endTime/1000.0,
	    dgramCnt : sobj.dgramCnt,
	    bytes : sobj.bytes,
	    errorCnt : sobj.errorCnt,
	    errorRate : sobj.errorRate,
	    jitter : sobj.jitter,
	    outOfOrder : sobj.outOfOrder,	
	};

	// bytes / s
	obj.rate = obj.bytes / (obj.endTime - obj.startTime); 
	obj.ratebit = (obj.bytes * 8.0) / (obj.endTime - obj.startTime); 
	obj.ratekbit = numtoformat(obj.rate, 'k'); // kbit
	obj.rateMbit = numtoformat(obj.rate, 'm'); // Mbit

	obj.bytesK = numtoformat(obj.bytes, 'K');  // KB
	obj.bytesM = numtoformat(obj.bytes, 'M');  // MB

	report.finalres.snd_rcv_total = obj;
    };

    // client/server final report
    var closeReport = function(report, ts) {
	debug("close " + (report.client ? "client" : "server") + " report");
	var obj = {
	    timestamp : (new Date()).getTime(),
	    sendip : report.clientIP,
	    sendport : report.clientPort,
	    recvip : report.serverIP,
	    recvport : report.serverPort,
	    startTime : 0,
	    endTime : (ts-report.startTime)/1000.0,
	    dgramCnt : report.totalDgrams,
	    bytes : report.totalLen,
	    socketBufferSize : report.socketBufferSize,
	};

	// bytes / s
	obj.rate = obj.bytes / obj.endTime; 
	obj.ratebit = (obj.bytes * 8.0) / obj.endTime; 
	obj.ratekbit = numtoformat(obj.rate, 'k'); // kbit
	obj.rateMbit = numtoformat(obj.rate, 'm'); // Mbit

	obj.bytesK = numtoformat(obj.bytes, 'K');  // KB
	obj.bytesM = numtoformat(obj.bytes, 'M');  // MB

	if (settings.mThreadMode === ThreadMode.kMode_Client) {
    	    report.finalres.snd_total = obj;
	} else { // kMode_Server
	    obj.errorCnt = report.errorCnt;
	    obj.errorRate = report.errorRate;
	    obj.jitter = report.jitter;
	    obj.outOfOrder = report.outOfOrder;		
    	    report.finalres.rcv_total = obj;
	}
    };

    // start in client mode
    var client = function() {    
	const ACK_WAIT = 10;

	// initialize send buffer
	var inBytes = settings.mBufLen;
	var mBuf = settings.mBuf;
	var message = new DataView(mBuf);
	while ( inBytes > 0 ) {
	    inBytes -= 1;
	    message[inBytes] =  ((inBytes % 10)+"").charCodeAt(0);
	};

	// create and connect the socket
	if (settings.mUDP) {
	    settings.mSock = 
		NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
	} else {
	    settings.mSock = 
		NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
	}

	if (settings.mSock == null) {
	    return {error : "Failed to create socket : code = " + 
		    NSPR.errors.PR_GetError()};
	}

	// server address (must know IP + port)
	var remoteaddr = new NSPR.types.PRNetAddr();
	if (NSPR.sockets.PR_StringToNetAddr(settings.mHost, 
					    remoteaddr.address())<0) {
	    // TODO: add gethostname to resolve names to ip	    
	    NSPR.sockets.PR_Close(settings.mSock);
	    return {error : "Invalid server IP : code = " + 
		    NSPR.errors.PR_GetError()};
	}

	NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrNull, 
				   NSPR.sockets.PR_AF_INET, 
				   settings.mPort, remoteaddr.address());


	// set socket options
	setSocketOptions(true);

	if (settings.mLocalhost) {
	    // bind to a given local address (IP, any port)
	    var localaddr = new NSPR.types.PRNetAddr();
	    if (NSPR.sockets.PR_StringToNetAddr(settings.mLocalhost, 
						localaddr.address())<0) {
		NSPR.sockets.PR_Close(settings.mSock);
		return {error : "Invalid local IP : code = " + 
			NSPR.errors.PR_GetError()};
	    }

	    NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrNull, 
				       NSPR.sockets.PR_AF_INET, 
				       0, localaddr.address());

	    if (NSPR.sockets.PR_Bind(settings.mSock, localaddr.address()) < 0) {
		NSPR.sockets.PR_Close(settings.mSock);
		return {error: "Error binding : code = " + 
			NSPR.errors.PR_GetError()};
	    }
	}

	// connect (use OS socket connection timeout value)
	if (NSPR.sockets.PR_Connect(settings.mSock, remoteaddr.address(),
				    NSPR.sockets.PR_INTERVAL_NO_TIMEOUT) < 0) {
	    NSPR.sockets.PR_Close(settings.mSock);
	    return {error : "Error connecting : code = " + 
		    NSPR.errors.PR_GetError()};
	}

	var local = NSPR.types.PRNetAddr();
	NSPR.sockets.PR_GetSockName(settings.mSock, local.address());
	settings.local = {};
	settings.local.ip = NSPR.util.NetAddrToString(local);
	settings.local.port = NSPR.util.PR_ntohs(local.port);

	debug("client "+settings.local.ip + ":"+
	      settings.local.port+" proto="+(settings.mUDP ? "udp":"tcp"));

	var peer = NSPR.types.PRNetAddr();
	NSPR.sockets.PR_GetPeerName(settings.mSock, peer.address());
	settings.peer = {};
	settings.peer.ip = NSPR.util.NetAddrToString(peer);
	settings.peer.port = NSPR.util.PR_ntohs(peer.port);

	debug("connected to "+settings.peer.ip + ":"+settings.peer.port);

	// connection done - ready to start the test
	settings.mTransferID += 1;

	var delay_target = 0;
	if (settings.mUDP) {
	    delay_target = settings.mBufLen * ((1000 * 8.0) / settings.mUDPRate);
	}
	var delay = 0; 
	var adjust = 0;
	var endTime = undefined;
	var startTime = undefined;
	var init = function(ts) {
	    // set timings
	    startTime = ts;
	    report.startTime = ts;
	    report.lastPacketTime = ts;
	    if (settings.mInterval>0) {
		report.currStartTime = ts;
		report.nextReportTime = ts + settings.mInterval;
	    }
	    if (settings.mMode_Time) {
		endTime = ts + settings.mAmount;
	    }
	    // write info about dualtest config to the message
	    write_client_header(message);
	};

	// reporting state
	var report = {
	    clientIP : settings.local.ip,
	    clientPort : settings.local.port,
	    serverIP : settings.peer.ip,
	    serverPort : settings.peer.port,
	    transferID : settings.mTransferID,
	    packetID : 0,
	    totalLen : 0,
	    totalDgrams : 0,
	    startTime : undefined,
	    lastPacketTime : undefined,
	    client : true,       
	    finalres : initres() // object we report back to the UI
	}
	if (settings.mInterval > 0) {
	    // periodic reporting
	    report.currLen = 0;
	    report.currDgrams = 0;
	}
	report.socketBufferSize = 
	    getSocketOption(NSPR.sockets.PR_SockOpt_SendBufferSize);

	// end test
	var fin = function(ts) {
	    // done sending - last progress report and final report
	    reportPkt(report, 0, ts);
	    closeReport(report, ts);

	    if (!settings.mUDP) {
		if (settings.mMode === TestMode.kTest_TradeOff) {
		    debug("-- switching to tradeoff server mode --");
		    // cleanup the client socket
		    NSPR.sockets.PR_Close(settings.mSock);
		    settings.mSock = undefined;
		    // start listening for incoming test
		    listener(undefined, report);
		} else {
		    // report and stop
		    shutdown(report.finalres);
		}		
		return;
	    }

	    var to = NSPR.util.PR_MillisecondsToInterval(50);
	    var retryc = ACK_WAIT;

	    write_UDP_header(message, -1*report.packetID, ts);

	    var recvbufsize = settings.mBufLen;
	    var recvbuf = getBuffer(recvbufsize);

	    var finloop = function() {
		if (retryc == 0) {
		    debug("no server report after 10 retries");
		    shutdown(report.finalres);
		    return;
		}

		if (!settings.mSock || settings.mStopReq) {
		    debug("client terminated, did not receive server report");
		    shutdown({interrupted : true});
		    return;
		}

		retryc -= 1;
		NSPR.sockets.PR_Send(settings.mSock, 
				     mBuf, 
				     settings.mBufLen, 
				     0, 
				     NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);

		// block in waiting for response
		var rv = NSPR.sockets.PR_Recv(settings.mSock, 
					      recvbuf, 
					      recvbufsize, 
					      0, 
					      5*to);

		if (rv > 0) {
		    // parse report and report
		    var msg = new DataView((new Uint8Array(recvbuf)).buffer);
		    var recvrep = read_server_header(msg);
		    addServerReport(report, recvrep);

		    if (settings.mMode === TestMode.kTest_TradeOff) {
			debug("-- switching to tradeoff server mode --");
			// cleanup the client socket
			NSPR.sockets.PR_Close(settings.mSock);
			settings.mSock = undefined;
			// start listening for incoming test		    
			listener(undefined, report);
		    } else {
			// report and stop
			shutdown(report.finalres);
		    }
		    return;
		}

		// else assume timeout and continue sending
		setTimeout(function() { finloop(); }, 0);

	    }; // end finloop
	    setTimeout(function() { finloop(); }, 0);
	};

	// main send loop
	var loop = function() {    
	    if (!settings.mSock || settings.mStopReq) {
		shutdown({interrupted : true});
		return; // exit loop
	    }

	    while (true) {
		var ts = gettime();
		if (!startTime) {
		    // first iteration
		    init(ts);
		}

		if ((settings.mMode_Time && ts >= endTime) || 
		    (!settings.mMode_Time && settings.mAmount <= 0)) 
		{
		    fin(ts);
		    return; // exit loop
		}
		
		if (settings.mUDP) {
		    // format the packet
		    write_UDP_header(message, report.packetID, ts);

		    // rate control
		    adjust = delay_target + (report.lastPacketTime-ts);
		    if ( adjust > 0  ||  delay > 0 ) {
			delay += adjust; 
		    }
		}
		report.packetID += 1;
		report.lastPacketTime = ts;

		// implicit conversion from ArrayBuffer to ctype buffer
		var l = NSPR.sockets.PR_Send(
		    settings.mSock, 
		    mBuf, 
		    settings.mBufLen, 
		    0, 
		    NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);
		
		if (l<0) {
		    // error writing... stop here
		    fin(ts);
		    return; // exit loop

		} else if (settings.mMode === TestMode.kTest_ServeClient) {
		    // first packet is sent - switch to server mode
		    debug("-- switching to server mode --");
		    if (settings.mUDP) {
			udp_single_server(undefined, report);
		    } else {
			// reuse the current socket for receiving data
			settings.mSockIn = settings.mSock;
			tcp_single_server(undefined, report);
		    }
		    return; // exit loop
		}
		    
		// accounting
		reportPkt(report, l, ts);		
		if (!settings.mMode_Time) {
		    settings.mAmount -= l;
		}

		// setTimout has millisecond accuracy
		if (delay>15.0) {
		    // this will in fact be 15-20ms
		    // delay as we give the control back to
		    // the event loop
		    setTimeout(function() { loop(); }, tv_msec(delay));
		    return; // exit loop
		} // else re-loop immediately

	    } // end while
	}; // end loop
	setTimeout(function() { loop(); }, 0); // start with timeout to allow the return call
	return settings.mSock;
    }; // client

    // start a single server worker
    var server = function() {
	if (settings.mUDP) {
	    return udp_single_server();
	} else {
	    return tcp_single_server();
	}
    }

    // single threaded udp worker, receives data from a single
    // client and then calls shutdown with the final report
    // if donecb is given, sends final report and calls donecb
    var udp_single_server = function(donecb, clireport) {
	const RECV_TO = NSPR.util.PR_MillisecondsToInterval(250);
	const ACK_RECV_TO = NSPR.util.PR_MillisecondsToInterval(1000);
	const ACK_RETRY = 10;
	var mBuf = settings.mBuf;

	settings.mThreadMode = ThreadMode.kMode_Server;

	// continue to fill existing report or create a new
	var report = clireport;
	if (!report) {
	    debug("udp_single_server init report");
	    report = {
		server : true,
		finalres : initres(), // report for the UI
	    };
	}
	report.socketBufferSize = 
	    getSocketOption(NSPR.sockets.PR_SockOpt_RecvBufferSize);

	var reset = function(ts) {
	    report.transferID = settings.mTransferID;
	    report.serverIP = settings.local.ip;
	    report.serverPort = settings.local.port;
	    report.clientIP = settings.peer.ip;
	    report.clientPort = settings.peer.port;

	    // set timings
	    report.totalLen = 0;
	    report.totalDgrams = 0;
	    report.jitter = 0;
	    report.errorCnt = 0;
	    report.outOfOrderCnt = 0;
	    report.packetID = 0;
	    report.lastPacketID = 0;
 	    report.startTime = ts;
	    report.lastTransit = 0;

	    if (settings.mInterval > 0) {
		report.currLen = 0;
		report.currDgrams = 0;
		report.currStartTime = ts;
		report.currErrorCnt = 0;
		report.currOutOfOrderCnt = 0;
		report.nextReportTime = ts + settings.mInterval;
	    }
	};

	var udp_fin = function(cb, ts, peeraddr) {
	    var retryc = ACK_RETRY;

	    // assume most of the time out-of-order packets are not
	    // duplicate packets, so conditionally subtract them 
	    // from the lost packets.
	    if (report.errorCnt > report.outOfOrderCnt) {
		report.errorCnt -= report.outOfOrderCnt;
	    }

	    // last progress report and final report
	    reportPkt(report, 0, ts);
	    closeReport(report, ts);

	    var msg = new DataView(mBuf);
	    write_server_header(report, msg, ts);

	    var finloop = function() {
		if (retryc == 0 || !settings.mSock || settings.mStopReq) {
		    setTimeout(function() { cb(); }, 0);
		    return;
		}

		retryc -= 1;
		var l = NSPR.sockets.PR_SendTo(settings.mSock, 
					       mBuf, 
					       settings.mBufLen, 
					       0, 
					       peeraddr.address(),
					       NSPR.sockets.PR_INTERVAL_NO_TIMEOUT);

		if (l>0) {
		    var rv = NSPR.sockets.PR_RecvFrom(settings.mSock, 
						      mBuf, 
						      settings.mBufLen, 
						      0, 
						      peeraddr.address(), 
						      ACK_RECV_TO);
		    if (rv <= 0) {
			// got nothing from the client - we're done
			setTimeout(function() { cb(); }, 0);
			return;
		    }
		} else {
		    // errors in sending - stop trying
		    debug("failed to send ack: " + NSPR.errors.PR_GetError());
		    setTimeout(function() { cb(); }, 0);
		    return;
		}
		
		// try sending again
		setTimeout(function() { finloop(); }, 0);

	    }; // end finloop

	    setTimeout(function() { finloop(); }, 0);

	}; // end udp_fin

	var peeraddr = new NSPR.types.PRNetAddr();
	var curr_peeraddr = undefined;
	var lastreloop = undefined;

	var loop = function() {
	    if (!settings.mSock || settings.mStopReq) {		
		shutdown({interrupted : true});
		return;
	    }

	    lastreloop = gettime();

	    // this internal while is to keep receiving data as fast
	    // as possible when a test is running, outer loop is 
	    // called upon timeouts (+ every now and then) to keep 
	    // the worker thread responsive
	    var done = false;
	    while (!done) {
		var rv = NSPR.sockets.PR_RecvFrom(settings.mSock, 
						  mBuf, 
						  settings.mBufLen, 
						  0, 
						  peeraddr.address(),
						  RECV_TO);

		var ts = gettime();
		if (rv > 0) {
		    if (!curr_peeraddr || 
			(peeraddr.port !== curr_peeraddr.port ||
			 peeraddr.ip !== curr_peeraddr.ip)) 
		    {
			// new client !
			settings.peer = {};
			settings.peer.ip = NSPR.util.NetAddrToString(peeraddr);
			settings.peer.port = NSPR.util.PR_ntohs(peeraddr.port);
			settings.mTransferID += 1;
			curr_peeraddr = peeraddr;
			reset(ts);
			
			debug("UDP connection from " + 
			      settings.peer.ip + ":" + 
			      settings.peer.port);
		    }

		    var msg = new DataView(mBuf);
		    var obj = {};
		    read_UDP_header(msg, obj);

		    if (obj.packetID != 0) {
			reportPkt(report, rv, ts);
		    }
		    
		    if (obj.packetID < 0) {
			// this was the last packet
			done = true; // quit while
			udp_fin(function() {
			    curr_peeraddr = undefined;
			    if (donecb && typeof donecb === 'function') {
				settings.callback(report.finalres, false);
				setTimeout(function() { donecb(); }, 0);
			    } else {
				shutdown(report.finalres);
			    }
			}, ts, curr_peeraddr);
			
		    } else if (obj.packetID != 0) {
			// from RFC 1889, Real Time Protocol (RTP) 
			// J = J + ( | D(i-1,i) | - J ) / 16 
			var transit = ts - obj.ts;
			var deltaTransit;
			if (report.lastTransit != 0) {
			    deltaTransit = transit - report.lastTransit;
			    if (deltaTransit < 0.0) {
				deltaTransit = -deltaTransit;
			    }
			    report.jitter += (deltaTransit - report.jitter)/(16.0);
			}
			report.lastTransit = transit;
			
			// packet loss occured if the datagram 
			// numbers aren't sequential 
			if (obj.packetID != report.lastPacketID + 1 ) {
			    if (obj.packetID < report.lastPacketID + 1 ) {
				report.outOfOrderCnt += 1;
				report.currOutOfOrderCnt += 1;
			    } else {
				report.errorCnt += ((obj.packetID - report.lastPacketID) - 1);
				report.currErrorCnt += ((obj.packetID - report.lastPacketID) - 1);
			    }
			}
			
			// never decrease datagramID (e.g. if we 
			// get an out-of-order packet) 
			if (obj.packetID > report.lastPacketID ) {
			    report.lastPacketID = obj.packetID;
			}		    	    
		    }
		    
		} else if (rv < 0) {
		    var err = NSPR.errors.PR_GetError();
		    if (err !== NSPR.errors.PR_IO_TIMEOUT_ERROR) {
			// something wrong - stop receiving
			if (report.totalDgrams>0) {
			    reportPkt(report, 0, ts);
			    closeReport(report, ts);
			}
			done = true; // quit while
			if (donecb && typeof donecb === 'function') {
			    setTimeout(function() { donecb({error : "Error in recvfrom: code="+err}); }, 0);
			} else {
			    shutdown({error : "Error in recvfrom: code="+err});
			}
		    } else {
			// there was recv timeout, loop back by the event loop
			done = true; // quit while
			setTimeout(function() { loop(); }, 0);
		    }
		} else { // rv == 0
		    if (report.totalDgrams>0) {
			reportPkt(report, 0, ts);
			closeReport(report, ts);
		    }
		    done = true; // quit while
		    if (donecb && typeof donecb === 'function') {
			setTimeout(function() { donecb({error : "Error in recvfrom: code="+err}); }, 0);				   
		    } else {
			shutdown({error : "Error in recvfrom: code="+err});
		    }
		}

		// TODO: this is a hack to keep the server worker responsive
		// to outside events such as shutdown ... 
		// Other option could be just kill the worker in fathom...
		if (ts-lastreloop > 5000.0) {
		    done = true; // quit while
		    setTimeout(function() { loop(); }, 0); // this will incure 15-20ms delay
		}
		// else stay in the tight while loop
	    } // end while
	}; // end loop
	setTimeout(function() { loop(); }, 0);
    }; // udp_single_server

    // tcp server worker
    // receives data from a single client and then calls shutdown with 
    // the final report 
    // if donecb is given, sends final report and calls donecb
    var tcp_single_server = function(donecb, clireport) {
	const RECV_TO = NSPR.util.PR_MillisecondsToInterval(250);
	var mBuf = settings.mBuf;
	var ts = gettime(); // TODO: report start from first byte?

	settings.mThreadMode = ThreadMode.kMode_Server;

	var report = clireport;
	if (!report) {
	    debug("tcp_single_server init report");
	    report = {
		server : true,
		finalres : initres()
	    };
	}

	// init all fields
	report.serverIP = settings.local.ip;
	report.serverPort = settings.local.port;
	report.transferID = settings.mTransferID;
	report.clientIP = settings.peer.ip;
	report.clientPort = settings.peer.port;

	report.totalLen = 0;
	report.totalDgrams = 0;
	report.jitter = 0;
	report.errorCnt = 0;
	report.outOfOrderCnt = 0;
	report.packetID = 0;
	report.lastPacketID = 0;
	report.startTime = ts;
	report.lastTransit = 0;

	if (settings.mInterval > 0) {
	    // periodic reporting
	    report.currLen = 0;
	    report.currDgrams = 0;
	    report.currStartTime = ts;
	    report.currErrorCnt = 0;
	    report.currOutOfOrderCnt = 0;
	    report.nextReportTime = ts + settings.mInterval;
	}

	report.socketBufferSize = 
	    getSocketOption(NSPR.sockets.PR_SockOpt_RecvBufferSize);

	var lastreloop = undefined;
	var loop = function() {
	    if (!settings.mSock || settings.mStopReq) {
		shutdown({interrupted : true});
		return;
	    }

	    lastreloop = gettime();

	    // this internal while is to keep receiving data as fast
	    // as possible when a test is running, outer loop is 
	    // called upon timeouts (+ every now and then) to keep 
	    // the worker thread responsive
	    var done = false;
	    while (!done) {
		var rv = NSPR.sockets.PR_Recv(settings.mSockIn, 
					      mBuf, 
					      settings.mBufLen, 
					      0, 
					      RECV_TO);

		var ts = gettime();
		if (rv > 0) {
		    reportPkt(report, rv, ts);

		} else if (rv < 0) {
		    var err = NSPR.errors.PR_GetError();
		    if (err !== NSPR.errors.PR_IO_TIMEOUT_ERROR) {
			// something wrong - stop receiving
			if (report.totalDgrams>0) {
			    reportPkt(report, 0, ts);
			    closeReport(report, ts);
			}
			done = true; // quit while
			if (donecb && typeof donecb === 'function') {
			    settings.callback(report.finalres, false);
			    setTimeout(function() { donecb(); }, 0);		    
			} else {
			    shutdown(report.finalres);
			}
		    } else {
			// there was recv timeout, loop back by the event loop
			done = true; // quit while
			setTimeout(function() { loop(); }, 0);
		    }
		} else { // rv == 0
		    // connection closed - final report
		    reportPkt(report, 0, ts);
		    closeReport(report, ts);
		    done = true; // quit while
		    if (donecb && typeof donecb === 'function') {
			settings.callback(report.finalres, false);
			setTimeout(function() { donecb(); }, 0);		    
		    } else {
			shutdown(report.finalres);
		    }
		}

		// TODO: this is a hack to keep the server worker responsive
		// to outside events such as shutdown ... 
		// Other option could be just kill the worker in fathom...
		if (ts-lastreloop > 5000.0) {
		    done = true; // quit while
		    setTimeout(function() { loop(); }, 0); // this will incure 15-20ms delay
		}
		// else stay in the tight while loop

	    } // end while
	}; // end loop

	// start receiving
	setTimeout(function() { loop(); }, 0);
	return undefined;
    };

    // start in listener mode
    var listener = function(donecb, clireport) {
	const LIST_TO = NSPR.util.PR_MillisecondsToInterval(250);
	settings.mThreadMode = ThreadMode.kMode_Listener;

	debug("listener has report? " + clireport + 
	      " testmode="+settings.mMode);

	// create listening socket
	if (settings.mUDP) {
	    settings.mSock = 
		NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
	} else {
	    settings.mSock = 
		NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
	}

	if (settings.mSock == null) {
	    return {error : "Failed to create socket : code = " + 
		    NSPR.errors.PR_GetError()};
	}

	// set server socket options
	setSocketOptions(false);

	// set local address and port
	var localaddr = new NSPR.types.PRNetAddr();
	var localport = settings.mPort;
	if (settings.mMode === TestMode.kTest_TradeOff && 
	    settings.mListenPort!=0) {
	    // use different port for incoming test
	    localport = settings.mListenPort;
	}

	if (settings.mLocalhost) {
	    // bind to a given local address
	    if (NSPR.sockets.PR_StringToNetAddr(settings.mLocalhost, localaddr.address())<0) {
		NSPR.sockets.PR_Close(settings.mSock);
		return {error : "Invalid local IP : code = " + 
			NSPR.errors.PR_GetError()};
	    }
	    NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrNull, 
				       NSPR.sockets.PR_AF_INET, 
				       localport, 
				       localaddr.address());
	} else {
	    // bind to a given port
	    NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrAny, 
				       NSPR.sockets.PR_AF_INET, 
				       localport, 
				       localaddr.address());
	}

	if (NSPR.sockets.PR_Bind(settings.mSock, localaddr.address()) < 0) {
	    NSPR.sockets.PR_Close(settings.mSock);
	    return {error: "Error binding : code = " + 
		    NSPR.errors.PR_GetError()};
	}

	if (!settings.mUDP) {
	    // original iperf has a backlog of 5 - using the same value
	    if (NSPR.sockets.PR_Listen(settings.mSock, 5) < 0) {
		NSPR.sockets.PR_Close(settings.mSock);
		return {error: "Error listening : code = " + 
			NSPR.errors.PR_GetError()};
	    }
	}

	var local = NSPR.types.PRNetAddr();
	NSPR.sockets.PR_GetSockName(settings.mSock, local.address());
	settings.local = {};
	settings.local.ip = NSPR.util.NetAddrToString(local);
	settings.local.port = NSPR.util.PR_ntohs(local.port);

	debug("server listening at "+settings.local.ip + ":"+
	      settings.local.port+" proto="+
	      (settings.mUDP ? "UDP":"TCP"));

	// main listener loop
	var loop = function() {
	    if (!settings.mSock || settings.mStopReq) {
		shutdown({interrupted : true});
		return;
	    }

	    if (settings.mUDP) {
		// wait for new connection
		var peeraddr = new NSPR.types.PRNetAddr();
		var mBuf = settings.mBuf;
		var rv = NSPR.sockets.PR_RecvFrom(settings.mSock, 
						  mBuf, 
						  settings.mBufLen, 
						  0, 
						  peeraddr.address(), 
						  LIST_TO);

		var ts = gettime();
		if (rv > 0) {
		    // new client !
		    settings.peer = {};
		    settings.peer.ip = NSPR.util.NetAddrToString(peeraddr);
		    settings.peer.port = NSPR.util.PR_ntohs(peeraddr.port);
		    settings.mTransferID += 1;

		    debug("UDP connection from " + settings.peer.ip + ":" + 
			  settings.peer.port);

		    if (settings.mMode === TestMode.kTest_TradeOff) {
			// single server run for tradeoff client
			udp_single_server(undefined, clireport);
		    } else {
			// handle this client
			udp_single_server(function() {
			    debug("back in listener");
			    if (!settings.mSingleUDP) {
				// continue receiving clients, pass through 
				// the main event loop in case somebody wants 
				// to shut us down...
				setTimeout(function() { loop(); }, 0);
			    } else {
				// single connection done
				shutdown();
				return;
			    }
			});
		    };

		} else if (rv < 0) {
		    var err = NSPR.errors.PR_GetError();
		    if (err !== NSPR.errors.PR_IO_TIMEOUT_ERROR) {
			shutdown({error: "Error recvfrom : code="+err });
			return;
		    } else {
			setTimeout(function() { loop(); }, 0); // re-loop
		    }
		} else {
		    shutdown({error: "Error recvfrom : conn closed"});	 
		    return;
		}
	    } else {
		// wait for new connection
		var peeraddr = new NSPR.types.PRNetAddr();
		var socketIn = NSPR.sockets.PR_Accept(settings.mSock, 
						      peeraddr.address(), 
						      LIST_TO);

		if (!socketIn.isNull()) {
		    // new client !
		    settings.peer = {};
		    settings.peer.ip = NSPR.util.NetAddrToString(peeraddr);
		    settings.peer.port = NSPR.util.PR_ntohs(peeraddr.port);	
		    settings.mTransferID += 1;

		    debug("TCP connection from " + settings.peer.ip + ":" + 
			  settings.peer.port);

		    // handle the client
		    settings.mSockIn = socketIn;
		    if (settings.mMode === TestMode.kTest_TradeOff) {
			// single server run for tradeoff client
			tcp_single_server(undefined,clireport);
		    } else {
			tcp_single_server(function() {
			    debug("back in listener");
			    NSPR.sockets.PR_Close(settings.mSockIn);
			    settings.mSockIn = undefined;
			    // continue receiving clients, pass through 
			    // the main event loop in case somebody wants 
			    // to shut us down...
			    setTimeout(function() { loop(); }, 0);
			});
		    }
		} else {
		    var err = NSPR.errors.PR_GetError();
		    if (err !== NSPR.errors.PR_IO_TIMEOUT_ERROR) {
			shutdown({error: "Error accept : code="+err });
			return;
		    } else {
			// continue receiving clients, pass through 
			// the main event loop in case somebody wants 
			// to shut us down...
			setTimeout(function() { loop(); }, 0);
		    }
		}
	    }
	}; // end loop

	setTimeout(function() { loop(); }, 0);
	return settings.mSock;
    }; // listener

    // cleanup and terminate this worker
    var shutdown = function(r) {
	if (settings.mSock) {
	    NSPR.sockets.PR_Close(settings.mSock);
	}    
	settings.mSock = undefined;
	if (settings.mSockIn) {
	    NSPR.sockets.PR_Close(settings.mSockIn);
	}
	settings.mSockIn = undefined;
	worker.socket = undefined;
	
	if (!settings.mStopReq)
	    settings.callback(r, true);
	setTimeout(function() { cleanup(); }, 0);
    };
    

    // ------ API ------

    var start = function(callback, args) {
	// parse configuration
	if (!settings.configured) {
	    configure(args);
	} else {
	    // we're spawning a new worker where args is the cloned
	    // settings of the parent worker
	    settings = args;
	    if (settings.mThreadMode === ThreadMode.kMode_Listener) {
		settings.mThreadMode = ThreadMode.kMode_Server;
	    }
	}
	settings.callback = callback;
	debug(settings);


	var ret = undefined;
	switch (settings.mThreadMode) {
	case ThreadMode.kMode_Listener:
	    ret = listener(); // wait incoming connections
	    break;
	case ThreadMode.kMode_Server:
	    ret = server();   // receive data
	    break;
	case ThreadMode.kMode_Client:	
	    ret = client();   // send data
	    break;
	default:		
	    ret = {error : "Unknown thread mode"};
	    break;
	}
	return ret;
    };

    var stop = function() {
	worker.multirespstop = settings.mStopReq = true;
	return {};
    };

    return { start : start, stop : stop };
}());
