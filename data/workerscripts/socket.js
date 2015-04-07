/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Socket API.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

 socket.setSocketOption = function(s, name, value) {
    var opt = new NSPR.types.PRSocketOptionData();

    if (name === "reuseaddr") {
        opt.option = NSPR.sockets.PR_SockOpt_Reuseaddr;
        opt.value = (value ? NSPR.sockets.PR_TRUE : NSPR.sockets.PR_FALSE);

    } else if (name === "bcast") {
        opt.option = NSPR.sockets.PR_SockOpt_Broadcast;
        opt.value = (value ? NSPR.sockets.PR_TRUE : NSPR.sockets.PR_FALSE);

    } else if (name === "mcast_ttl") {
        opt.option = NSPR.sockets.PR_SockOpt_McastTimeToLive;
        opt.value = value;

    } else if (name === "mcast_loopback") {
        opt.option = NSPR.sockets.PR_SockOpt_McastLoopback;
        opt.value = (value ? NSPR.sockets.PR_TRUE : NSPR.sockets.PR_FALSE);

    } else {
        return {error: "Unknown socket option name: " + name};
    }

    var ret = NSPR.sockets.PR_SetSocketOption(s, opt.address());
    if (ret === NSPR.sockets.PR_FAILURE) {
        return {error : "Failed to set option ["+name+"="+value+"]: " + 
        NSPR.errors.PR_GetError()};
    }

    // ok
    return {};
}

socket.getHostIP = function(s) {
    var selfAddr = NSPR.types.PRNetAddr();
    NSPR.sockets.PR_GetSockName(s, selfAddr.address());
    return { 
        address : NSPR.util.NetAddrToString(selfAddr),
        port : NSPR.util.PR_ntohs(selfAddr.port)
    };
}

socket.getPeerIP = function(s) {
    var peerAddr = NSPR.types.PRNetAddr();
    NSPR.sockets.PR_GetPeerName(s, peerAddr.address());
    return { 
        address : NSPR.util.NetAddrToString(peerAddr),
        port : NSPR.util.PR_ntohs(peerAddr.port)
    };
}

socket.send = function(s, msg) {
    var sendBuf = newBufferFromString(msg);
    var res = NSPR.sockets.PR_Send(s, 
       sendBuf, 
       msg.length, 
       0, 
       NSPR.sockets.PR_INTERVAL_NO_WAIT);

    if (res < 0) {
        return {error : "Error sending: " + NSPR.errors.PR_GetError()};
    } else {
        return {length : res};
    }
};

socket.recv = function(s, asstring, timeout, size) {
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

    var res = NSPR.sockets.PR_Recv(s, 
       recvbuf, 
       bufsize, 
       0, 
       to);

    if (res < 0) {
        var e = NSPR.errors.PR_GetError();
        if (e === NSPR.errors.PR_IO_TIMEOUT_ERROR) {
            return {error : "Request timeout", timeout : true};
        } else {
            return {error : "Error receiving: " + NSPR.errors.PR_GetError()};
        }
    } else if (res === 0) {
        return {error : "Network connection is closed"}; 
    }

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

    return {data: out, length: res};
};
