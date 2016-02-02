/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The addon entry point.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

/** Addon load. */
exports.main = function(options, callbacks) {
    require('./fathom').setup(options.loadReason);
    require('./ui/main').setup();
};

/** Addon unload. Note: reason is always 'disable' ... */
exports.onUnload = function(reason) {
    require('./fathom').cleanup(reason);
};