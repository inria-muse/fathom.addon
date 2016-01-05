/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Misc utility functions shared by various modules.
 * 
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
const Request = require("sdk/request").Request;

const ipaddr = require('ipaddr.js');
const _ = require('underscore');

const {error, FathomException} = require("./error");
const config = require('./config');

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
};

/** Is the given IP address a valid IPv4 address ? */
var isValidIPv4 = exports.isValidIPv4 = function(ip) {
	if (!ip) return false;
	return ipaddr.IPv4.isValid(ip);		
};

/** Is the given IP address a valid IPv4 unicast address ? */
var isValidIPv4unicast = exports.isValidIPv4unicast = function(ip) {
	if (!isValidIPv4(ip))
		return false;
	var addr = ipaddr.parse(ip);
	var r = addr.range();
	// FIXME: false on bcast, but these no real rule like this ..
	return (addr.octets[3] !== 255 && (r === 'unicast' || r === 'private'));		
};

/** Is the given IP address a valid IPv6 unicast address ? */
var isValidIPv6unicast = exports.isValidIPv6unicast = function(ip) {
	ip = (ip.indexOf('\%')>0 ? ip.split('\%')[0] : ip);
	if (!isValidIPv6(ip))
		return false;
	var r = ipaddr.parse(ip).range();
	return (r === 'unicast' || r === 'private');		
};

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
exports.nsprFile = (function() { 
    var xulAppInfo = Cc["@mozilla.org/xre/app-info;1"]
		.getService(Ci.nsIXULAppInfo);
    var versionChecker = Cc["@mozilla.org/xpcom/version-comparator;1"]
		.getService(Ci.nsIVersionComparator);
    var psm = Cc["@mozilla.org/psm;1"]
        .getService(Ci.nsISupports);

    var libfile = undefined;
    var libname = "nspr4";
    if (versionChecker.compare(xulAppInfo.version, "22.0") >= 0) {
		libname = "nss3";
    }
    console.log("utils xullAppInfo="+xulAppInfo.version+" nsprFileName=" + libname);

    // Source: https://mxr.mozilla.org/mozilla-central/source/services/crypto/modules/WeaveCrypto.js#123 :
    var path = ctypes.libraryName(libname);
    libfile = Services.dirsvc.get("GreBinD", getLocalFileApi());
    libfile.append(path);
    if (!libfile.exists()) {
        libfile = undefined;

        if (!isAndroid()) {
    		var libd = "LibD";
    		if (isDarwin())
    		    libd = "ULibDir";
    		else if (isWin())
    		    libd = "CurProcD";

    		var dirs = [ Services.dirsvc.get("GreD", getLocalFileApi()),
    			         Services.dirsvc.get(libd, getLocalFileApi()) ];

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

    		    libfile = dirs[i].clone();
    		    libfile.append(ctypes.libraryName(libname));
    		    if (libfile.exists()) {
    				break;
    		    }

    			libfile = undefined;
    		}

        } else {
            libfile = Services.dirsvc.get("GreD", getLocalFileApi());
            libfile.append(path);
            if (!libfile.exists()) {
                libfile = undefined;
                // nightly is called fennec, releases are firefox
                _.each(['fennec-xx.apk', 'fennec-xx/base.apk', 'firefox-xx.apk', 'firefox-xx/base.apk'], function(base) {
                    if (libfile !== undefined)
                        return;

                    // FIXME: figure out how android names the apks, at least -1 and -2
                    // seen on test devices...
                    for (var i = 1; i < 4; i++) {
            		    try {
            				var basepath = "/data/app/org.mozilla." + base.replace('xx', i);

            				var f = FileUtils.File(basepath);
        	       			if (!f.exists()) {
                                continue;
                            }

                            // FIXME: since when ?
                            if (versionChecker.compare(xulAppInfo.version, "38.0") >= 0) {
                                libfile = FileUtils.File(basepath + "!/assets/armeabi-v7a/lib"+libname+".so");
                            } else if (versionChecker.compare(xulAppInfo.version, "24.0") >= 0) {
                                libfile = FileUtils.File(basepath + "!/assets/lib"+libname+".so");
            				} else {
            				    libfile = FileUtils.File(basepath + "!/lib"+libname+".so");
            				}

            				if (libfile.exists()) {
            				    break;
                            }
            		    } catch (e) {
            		    }
                        libfile = undefined;
                    }
        		});
            }
        }
    }

    if (!libfile) {
	   throw new FathomException("nspr library not found!");
    }

    console.log("utils found nspr lib at " + libfile.path);    
    return libfile;
}());

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
		    return callback(error("readfailed", status));
		}
		var data = "";
		try {
	        data = NetUtil.readInputStreamToString(inputStream, 
							   inputStream.available());
		} catch (e) {
	        if (e.name !== "NS_BASE_STREAM_CLOSED") {
				return callback(error("readfailed", e));
		    } // else empty file
		}
		return callback(data);
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
    var converter = Cc["@mozilla.org/intl/scriptableunicodeconverter"]
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

    function toHexString(charCode) {
		return ("0" + charCode.toString(16)).slice(-2);
    }
    var s = [toHexString(hash.charCodeAt(i)) for (i in hash)].join("");
    return s;
};

//----------------- Net Utils --------------------
//
// Various network lookups

/** Fetch JSON object from the given URL. */
var getJSON = exports.getJSON = function(callback, url) {
    if (!url)
        return callback(error("missingparams", "url"));    

    Request({
        url: url,
        onComplete: function(response) {
            if (response && response.status == 200 && !response.error) {
                callback(response.json);
            } else {
                let err = undefined;
                if (response.json && response.json.error)
                    err = error("servererror", response.json.error);
                else
                    err = error("http", response.status+"/"+response.statusText);
                callback(err);
            }
        }
    }).get();    
};

/** Resolve the closest MLAB server (for current public IP). */
var getMlabServer = exports.getMlabServer= function(callback) {
    return getJSON(callback, config.get("mlab", "getserverurl"));
};

/** Lookup current public IP. */
var lookupIP = exports.lookupIP = function(callback) {
    var url = config.get("api", "url")+"/ip";
    return getJSON(function(json) {
        if (!json.error)
            callback(json.ip);
        else
            callback(json);
    }, url);
};

/** Resolve basic IP info using RIPE stats API. */
var getIpInfo = exports.getIpInfo = function(callback, ip) {
    if (!ip) {
        callback(error("missingparams", "ip"));
        return;
    }
    
    if (!isValidIPv4unicast(ip) && !isValidIPv6unicast(ip)) {
        callback(error("invalidparams", "ip " + ip));
        return;
    }

    var cfg = config.get("ripe");
    var resp = 0;
    var fullres = { ip : ip };
    _.each(cfg['names'], function(dataname) {
        let url = cfg['url'] + '/' +  dataname + '/data.json?resource=' + ip + '&sourceapp=' + cfg['sourceapp'];
        getJSON(function(json) {
            resp += 1;
            if (!json.error) {
                fullres[dataname] = json['data'];
            } else {
                fullres[dataname] = json;
            }

            // was this the last pending response ?
            if (resp === cfg['names'].length) {
                callback(fullres);
            }
        }, url);
    }); //each
};

/** getIpInfo Promise */
var getIpInfoP = exports.getIpInfoP = function(ip) {
    return makePromise(getIpInfo, ip);    
}

// store mac lookup results in memory to avoid requesting same MACs
// over and over again, size limited to MAX_CACHE, policy LFRU
var maccache = {};
const MAX_CACHE = 256;

/** Lookup device manufacturer info based on MAC address. */
var lookupMAC = exports.lookupMAC = function(callback, mac) {    
    if (!mac)
        return callback(error("missingparams", "mac"));

    if (maccache[mac]) {
        maccache[mac].ts = new Date().getTime();
        callback(maccache[mac].obj);
        return;
    }

    getJSON(function(json) {
        if (!json.error) {
            maccache[mac] = { 
                obj : json, 
                ts : new Date().getTime()
            }            
        }

        callback(json);

        if (_.size(maccache) > MAX_CACHE) {
            // delete some items to keep the cache size down
            _.each(_.sortBy(_.keys(maccache), 
                function(k) {
                    return maccache[k].ts; // oldest first
                }).slice(0, int(MAX_CACHE*0.5)),  
                 function(k) {
                    delete maccache[k];
                }); // _.each            
        }
    }, config.get("api", "url")+"/mac/"+mac);
};