/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/** 
 * @fileoverview Fathom addon browser UI. Adds a simple toggle button with
 * a menu to the action bar.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>
 */

const { ToggleButton } = require('sdk/ui/button/toggle');
const view = require('sdk/ui/button/view');
const panel = require("sdk/panel");
const tabs = require("sdk/tabs");
const self = require("sdk/self");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;

const dialogs = require('../ui/dialogs');
const consts = require('../consts');
const fathom = require('../fathom');

/* The menu. */
var menupanel = panel.Panel({
    contentURL: self.data.url("mainmenu.html"),
    width: 200,
    height: 180,
    onHide: function() {
        button.state('window', {checked: false});
    }    
});
var setsize = true;

menupanel.port.on("resize", function(o) {
    menupanel.resize(o.width, o.height);
});

 menupanel.port.on("close", function() {
    menupanel.hide();
});

/* Menu bar item click handler. */
menupanel.port.on("action", function(action) {
    switch (action) {   
    case "prefs":
        // Open Fathom addon preferences (trick from): 
        // http://stackoverflow.com/questions/22593454/has-ff-addon-sdk-an-api-to-open-settings-page
        tabs.open({
            url: 'about:addons',
            onReady: function(tab) {
                menupanel.hide();
                tab.attach({
                    contentScriptWhen: 'end',
                    contentScript: 'AddonManager.getAddonByID("' + self.id + '", function(aAddon) {\n' +
                        'unsafeWindow.gViewController.commands.cmd_showItemDetails.doCommand(aAddon, true);\n' +
                        '});\n'
                });
            }
        }); 
        break;

    case "about":
        // Open 'about' dialog
        menupanel.hide();
        dialogs.showAboutDialog();
        break;

    default:
        menupanel.hide();
    }
});

/* Action bar toggle button to tricker Fathom Menu. */
var button = ToggleButton({
    id: "fbutton",
    label: "Fathom",
    icon: {
        "16": "./icons/icon-16.png",
        "32": "./icons/icon-32.png",
        "64": "./icons/icon-64.png",
    },
    onClick: function(state) {
        if (state.checked) {
            // open menu
            menupanel.show({position: button});  
            // send current active tab pageload status/stats
            menupanel.port.emit('pageload', fathom.getActiveTab());
            // handle sizing on first open
            if (setsize)
                menupanel.port.emit('resize',null);
            setsize = false;
        } // else hiding
    }
});
