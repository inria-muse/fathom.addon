/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/


/**
 * @fileoverfiew TCP socket methods.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

 socket.tcpOpenSendSocket = function(ip, port) {
    var s = NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
    if (!s)
        return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};

    var timeout = NSPR.util.PR_MillisecondsToInterval(1000);
    var addr = new NSPR.types.PRNetAddr();
    addr.ip = NSPR.util.StringToNetAddr(ip);
    NSPR.sockets.PR_SetNetAddr(
        NSPR.sockets.PR_IpAddrNull, 
        NSPR.sockets.PR_AF_INET, 
        port, 
        addr.address());

    if (NSPR.sockets.PR_Connect(s, addr.address(), timeout) < 0) {
        NSPR.sockets.PR_Close(s);
        return {error : "Error connecting: " + NSPR.errors.PR_GetError()};
    }

    // ok
    return s;
};

socket.tcpOpenReceiveSocket = function(port, reuse) {
    var s = NSPR.sockets.PR_OpenTCPSocket(NSPR.sockets.PR_AF_INET);
    if (!s)
        return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};

    reuse = (reuse!==undefined ? reuse : false);
    if (reuse) {
        var res = socket.setSocketOption(s,'reuseaddr',true); 
        if (res.error) {
            NSPR.sockets.PR_Close(s);
            return res;
        }
    }

    var addr = new NSPR.types.PRNetAddr();
    NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrAny, 
     NSPR.sockets.PR_AF_INET,
     port, addr.address());

    if (NSPR.sockets.PR_Bind(s, addr.address()) != 0) {
        NSPR.sockets.PR_Close(s);        
        return {error: "Error binding: " + NSPR.errors.PR_GetError()};
    }

    if (NSPR.sockets.PR_Listen(s, 1) != 0) {
        NSPR.sockets.PR_Close(s);
        return {error: "Error listening: " + NSPR.errors.PR_GetError()};
    }

    // ok
    return s;
};

// FIXME: how could we pass the new socket back to the 
// addon so that we could start a new chromeworker
// for this socket ? if this is possible, should accept
// in a loop here and spawn new workers for incoming
// connections ...

socket.tcpAccept = function(s, timeout) {
    var to = NSPR.sockets.PR_INTERVAL_NO_WAIT;
    if (timeout && timeout < 0) {
        to = NSPR.sockets.PR_NO_TIMEOUT;
    } else if (timeout && timeout > 0) {
        to = NSPR.util.PR_MillisecondsToInterval(timeout);
    }

    var addr = new NSPR.types.PRNetAddr();
    var sin = NSPR.sockets.PR_Accept(s, 
       addr.address(), 
       to);

    if (!sin.isNull()) {
        // close the listening socket and replace the current listening socket
        // with the incoming client socket
        if (s !== -1)
            NSPR.sockets.PR_Close(s); 
        worker.socket = sin;

        var port = NSPR.util.PR_ntohs(addr.port);
        var ip = NSPR.util.NetAddrToString(addr);
        return {port : port, ip : ip};
    } else {
        return {error : "got empty incoming socket"};
    }
};
