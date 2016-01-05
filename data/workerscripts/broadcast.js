/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
   */

/**
 * @fileoverfiew Broadcast socket methods.
 *
 * Assumes that the global NSPR object has been loaded already.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

socket.broadcastOpenSendSocket = function() {
  var s = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
  if (!s || s === -1)
    return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};

  var res = socket.setSocketOption(s,'bcast',true); 
  if (res.error) {
    if (s !== -1)
      NSPR.sockets.PR_Close(s);
    return res;
  }
  return s;
};

socket.broadcastOpenReceiveSocket = function(port) {
  var s = NSPR.sockets.PR_OpenUDPSocket(NSPR.sockets.PR_AF_INET);
  if (!s || s === -1)
    return {error: "Error creating socket: " + NSPR.errors.PR_GetError()};

  var res = socket.setSocketOptionRet(s,'reuseaddr',true); 
  if (res.error) {
    NSPR.sockets.PR_Close(s);
    return res;
  }

  var addr = new NSPR.types.PRNetAddr();
  NSPR.sockets.PR_SetNetAddr(
    NSPR.sockets.PR_IpAddrAny, 
    NSPR.sockets.PR_AF_INET, port, addr.address());

  if (NSPR.sockets.PR_Bind(s, addr.address()) != 0) {
    if (s !== -1)
      NSPR.sockets.PR_Close(s);
    return {error: "Error binding: " + NSPR.errors.PR_GetError()};
  }
  return s;
};