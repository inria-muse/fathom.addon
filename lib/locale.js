/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Simple localizer for javascript.
 *
 * Could not get the sdk one to work ... copying basic framework form
 * SDK l10n here...
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
const { Cu, Cc, Ci } = require("chrome");
const { Services } = Cu.import("resource://gre/modules/Services.jsm");
const prefs = require("sdk/preferences/service");
const data = require('sdk/self').data;
const _ = require('underscore');
const {error, FathomException} = require("error");

var prefered = undefined; // filled by getPreferedLocals on first call
var locale = undefined;   // filled by getLocale on first call
var hash = {};

/**
 * Source: sdk/l10n/locale.js
 * Gets the currently selected locale for display.
 * Gets all usable locale that we can use sorted by priority of relevance
 * @return  Array of locales, begins with highest priority
 */
const PREF_MATCH_OS_LOCALE  = "intl.locale.matchOS";
const PREF_SELECTED_LOCALE  = "general.useragent.locale";
const PREF_ACCEPT_LANGUAGES = "intl.accept_languages";
var getPreferedLocales = exports.getPreferedLocales = function getPreferedLocales() {
    if (prefered)
	return prefered;

    let locales = [];

    function addLocale(locale) {
	if (locales.indexOf(locale) === -1)
	    locales.push(locale);
    }

    // Most important locale is OS one. But we use it, only if
    // "intl.locale.matchOS" pref is set to `true`.
    // Currently only used for multi-locales mobile builds.
    // http://mxr.mozilla.org/mozilla-central/source/mobile/android/installer/Makefile.in#46
    if (prefs.get(PREF_MATCH_OS_LOCALE, false)) {
	let localeService = Cc["@mozilla.org/intl/nslocaleservice;1"].
            getService(Ci.nsILocaleService);
	let osLocale = localeService.getLocaleComponentForUserAgent();
	addLocale(osLocale);
    }

    // In some cases, mainly on Fennec and on Linux version,
    // `general.useragent.locale` is a special 'localized' value, like:
    // "chrome://global/locale/intl.properties"
    let browserUiLocale = prefs.getLocalized(PREF_SELECTED_LOCALE, "") ||
        prefs.get(PREF_SELECTED_LOCALE, "");
    if (browserUiLocale)
	addLocale(browserUiLocale);

    // Third priority is the list of locales used for web content
    let contentLocales = prefs.get(PREF_ACCEPT_LANGUAGES, "");
    if (contentLocales) {
	// This list is a string of locales seperated by commas.
	// There is spaces after commas, so strip each item
	for each(let locale in contentLocales.split(","))
	    addLocale(locale.replace(/(^\s+)|(\s+$)/g, ""));
    }

    // Finally, we ensure that en-US is the final fallback if it wasn't added
    addLocale("en-US");

    prefered = locales;
    return prefered;
};

/**
 * Returns the name of the current locale (based on prefered locales and
 * on the available localized resources).
 */
var getLocale = exports.getLocale = function() {
    if (locale)
	return locale;

    _.each(getPreferedLocales(), function(l) {
	if (locale) return;
	try {
	    var d = data.load("json/"+l+".json");
	    if (d) {
		locale = l;		
		hash = JSON.parse(d);
	    }
	} catch (e) {
	    console.error("locale.js",l,e);
	    locale = undefined;
	    hash = {};
	};
    });

    if (!locale) // the default en-US should always be there!
	throw new FathomException("Could not find any locale!");    
    return locale;
};

/**
 * Source: sdk/l10n.js
 * Translate a given string + arguments to a localized string.
 */
exports.get = function(k) {
    // Get the dictionary
    if (!locale)
	getLocale();

    // Get translation from big hashmap or default to hard coded string:
    let localized = (k in hash ? hash[k] : null);

    // Key was not found in the dictionary ?
    if (!localized)
	return k;

    // # Simplest usecase:
    //   // String hard coded in source code:
    //   _("Hello world")
    //   // Identifier of a key stored in properties file
    //   _("helloString")
    if (arguments.length <= 1)
	return localized;

    // # String with placeholders:
    //   // Strings hard coded in source code:
    //   _("Hello %s", username)
    //   // Identifier of a key stored in properties file
    //   _("helloString", username)
    var args = Array.prototype.slice.call(arguments);
    let offset = 1;
    localized = localized.replace(/%(s|d)/g, function (v, n) {
	let rv = args[offset];
	offset++;
	return rv;
    });

    return localized;
};

