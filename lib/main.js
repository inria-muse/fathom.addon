/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The addon entry point.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const fathom = require('./fathom');

/** Handle addon load. */
exports.main = function(options, callbacks) {
    // FIXME: should be just 'install' but does not work now, see:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=627432
    var install = (options.loadReason === 'enable' || 
		   options.loadReason === 'install');

    fathom.setup(install, (options.loadReason === 'upgrade'));

    // load UI elements
    require('./ui/main');
};

/** Handle addon unload. */
exports.onUnload = function(reason) {
    // FIXME: should be 'uninstall' but does not work now, see:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=627432
    var uninstall = (reason === 'disable'); 
    fathom.cleanup(uninstall);
};