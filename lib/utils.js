/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Misc utility functions.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu, Cr, Cm, components} = require("chrome");
const {ctypes} = Cu.import("resource://gre/modules/ctypes.jsm", null);
Cu.import('resource://gre/modules/Services.jsm');
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

const { defer } = require('sdk/core/promise');
const fileIO = require('sdk/io/file');
const system = require("sdk/system");

const ipaddr = require('ipaddr');

const {error, FathomException} = require("error");

/** Are we running on Android ? */
var isAndroid = exports.isAndroid = function() {
    return (system.platform === "android");
};

/** Are we running on Windows ? */
var isWin = exports.isWin = function() {
    return (system.platform === "winnt");
};

/** Are we running on Linux ? */
var isLinux = exports.isLinux = function() {
    return (system.platform === "linux");
};

/** Are we running on Darwin ? */
var isDarwin = exports.isDarwin = function() {
    return (system.platform === "darwin");
};

/** Is the given IP address a valid IPv6 address ? */
var isValidIPv6 = exports.isValidIPv6 = function(ip) {
	if (!ip) return false;
	if (ip.indexOf('\%')>0) {
		return ipaddr.IPv6.isValid(ip.split('\%')[0]);
	} else {
		return ipaddr.IPv6.isValid(ip);		
	}
}

/** Is the given IP address a valid IPv4 address ? */
var isValidIPv4 = exports.isValidIPv4 = function(ip) {
	if (!ip) return false;
	return ipaddr.IPv4.isValid(ip);		
}

/** Get File API object. */
var getLocalFileApi = exports.getLocalFileApi = function() {
    if ("nsILocalFile" in Ci) {
	return Ci.nsILocalFile;
    }
    else
	return Ci.nsIFile;
};

/** Check if a given file an executable. */
var isExecFile = exports.isExecFile = function(str) {
    try {
	var file = Cc['@mozilla.org/file/local;1']
	    .createInstance(getLocalFileApi());
	file.initWithPath(str);
	return (file.isFile() && file.exists() && file.isExecutable());
    } catch (e) {
	return false;
    }
};

/* The nspr library File object. */
var nsprFile = (function initnspr() { 
    var xulAppInfo = Cc["@mozilla.org/xre/app-info;1"]
	.getService(Ci.nsIXULAppInfo);
    var versionChecker = Cc["@mozilla.org/xpcom/version-comparator;1"]
	.getService(Ci.nsIVersionComparator);

    var libname = "nspr4";
    if (versionChecker.compare(xulAppInfo.version, "22.0") >= 0) {
	libname = "nss3";
    }

    var tmpfile = undefined;
    if (!isAndroid()) {
	var libd = "LibD";
	if (isDarwin())
	    libd = "ULibDir";
	else if (isWin())
	    libd = "CurProcD";

	var dirs = [Services.dirsvc.get("GreD", getLocalFileApi()),
		    Services.dirsvc.get(libd, getLocalFileApi())];

	if (isLinux()) {
	    dirs.push(FileUtils.File('/lib64'));
	    dirs.push(FileUtils.File('/lib'));
	} else if (isDarwin()) {
	    // since FF 34.0
	    dirs.push(Services.dirsvc.get("GreBinD", getLocalFileApi()));
	}

	for (var i in dirs) {
	    if (!dirs[i])
		continue;
	    if (!dirs[i].exists())
		continue;

	    tmpfile = dirs[i].clone();
	    tmpfile.append(ctypes.libraryName(libname));
	    console.log(tmpfile.path);
	    if (tmpfile.exists()) {
		break;
	    } else {
		tmpfile = undefined;
	    }
	}
    } else {
	// FIXME: figure out how android names the apks, at least -1 and -2
	// seen on test devices...
	for (var j = 0; j < 3; j++) {
	    try {
		var basepath = "/data/app/org.mozilla.firefox.apk";
		if (j > 0)
		    basepath = "/data/app/org.mozilla.firefox-"+j+".apk";
		f = FileUtils.File(basepath);
		if (!f.exists()) {
		    continue;
		};

		if (versionChecker.compare(xulAppInfo.version, "24.0") 
		    >= 0) {
		    tmpfile = FileUtils.File(basepath + 
					     "!/assets/lib"+libname+".so");
		} else {
		    tmpfile = FileUtils.File(basepath + 
					     "!/lib"+libname+".so");
		}
		if (tmpfile.exists()) {
		    break;
		} else {
		    tmpfile = undefined;		    
		}
	    } catch (e) {
		continue;
	    }
	}
    }

    if (!tmpfile) {
	throw new FathomException("nspr library not found!");
    }

    console.info("nspr4 path: " + tmpfile.path);
    console.info("nspr4 name: " + tmpfile.leafName);

    return tmpfile;
}()); // initnspr

/** The nspr library File object. */
exports.nsprFile = nsprFile;

/** @description XPCOM async read file helper.
 * 
 * FIXME: remove when this becomes available in the sdk/file/io 
 * (only sync read supporter for now).
 */
var readFileAsync = exports.readFileAsync = function(f, callback) {
    if (!fileIO.exists(f.path)) {
	callback(error("nosuchfile", f.path));
	return;
    }

    NetUtil.asyncFetch(f, function(inputStream, status) {
	if (!components.isSuccessCode(status)) {
	    callback(error("readfailed", status));
            return;
	}
	var data = "";
	try {
            data = NetUtil.readInputStreamToString(inputStream, 
						   inputStream.available());
	} catch (e) {
            if (e.name !== "NS_BASE_STREAM_CLOSED") {
		callback(error("readfailed", e));
		return;
	    } // else empty file
	}
	callback(data);
    }); // asyncFetch
};

/** Generate randmon unique id based on timestamp. 
 * Source : http://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
*/
var generateUUID = exports.generateUUID = function(d) {
    var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
    return uuid.replace(/[xy]/g, function(c) {
        var r = (d + Math.random()*16)%16 | 0;
        d = Math.floor(d/16);
        return (c=='x' ? r : (r&0x3|0x8)).toString(16);
    });
};

/** Turns any function where first param is a result callback 
 *  into a promise for easier call chaining. 
 */
var makePromise = exports.makePromise = function(f) { 
    var deferred = defer();

    // get the remaining args to be passed to f
    let args = Array.prototype.slice.call(arguments, 1);

    // add our cb as first arg
    args.unshift(function(res) {
	deferred.resolve(res);
    });

    try {
	// call f
	f.apply(null, args);
    } catch(err) {
	deferred.reject(err);
    }

    return deferred.promise;
};

/** Hash the given string. */
var getHash = exports.getHash = function(str, salt) {
    var converter =
	Cc["@mozilla.org/intl/scriptableunicodeconverter"]
	.createInstance(Ci.nsIScriptableUnicodeConverter);
    var ch = Cc["@mozilla.org/security/hash;1"]
	.createInstance(Ci.nsICryptoHash);
    converter.charset = "UTF-8";
    
    var result = {};
    if (salt)
	str += salt;
    var data = converter.convertToByteArray(str, result);
    
    ch.init(ch.SHA256);
    ch.update(data, data.length);
    var hash = ch.finish(false);

    function toHexString(charCode)
    {
	return ("0" + charCode.toString(16)).slice(-2);
    }
    var s = [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
    return s;
};
