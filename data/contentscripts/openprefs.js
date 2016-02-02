/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew A simple content script to open Fathom preferences page.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
AddonManager.getAddonByID(self.options.id, function(aAddon) {
    unsafeWindow.gViewController.commands.cmd_showItemDetails.doCommand(aAddon, true);
});