/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/** 
 * @fileoverview Helper script for the addon menu&dialog panels 
 * (i.e. trusted content).
 *
 * Panel content loaded from the addon is 'trusted' and does not
 * require content scripts to communicate with the addon. See:
 * 
 * https://developer.mozilla.org/en-US/Add-ons/SDK/High-Level_APIs/panel#Scripting_trusted_panel_content
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr>
 */

/* Get the size of the current document. */
var getSize = function() {
    var body = document.body;
    var html = document.documentElement;

    var h = Math.max( body.scrollHeight, 
		      html.scrollHeight, 
		      body.offsetHeight,
		      html.clientHeight, 
		      html.scrollHeight,
		      html.offsetHeight, 
		      window.innerHeight);

    var w = Math.max( body.scrollWidth, 
		      html.scrollWidth,
		      body.offsetWidth, 
		      html.clientWidth, 
		      html.scrollWidth, 
		      html.offsetWidth, 
		      window.innerWidth);
    return [w,h];
}

var emit = function(what, arg) {        
    addon.port.emit('action', {
        what : what,
        arg : arg
    });
};

/** Addon requests the document size for re-sizing. */
addon.port.on('resize', function() {
    var s = getSize();
    emit('resize', {
		  width : s[0],
		  height : s[1]
    });
});

/** Render the template based on the received values. */
addon.port.on("render", function(values) {
    if (typeof Mustache !== "undefined") {
		var template = document.getElementById('rendertemplate').innerHTML;
		Mustache.parse(template);
		var rendered = Mustache.render(template, values);

		var e = document.getElementById('rendertarget');
		e.innerHTML = rendered;

		// request resize the panel to fit the rendered content
		var s = getSize();
        emit('resize', {
            width : s[0],
            height : s[1]
        });
    } else {
		console.error("Did you forgot to include mustache.js?!");
    }
});

/** Pageload stats for the current active tab (displayed in the menu). */
addon.port.on("pageload", function(pl) {
	var e = document.getElementById('pageload');
	if (!pl.monitenabled) {
		e.innerHTML = 'monitoring disabled';
	} else if (pl.readyState === 'complete') {
		e.innerHTML = pl.objects + ' objects in ' + pl.pageloadtime + ' ms';
	} else if (pl.readyState === 'loading' || pl.readyState === 'interactive') {
		e.innerHTML = 'page loading ...';
	} else {
		e.innerHTML = 'no page';
	}
});
