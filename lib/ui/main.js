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
const dialogs = require('ui/dialogs');
const config = require('../config');

var setsize = true;

var menupanel = panel.Panel({
    contentURL: self.data.url("mainmenu.html"),
    width: 200,
    height: 180,
    onHide: function() {
	button.state('window', {checked: false});
    }    
});

menupanel.port.on("resize", function(o) {
    menupanel.resize(o.width, o.height);
});

menupanel.port.on("close", function() {
    menupanel.hide();
});

menupanel.port.on("action", function(action) {
    switch (action) {	
    case "fathom":
	// toggle the fathom baseline measurements status
	userPrefs[config.BASELINE] = !userPrefs[config.BASELINE];
	menupanel.port.emit('fathom', userPrefs[config.BASELINE]);
	break;
    case "about":
	menupanel.hide();
	dialogs.showAboutDialog();
	break;
    default:
	menupanel.hide();
	break;
    }
});

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
	    menupanel.show({position: button});	 
	    menupanel.port.emit('fathom', userPrefs[config.BASELINE]);
	    if (setsize)
		menupanel.port.emit('resize',null);
	    setsize = false;
	}
    }
});
