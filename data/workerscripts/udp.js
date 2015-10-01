/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew UDP socket methods.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

socket.udpOpen = function() {
    var s = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
    if (!s)
        return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};
    return s;
};

socket.udpBind = function(s, ip, port, reuse) {
    reuse = (reuse!==undefined ? reuse : false);
    if (reuse) {
        var res = socket.setSocketOption(s,'reuseaddr',true); 
        if (res.error) {
            return res;
        }
    }
    
    var addr = new NSPR.types.PRNetAddr();
    var localaddr = NSPR.sockets.PR_IpAddrAny;
    if (ip!==0) {
        // TODO: bind to local interface
        return {error : 
            "Binding to local interface is not implemented, use 0."};
    }

    NSPR.sockets.PR_SetNetAddr(
        localaddr, 
        NSPR.sockets.PR_AF_INET, 
        port, 
        addr.address());

    if (NSPR.sockets.PR_Bind(s, addr.address()) != 0)
        return {error: "Error binding: " + NSPR.errors.PR_GetError()};

    // ok
    return {};
};

socket.udpConnect = function(s, ip, port) {
    var timeout = NSPR.util.PR_MillisecondsToInterval(1000);
    var addr = new NSPR.types.PRNetAddr();
    addr.ip = NSPR.util.StringToNetAddr(ip);

    NSPR.sockets.PR_SetNetAddr(
        NSPR.sockets.PR_IpAddrNull, 
        NSPR.sockets.PR_AF_INET, 
        port, 
        addr.address());

    if (NSPR.sockets.PR_Connect(s, addr.address(), timeout) < 0)
        return {error : "Error connecting: " + NSPR.errors.PR_GetError()};

    // ok
    return {};
};

socket.udpSendTo = function(s, msg, ip, port) {
    var addr = new NSPR.types.PRNetAddr();
    addr.ip = NSPR.util.StringToNetAddr(ip);

    NSPR.sockets.PR_SetNetAddr(
        NSPR.sockets.PR_IpAddrNull, 
        NSPR.sockets.PR_AF_INET, 
        port, 
        addr.address());

    var sendBuf = newBufferFromString(msg);

    var res = NSPR.sockets.PR_SendTo(s, 
       sendBuf, 
       msg.length, 
       0, 
       addr.address(),
       NSPR.sockets.PR_INTERVAL_NO_WAIT);

    if (res < 0) {
        return {error : "Error sending: " + NSPR.errors.PR_GetError()};
    } else {
        return {length : res};
    }
};

socket.udpRecvFrom = function(s, asstring, timeout, size) {
    // Practical limit for IPv4 UDP packet data length is 65,507 bytes.
    // (65,535 - 8 byte UDP header - 20 byte IP header)
    var bufsize = (size && size>0 ? size : 65507);
    var recvbuf = getBuffer(bufsize);

    var to = NSPR.sockets.PR_INTERVAL_NO_WAIT;
    if (timeout && timeout < 0) {
        to = NSPR.sockets.PR_NO_TIMEOUT;
    } else if (timeout && timeout > 0) {
        to = NSPR.util.PR_MillisecondsToInterval(timeout);
    }

    var addr = new NSPR.types.PRNetAddr(); 
    var res = NSPR.sockets.PR_RecvFrom(
        s, 
        recvbuf, 
        bufsize, 
        0, 
        addr.address(), 
        to);

    if (res < 0) {
        var e = NSPR.errors.PR_GetError();
        if (e === NSPR.errors.PR_IO_TIMEOUT_ERROR) {
            return {error : "Request timeout", timeout : true};
        } else {
            return {error : "Error receiving: " + e};
        }
    } else if (res === 0) {
        return {error : "Network connection is closed"}; 
    }

    // remote peer
    var port = NSPR.util.PR_ntohs(addr.port);
    var ip = NSPR.util.NetAddrToString(addr);

    var out = undefined;
    if (asstring) {
        // make sure the string terminates at correct place as buffer reused
        recvbuf[res] = 0; 
        out = recvbuf.readString();
    } else {
        // FIXME: is there any native way to do the copying?
        out = [];
        for (var i = 0; i < res; i++) {
            out.push(recvbuf[i]);
        }
    }
    return {
        data: out, 
        length: res, 
        address: ip, 
        port: port
    };
};

socket.udpSendRecv = function(s, msg, asstring, timeout, size) {
    var res = socket.send(s,msg);
    if (res.error)
        return res;
    return socket.recv(s,asstring,timeout,size);
};

socket.udpRecvStart = function(callback, s, asstring, size) {
    var loopto = 100; // ms
    function loop() {
        var res = socket.recv(s,asstring,loopto,size);
        if (worker.multirespstop) {
            // stop requested, send last data/error if any
            if (res.error && res.timeout)
                res = { timeout : true};
            callback(undefined, res, true);

        } else if (res.error && !res.timeout) {
            // stop on error (other than timeout)
            callback(res.error, undefined, true);

        } else if (res.error && res.timeout) {
            // normal timeout - reloop
            setTimeout(function() { loop(); }, 0);

        } else {
            // data and reloop
            callback(undefined, res, false);
            setTimeout(function() { loop(); }, 0);
        }
    };
    setTimeout(function() { loop(); }, 0);
    return {};
};

socket.udpRecvFromStart = function(callback, s, asstring, size) {
    var loopto = 100; // ms
    function loop() {
        var res = socket.udpRecvFrom(s,asstring,loopto,size);
        if (worker.multirespstop) {
            // stop requested, send last data/error if any
            if (res.error && res.timeout)
                res = {timeout : true};
            callback(undefined, res, true);

        } else if (res.error && !res.timeout) {
            // stop on error (other than timeout)
            callback(res.error, undefined, true);

        } else if (res.error && res.timeout) {
            // normal timeout - reloop
            setTimeout(function() { loop(); }, 0);

        } else {
            // send recved data and reloop
            callback(undefined, res, false);
            setTimeout(function() { loop(); }, 0);
        }
    };
    setTimeout(function() { loop(); }, 0);
    return {};
};

socket.udpRecvStop = function(s) {
    worker.multirespstop = true;
    return {};
};
