/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Debug helper for workerscripts.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var debugoff = true;

var debug = function(tag, msg) {
    if (debugoff) return;
    if (typeof msg !== "string")
      msg = JSON.stringify(msg);
    dump("debug: fathom: ChromeWorker ["+tag+"worker]: " + msg + "\n");
};

var error = function(tag, msg) {
    if (typeof msg !== "string")
       msg = JSON.stringify(msg);
    dump("error: fathom: ChromeWorker ["+tag+"worker]: " + msg + "\n");
};