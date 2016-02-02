/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/** 
 * @fileoverview Fathom addon browser UI. Adds a simple toggle button with
 * a menu to the action bar.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>
 */
const self = require("sdk/self");
const sprefs = require("sdk/simple-prefs");
const userPrefs = sprefs.prefs;

const utils = require('../utils');
const consts = require('../consts');
const fathom = require('../fathom');

if (utils.isAndroid()) {

    console.warn("android ui not implemented");

    // TODO: add fathom stuff to the FF menu ?

} else {

    // desktop UI
    const { ToggleButton } = require('sdk/ui/button/toggle');
    const view = require('sdk/ui/button/view');
    const panel = require("sdk/panel");
    const tabs = require("sdk/tabs");

    const dialogs = require('../ui/dialogs');

    /* The menu. */
    var menupanel = panel.Panel({
        contentURL: self.data.url("mainmenu.html"),
        width: 200,
        height: 235,
        onHide: function() {
            button.state('window', {checked: false});
        }    
    });
    var setsize = true;

    /* Menu bar item click handler. */
    menupanel.port.on("action", function(action) {
        switch (action.what) {   
        case "prefs":
            // Open Fathom addon preferences (trick from): 
            // http://stackoverflow.com/questions/22593454/has-ff-addon-sdk-an-api-to-open-settings-page
            menupanel.hide();
            tabs.open({
                url: 'about:addons',
                onReady: function(tab) {
                    tab.attach({
                        contentScriptWhen: 'end',
                        contentScriptFile: self.data.url('contentscripts/openprefs.js'),
                        contentScriptOptions : { id : self.id }
                    });
                }
            });
            break;

        case "open":
            menupanel.hide();
            tabs.open({url: action.arg});
            break;

        case "about":
            // Open 'about' dialog
            menupanel.hide();
            dialogs.showAboutDialog();
            break;

        case "resize":
            menupanel.resize(action.arg.width, action.arg.height);
            break;

        case "close":
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
        onChange: function(state) {
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
}