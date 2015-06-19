/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Multicast socket methods.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

socket.multicastOpenSocket = function(ttl, loopback) {
    var s = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
    if (!s || s === -1)
        return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};

    // Set the TTL for the send. Default 1 (local network).
    if (ttl!==undefined && ttl>0) {
        var res = socket.setSocketOption(s,'mcast_ttl',ttl); 
        if (res.error) {
            if (s !== -1)
                NSPR.sockets.PR_Close(s);
            return res;
        }
    }

    // Should the data be sent to localhost
    if (loopback!==undefined) {
        var res = socket.setSocketOption(s,'mcast_loopback',loopback); 
        if (res.error) {
            if (s !== -1)
                NSPR.sockets.PR_Close(s);
            return res;
        }
    }

    // ok
    return s;
};

socket.multicastJoin = function(s, ip, port, reuse) {
    if (reuse!==undefined) {
        var res = socket.setSocketOption(s,'reuseaddr',true); 
        if (res.error) {
            return res;
        }
    }
    
    if (port) {
        var addr = new NSPR.types.PRNetAddr();
        NSPR.sockets.PR_SetNetAddr(NSPR.sockets.PR_IpAddrAny, 
         NSPR.sockets.PR_AF_INET, 
         port, addr.address());

        if (NSPR.sockets.PR_Bind(s, addr.address()) != 0) {
            return {error: "Error binding: " + NSPR.errors.PR_GetError()};
        }
    }

    var opt = new NSPR.types.PRMulticastSocketOptionData();
    opt.option = NSPR.sockets.PR_SockOpt_AddMember;

    var maddr = new NSPR.types.PRMcastRequest();    
    maddr.mcaddr = new NSPR.types.PRNetAddr();
    maddr.mcaddr.ip = NSPR.util.StringToNetAddr(ip);

    NSPR.sockets.PR_SetNetAddr(
        NSPR.sockets.PR_IpAddrNull, 
        NSPR.sockets.PR_AF_INET, 
        0, 
        maddr.mcaddr.address());  
    
    maddr.setInterfaceIpAddrAny();
    opt.value = maddr;

    if (NSPR.sockets.PR_SetMulticastSocketOption(s, opt.address()) === NSPR.sockets.PR_FAILURE) {
        return {error : "Failed to set option ["+opt.option+"="+ip+"]: "+NSPR.errors.PR_GetError()};
    }

    // ok
    return {};
};
