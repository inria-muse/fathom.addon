/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew The implementation of fathom.system API.
 *
 * This API calls various command line tools to provide system
 * configuration and performance statistics.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

 const { Unknown } = require('sdk/platform/xpcom');
 const {Cc, Ci, Cu} = require("chrome");
 Cu.import("resource://gre/modules/FileUtils.jsm");
 Cu.import("resource://gre/modules/NetUtil.jsm");
 const { env } = require('sdk/system/environment');
 const fileIO = require('sdk/io/file');
 const system = require("sdk/system");
 const timers = require("sdk/timers");

 const subprocess = require("subprocess");
 const parser = require('syscmdparser');
 const _ = require('underscore');

 const {error, FathomException} = require("error");
 const utils = require("utils");
 const config = require("config");

 const os = system.platform;

 const winnt = "winnt";
 const android = "android";
 const linux = "linux";
 const darwin = "darwin";

 const airport = "/System/Library/PrivateFrameworks/Apple80211.framework"+
     "/Versions/Current/Resources/airport";

// extend command name with full path, cache resolved entries
var resolvecache = {
    'which' : undefined,
    'airport' : airport  // special case(s)
};

// the shell cmd wrapper
var cmd_wrapper = (function getwrapper() {
    var cmd_wrapper_name = 
    (os === winnt ? "fathom-cmdwrapper.js" : "fathom-cmdwrapper.sh");
    var file = FileUtils.getFile("TmpD", [cmd_wrapper_name]);
    return file;
}());

var searchinpath = function(cmd) {
    var res = undefined;
    if (env.PATH) {
        var elems = (os === winnt ? env.PATH.split(';') : env.PATH.split(':'));
        var w = (os !== winnt ? '/'+cmd : "\\"+cmd+".exe");
        var ex;
        for (var i = 0; i < elems.length && !res; i++) {
            ex = elems[i]+w;
            if (os === winnt) {
                ex = ex.replace(/\\/g,'\\\\');
            }
            if (utils.isExecFile(ex)) {
                res = ex;
            }
        }
    }
    return res;
};

// resolve the full path for 'cmd', e.g. ping -> /usr/bin/ping
var resolvecmd = function(callback, cmd) {
    if (utils.isExecFile(cmd)) { 
        console.log('systemapi',cmd+' is executable');
        callback(cmd);

    } else if (resolvecache[cmd]) {
        console.log('systemapi',cmd+'->'+resolvecache[cmd]);
        callback(resolvecache[cmd]);    

    } else if (os === winnt && 
        utils.isExecFile("C:\\Windows\\system32\\"+cmd+".exe")) {
        resolvecache[cmd] = "C:\\Windows\\system32\\"+cmd+".exe";
        console.log('systemapi',cmd+'->'+resolvecache[cmd]);
        callback(resolvecache[cmd]);

    } else if (resolvecache['which']!==undefined) {
        // resolve with 'which' command
        subprocess.call({
            command: resolvecache['which'],
            arguments: [cmd],
            done: function(res) {
                if (res.stdout && res.exitCode === 0) {
                    resolvecache[cmd] = res.stdout.trim();
                    console.log('systemapi',cmd+'->'+resolvecache[cmd]);
                    callback(resolvecache[cmd]);

                } else {
                    // did not work, try to find in 'PATH'
                    var tmp = searchinpath(cmd);
                    if (tmp)
                        resolvecache[cmd] = tmp;
                    console.log('systemapi',cmd+'->'+tmp);
                    callback(tmp);          
                }
            },
            mergeStderr: false
        });
    } else {
        // try in 'PATH' or fail
        var tmp = searchinpath(cmd);
        if (tmp)
            resolvecache[cmd] = tmp;
        console.log('systemapi',cmd+'->'+tmp);
        callback(resolvecache[tmp]);
    }
};

/**
 * Initialize the API component (create the command wrapper file).
 */
 var setup = exports.setup = function() {
    console.info("systemapi setup");

    if (os !== winnt && utils.isExecFile('/usr/bin/which')) {
        resolvecache['which'] = '/usr/bin/which'; // the usual case
    } else {
        resolvecache['which'] = searchinpath((os !== winnt ? 'which' : "where"));
    } // else will fallback to the old scripts
    console.info('systemapi resolved which -> ' + resolvecache['which']);

    var write = function(f, text) {
        console.info("systemapi write " + f.path);

        var foStream = Cc["@mozilla.org/network/file-output-stream;1"]
            .createInstance(Ci.nsIFileOutputStream);

        // write, create, truncate + exec permissions
        foStream.init(f, 0x02 | 0x08 | 0x20, 0755, 0);
    
        var converter = Cc["@mozilla.org/intl/converter-output-stream;1"]
            .createInstance(Ci.nsIConverterOutputStream);
        converter.init(foStream, "UTF-8", 0, 0);
    
        converter.writeString(text);
        converter.close(); // this also closes foStream
    };

    if (os === winnt) {
        var tmpfile = FileUtils.getFile("TmpD", ["fathomcmdwrapper.bat"]);
        var wrapperlines = [
            '@ECHO OFF',
            'set errorlevel=',
            '%3 %4 %5 %6 %7 %8 %9 > %~s1 2> %~s2',
            'exit /b %errorlevel%'];

        write(tmpfile, wrapperlines.join('\r\n') + '\r\n');
        
        // now write the actual wrapper
        wrapperlines = [
            'var dir = WScript.ScriptFullName.replace(/[\\/\\\\]+[^\\/\\\\]*$/, "");',
            'var Shell = WScript.CreateObject("Wscript.Shell");',
            'Shell.CurrentDirectory = dir;',
            'var objArgs = WScript.Arguments;',
            'var arg = "";',
            'for(var i = 0; i < objArgs.length; i++) {',
            '   arg = arg + " " + objArgs(i);',
            '}',
            'Shell.Run("fathomcmdwrapper.bat " + arg, 0, true);'];
        
        write(cmd_wrapper, wrapperlines.join('\r\n') + '\r\n');
        
    } else {
        var wrapperlines = [
            '#!/bin/sh',
            'OUTFILE="$1"',
            'ERRFILE="$2"',
            'shift',
            'shift',
            '$@ >"$OUTFILE" 2>"$ERRFILE"'];
        var contents = wrapperlines.join('\n') + '\n';
        write(cmd_wrapper, contents);
    }
};

/**
 * Cleanup the API component (remove tmp files).
 */
var cleanup = exports.cleanup = function() {
    console.info("systemapi cleanup");

    if (fileIO.exists(cmd_wrapper.path)) {
        fileIO.remove(cmd_wrapper.path);
    }

    if (os === winnt) {
        var tmpfile = FileUtils.getFile("TmpD", ["fathomcmdwrapper.bat"]);
        if (fileIO.exists(tmpfile.path)) {
            fileIO.remove(tmpfile.path);
        }
    }

    // cleanup any other fathom files from tmp
    var tmpdir = FileUtils.getDir("TmpD",[]);
    if (tmpdir) {
        for (var f in fileIO.list(tmpdir.path)) {
            if (f.indexOf('fathom')>=0) {
                fileIO.remove(FileUtils.getFile("TmpD",[f]).path);
            }
        }
    }
};

/**
 * Executes the given request and callback with the data or an object with
 * error field with a short error message.
 */ 
var exec = exports.exec = function(callback, req, manifest) {
    if (!req.method) {
        return callback(error("missingmethod"));
    } else if (!api[req.method]) {
        return callback(error("nosuchmethod", req.method));
    }
    api[req.method](callback, req.params, (req.multiresp !== undefined ? req.multiresp : false)); 
};

/** Systemapi calls as promise for easier chaining etc. */
var execp = exports.execp = function(req, manifest) {
    return utils.makePromise(exec, req, manifest);
};

// helper func to deal with sys command output parsing and results
var handleout = function(err, stdout, stderr, callback, cmd, args, params, done) {
    var r = undefined;
    try {
        r = parser.parse(err, stdout, stderr, cmd, args, params);
    } catch (e) {
        console.error("systemapi output parsing failed for: " + 
                      cmd + ' ' + args.join(' ')); 
        console.exception(e);
        r = error("parseerror",e.message);
    }

    // only send something if we're done or got results
    if (r || done) {
        try {
            callback(r, done);
        } catch (e) {
            console.error("systemapi callback failed for "  + 
                          cmd + ' ' + args.join(' '));
            console.exception(e);
        }
    }
}

var execcmd = function(callback, cmd, args, params, inc) {
    // standard format
    if (args.length>0) {
        args = args.join(' ').split(' ');
    }

    // we need the full path for the subprocess module to work ...
    resolvecmd(function(extcmd) {
        if (!extcmd) {
            // full exec not found ... use the old way
            return execold(callback, cmd, args, params, inc);
        }

        var prog = {
            command: extcmd,
            arguments: args,
            done: function(res) {
                handleout(
                    res.exitCode, 
                    res.stdout, 
                    res.stderr, 
                    callback, 
                    cmd, 
                    args, 
                    params,
                    true);
            },
            mergeStderr: false
        };

        // incremental output, try sending stuff everytime
        // we get more data on stdout
        if (inc) {
            var stdout = "";
            prog.stdout = function(data) {
                stdout += data;
                handleout(
                    0,
                    stdout,
                    undefined,
                    callback, 
                    cmd, 
                    args, 
                    params,
                    false);
            };
        }

        subprocess.call(prog); 

    }, cmd);  // resolve
};

// TODO : remove ? windoze does not support the subprocess yet ?
var execold = function(callback, cmd, args, params, inc) {
    var commandid = Math.random().toString();
    args = args || [];

    console.warn("systemapi fallback to script exec " + cmd + ", inc="+inc + ", id=" + commandid);

    var outfile = FileUtils.getFile(
        "TmpD", ['fathom-command.' + commandid + '.out']);

    var errfile = FileUtils.getFile(
        "TmpD", ['fathom-command.' + commandid + '.err']);

    // for incremental output
    var inciv = undefined;

    // async process call ready observer
    var observer = {
      observe : function(subject, topic, data) {
          if (topic != "process-finished" && topic != "process-failed") {
              // should not happen ?
              console.warn("[" + commandid + 
                 "] unexpected topic observed by process observer: "+ 
                 topic + " on " + JSON.stringify(subject));
              return;
          }

          if (inciv)
              timers.clearInterval(inciv);
          inciv = undefined;

          console.log("systemapi [" + commandid + "] exec command ready:  "+ 
              topic + "/" + subject.exitValue);

          utils.readFileAsync(outfile, function(stdout) {
              utils.readFileAsync(errfile, function(stderr) {
                handleout(
                    subject.exitValue, 
                    stdout, 
                    stderr, 
                    callback, 
                    cmd, 
                    args,
                    params, 
                    true);
                fileIO.remove(outfile.path);
                fileIO.remove(errfile.path);
            });
          });
        } // observe
    }; // observer

    var process = Cc["@mozilla.org/process/util;1"]
        .createInstance(Ci.nsIProcess);
    var wrapperargs = undefined;
    if (os === android) {
        // get sh executable
        var sh = FileUtils.File("/system/bin/sh");
        if (!sh || !fileIO.exists(sh)) {
            return callback(error("nosuchfile","/system/bin/sh"));
        }
        process.init(sh);
        wrapperargs = [wrapperfilepath, outfile.path, errfile.path, cmd].concat(args);
    } else {
        process.init(cmd_wrapper);
        wrapperargs = [outfile.path, errfile.path, cmd].concat(args);
    }

    if (inc) {
        // timer to read output file periodically
        inciv = timers.setInterval(function() {
          utils.readFileAsync(outfile, function(stdout) {
              handleout(
                0,
                stdout,
                undefined,
                callback, 
                cmd, 
                args, 
                params,
                false);
          });
        }, 500); // in ms
    }

    process.runAsync(wrapperargs, wrapperargs.length, observer);
};

//------------------------------ API IMPLEMENTATION ----------------------
// fathom.system.*
var api = {};

api.getOS = function(callback, params, inc) {
    callback(os, true);
};

api.doTraceroute = function(callback, params, inc) {
    var host = (params && params.length>=1 ? params[0] : undefined);
    if (!host) {
        return callback(error("missingparams","host"));
    }

    // use options or traceroute default values
    var opt = (params && params.length==2 ? params[1] : {});
    opt = opt || {};
    var iface = opt.iface || undefined;
    var count = opt.count || undefined;
    var waittime = opt.waittime || undefined;
    var maxttl = opt.maxttl || undefined;

    // build the command
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "tracert";
        args.push('-4');
        args.push('-d');
        if (waittime) {
            if (waittime < 0.001) {
                waittime = 0.001;
            }
            args.push("-w " + Math.floor(waittime*1000)); // ms
        }
        args.push(host);
        
    } else if (os == linux || os == darwin || os == android) {
        cmd = "traceroute";
        
        if (maxttl) {
            args.push('-m '+maxttl);
        } else if (os === darwin) { 
            args.push('-m 30'); // limit in anycase, the default is 64(!)
        }

        if (iface!==undefined) {
            if (os == darwin) {
                args.push("-s "+iface); // must be IP
            } else {
                args.push("-i "+iface);
            }
        }

        if (waittime) {
            if (waittime < 1) {
                waittime = 1;
            }
            args.push("-w " + waittime); // s
        }

        if (count) {
            args.push("-q " + count);
        }

        args.push(host);

    } else {
        return callback(error("notsupported", os));
    }

    execcmd(callback, cmd, args, params, inc);
}; // doTraceroute

api.doPing = function(callback, params, inc) {
    var host = (params && params.length>=1 ? params[0] : undefined);
    if (!host) {
        return callback(error("missingparams","host"));
    }

    var opt = (params && params.length==2 ? params[1] : {});
    opt = opt || {};
    var count = opt.count || 5;
    var iface = opt.iface || undefined;
    var interval = opt.interval || undefined;
    var bcast = opt.bcast || false;
    var ttl = opt.ttl || undefined;
    var timeout = opt.timeout || undefined;
    var packetsize = opt.packetsize || undefined;

    var cmd = 'ping';
    var args = [];

    if (os == winnt) {
        args.push("-4");
        args.push("-n " + count);

        if (iface) {
            args.push("-S"); // must be IP address ... -I does not work..
            args.push(iface);
        }
        if (ttl) {
            args.push("-i");
            args.push(ttl);
        } else if (timeout) {
            args.push("-w");
            args.push(timeout*1000);
        }

    } else if (os == linux || os == darwin || os == android) {
        args.push("-c " + count);
        args.push("-n");

        if (iface) {
            if (os == darwin) {
                args.push("-S "+iface); // must be IP address ... -I does not work..
            } else {
                args.push("-I "+iface);
            }   
        }

        if (ttl) {
            if (os == darwin) {
                args.push("-m "+ttl);
            } else {
                args.push("-t "+ttl);
            }
        }

        if (timeout) {
            if (os == darwin)
                timeout = Math.floor(timeout * 1000); // in ms
            args.push("-W " + timeout);
        }

        if (interval) {
            args.push("-i " + interval);
        }

        if (packetsize) {
            args.push("-s " + packetsize);
        }

        if (bcast && (os == android || os == linux)) {
            args.push("-b"); // broadcast ping
        }
    } else {
        return callback(error("notsupported", os));
    }
    args.push(host);        
    execcmd(callback, cmd, args, params, inc);
}; // doPing

api.doPingToHop = function(callback, params, inc) {
    var hop = (params && params.length>=1 ? params[0] : undefined);
    if (hop === undefined) {
        return callback(error("missingparams","hop"));
    } else if (hop === 0) {
        // ping loopback
        params[0] = '127.0.0.1';
        return api.doPing(callback, params, inc);
    }
    // else do the TTL limited ping first, then the real ping to the host at TTL hops away

    var opt = (params && params.length==2 ? params[1] : {});
    opt = opt || {};
    var iface = opt.iface || undefined;
    var timeout = opt.timeout || 5;

    var cmd = 'ping';
    var args = [];

    if (os == winnt) {
        args.push("-4");
        args.push("-n " + 1);
        if (iface) {
            args.push("-S"); // must be IP address ... -I does not work..
            args.push(iface);
        }
        args.push("-i " + hop);

    } else if (os == linux || os == darwin || os == android) {
        args.push("-c " + 1);
        args.push("-n");

        if (iface) {
            if (os == darwin) {
                args.push("-S "+iface); // must be IP address ... -I does not work..
            } else {
                args.push("-I "+iface);
            }   
        }

        if (os == darwin) {
            args.push("-m "+hop);
        } else {
            args.push("-t "+hop);
        }

        if (os == darwin)
            timeout = Math.floor(timeout * 1000); // in ms
        args.push("-W " + timeout);

    } else {
        return callback(error("notsupported", os));
    }
    args.push(config.MSERVER_FR);

    execcmd(function(res, done) {
        if (res.error) 
            return callback(res);
        else if (!res.result || !res.result.time_exceeded_from) {
            return callback(error('ping','No response from hop ' + hop));
        } else {
            params[0] = res.result.time_exceeded_from;
            return api.doPing(callback, params, inc);
        }
    }, cmd, args, params, false);
}; // doPingToHop

api.doIperf = function(callback, params, inc) {
    var host = (params && params.length>=1 ? params[0] : undefined);
    if (!host)
        return callback(error("missingparams","host"));

    var opt = (params && params.length>1 ? params[1] : undefined);
    if (!opt)
        return callback(error("missingparams","options"));

    var cmd = 'iperf';
    var args = [];
    
    // TODO: check if the binary is available

    // udp or tcp
    if (opt.proto==='udp') {
        args.push("-u");
    }

    // FIXME: could allow server mode ?
    if (!opt.server) {
        args.push("-c " + host);
    }

    // server port
    if (opt.port) {
        args.push("-p " + opt.port);
    }

    // client specific
    if (!opt.server) {
        // target bandwidth
        if (opt.proto === 'udp' && opt.bandwidth) {
            args.push("-b " + opt.bandwidth);
        }
        // num bytes to send
        if (opt.num) {
            args.push("-n " + opt.num);
        }
        // read/write buf
        if (opt.len) {
            args.push("-l " + opt.len);
        }
        // time to send
        if (opt.time) {
            args.push("-t " + opt.time);
        }
        // do bidirectional test individually
        if (opt.tradeoff) {
            args.push("-r");
        }
    }

    // reports in csv every 1s
    args.push("-y C -i 1");

    execcmd(callback, cmd, args, params, inc);
}; // doIperf

api.getNameservers = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "netsh";
        args = ["interface","ip","show","dns"];

    } else if (os == linux || os == darwin) {
        cmd = "cat";
        args = ["/etc/resolv.conf"];

    } else if (os == android) {
        cmd = "getprop";
        args = ["net.dns1"];

        var res;

        // store orig callback
        var _cb = callback;
        callback = function(data, done) {
            if (!data.error) {
                res = data;
                var tmp = res.result;
                res.result = { nameservers : [tmp]}; // common format with resolv.conf parsing

                cmd = "getprop";
                args = ["net.dns2"];
                execcmd(function(data2, done2) {
                    if (!data2.error && data2.result) {
                        res.result.nameservers.push(data2.result);
                    }
                    _cb(res, true);
                }, cmd, args, params, false);
            } else {
                // error stop here
                _cb(data,done);
            }
        };
    } else {
        return callback(error("notsupported", os));
    }

    execcmd(callback, cmd, args, params, inc);
}; // getNameservers

api.getHostname = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];

    if (os == linux || os == darwin || os == winnt) {
        cmd = "hostname";
    } else if (os == android) {
        cmd = "getprop";
        args = ["net.hostname"];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getHostname

api.nslookup = function(callback, params, inc) {
    if (!params || params.length !== 1 || params[0] === undefined)
        return callback(error("missingparams","name"));

    var cmd = "nslookup";
    var args = [params[0]];
    execcmd(callback, cmd, args, params, false);
}; // nslookup

api.getInterfaces = function(callback, params, inc) {
    // filter results to active interfaces only ?
    params = params || [false];
    var activeonly = params[0];

    var cmd = undefined;
    var args = [];

    if (os == winnt) {
        cmd = "netsh";
        args = ["interface","ip","show","config"];

    } else if (os == linux) {
        cmd = "ifconfig";
        if (!activeonly)
            args.push('-a');

    } else if (os == darwin) {
        cmd = "ifconfig";
        if (activeonly)
            args.push('-u');

    } else if (os == android) {
        cmd = "ip";
        args = ['-o','addr','show'];
        if (activeonly)
            args.push('up');

        // fallback to 'netcfg' if 'ip' is not available
        var _cb = callback;
        callback = function(data, done) {
            if (data.error && 
                data.stderr.indexOf('not found')>=0) {
                console.info("\'ip\' not available, fallback to netcfg");
                cmd = "netcfg";
                args = [];
                execcmd(_cb, cmd, args, params, false);
            } else {
                _cb(data,done);
            }
        };
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, params, false);
};

api.getActiveWifiInterface = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];

    if (os == linux) {
        cmd = "iwconfig";

    } else if (os == darwin) {
        cmd = 'airport';
        args = ["-I"];
        // second call to fill up data
        var _cb = callback;
        callback = function(data, done) {
            if (!data.error) {
                // get the name (and mac) of the wifi interface on OS X
                cmd = "networksetup";
                args = ["-listallhardwareports"];       
                execcmd(function(data2, done) {
                    if (!data2.error) {
                        let tmp = _.find(data2.result, function(iface) { return iface.type === 'wi-fi'; });
                        data.result.name = tmp.name;
                        data.result.mac = tmp.mac;
                    }
                    _cb(data, true);
                }, cmd, args, undefined, false);       
            } else {
                _cb(data, true);
            }
        };

    } else if (os == android) {
        cmd = "getprop";
        args = ['wifi.interface'];

    } else if (os == winnt) {
        cmd = "netsh";
        args = ['wlan','show','interface'];

    } else {
        return callback(error("notsupported", os));
    }

    execcmd(callback, cmd, args, undefined, false);
};

api.getArpCache = function(callback, params, inc) {
    var hostname = (params && params.length>=1 ? params[0] : undefined);

    var cmd = undefined;
    var args = [];
    if (os == winnt || os == darwin) {
        cmd = "arp";
        if (hostname) {
            args = [hostname];
        } else {
            if (os == winnt)
                args = ["-a"];
            else
                args = ["-a","-n"]; // add n because otherwise it can take forever..
        }
        execcmd(callback, cmd, args, params, false);

    } else if (os == android || os == linux) {
        // check first if 'ip' is available
        cmd = "ip";
        resolvecmd(function(found) {
            if (!found) {
                // fallback to arp
                cmd = "arp";
                if (hostname)
                    args = [hostname];
                else
                    args = ["-a","-n"];
            } else {
                // ip neigh show
                args = ['neigh','show'];
                if (hostname) {
                    args.append('to');
                    args.append(hostname);
                }   
            }
            execcmd(callback, cmd, args, params, false);
        }, cmd);

    } else {
        return callback(error("notsupported", os));
    }
}; // getArpCache

api.getRoutingTable = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "route";
        args = ["-4","print"];  
    } else if (os == linux || os == darwin) {
        cmd = "netstat";
        args = ["-r","-n"];
    } else if (os == android) {
        cmd = "cat";
        args = ["/proc/net/route"];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
};

api.getWifiNetworks = function(callback, params, inc) {
    var timeout = (params && params.length==1 && params[0]!==undefined ? 
                   params[0] : 
                   5000); // ms

    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "netsh";
        args = ["wlan", "show", "networks","bssid"];

    } else if (os == linux) {
        cmd = "iwlist";
        args = ["scan"];

    } else if (os == darwin) {
        cmd = 'airport';
        args = ["-s"];

    } else if (os == android) {
        // wpa_cli is available on some devices, trigger new scan, 
        // then request the list
        cmd = "wpa_cli";
        args = ["scan"];
    } else {
        return callback(error("notsupported", os));
    }      

    function cbk(data, done) {
        if (data && !data.error) {
            if (os == android) {
                // android has a different command to fetch the results
                cmd = "wpa_cli";
                args = ["scan_results"];
            }

            if (timeout>0) {
                // delay timeout ms to get more scanning results
                timers.setTimeout(function() {
                    execcmd(callback, cmd, args, params, false);
                }, timeout);
            } else {
                execcmd(callback, cmd, args, params, false);
            }
        } else {
            // some error on the first call
            callback(data, true);
        }
    }; // cbk
    execcmd(cbk, cmd, args, params, false);
}; // getWifiNetworks

api.getIfaceStats = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "netstat";
        args = ["-e"];
    } else if (os == linux || os == android) {
        cmd = "cat";
        args = ["/proc/net/dev"];
    } else if (os == darwin) {
        cmd = "netstat";
        args = [ '-n','-b','-i'];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getIfaceStats

api.getWifiSignal = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "netsh";
        args = ["wlan", "show", "interface"];

    } else if (os == linux || os == android) {
        cmd = "cat";
        args = ["/proc/net/wireless"];  

    } else if (os == darwin) {
        cmd = 'airport';
        args = ["-I"];  

    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getWifiSignal

api.getLoad = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == linux){
        cmd = "top";
        args = ['-b', '-n 1'];
    } else if (os == darwin) {
        cmd = "top";
        args = ["-l 2", "-n 1"];
    } else if (os == android) {
        cmd = "top";
        args = ['-n 1', '-m 1'];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getLoad

api.getMemInfo = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == linux || os == android) {
        cmd = "cat";
        args = ['/proc/meminfo'];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getMemInfo

api.getSysInfo = function(callback, params, inc) {
    var cmd = undefined;
    var args = [];
    if (os == winnt) {
        cmd = "systeminfo";
        args = [];
    } else {
        return callback(error("notsupported", os));
    }
    execcmd(callback, cmd, args, undefined, false);
}; // getMemInfo

api.getProxyInfo = function(callback, params, inc) {
    var url = (params && params.length == 1 ? [params[0]] : undefined);
    if (!url)
        return callback(error("missingparams","url"));

    var protocolProxyService = 
    Cc["@mozilla.org/network/protocol-proxy-service;1"]
    .getService(Ci.nsIProtocolProxyService);
    var ioService = Cc["@mozilla.org/network/io-service;1"]
    .getService(Ci.nsIIOService);

    try {
        var uri = ioService.newURI(url, null, null);
    } catch (e) {
        return callback(error("invalidparams", "invalid url: " + url));
    }

    var _cb = {
        onProxyAvailable : function(aRequest,aURI,aProxyInfo,aStatus) {
            var res = {
                ts : Date.now(),
                os : os,
                result: aProxyInfo, 
            };
            callback(res, true);
        }
    };
    protocolProxyService.asyncResolve(uri, 0, _cb);
}; // getProxyInfo

api.getBrowserMemoryUsage = function(callback, params, inc) {
    if (os == darwin) {
        // due to bug this will eradically crash FF on os x, fix coming in FF38, see:
        // https://bugzilla.mozilla.org/show_bug.cgi?id=1122322
        callback(error('notsupported', os));
        return;
    }

    var MemoryReporterManager = Cc["@mozilla.org/memory-reporter-manager;1"]
    .getService(Ci.nsIMemoryReporterManager);

    // Source : https://github.com/nmaier/about-addons-memory 
    if ("nsIMemoryMultiReporter" in Ci) {
        let e = MemoryReporterManager.enumerateReporters();
        while (e.hasMoreElements()) {
            let r = e.getNext();
            if (r instanceof Ci.nsIMemoryReporter && r.path === 'resident') {
                var res = {
                    ts : Date.now(),
                    os : os,
                    cmd : 'nsIMemoryMultiReporter.Reporters',
                    result: {
                        mem : r.amount,
                        unit: 'B'
                    }
                };
                return callback(res, true);
            }
        }

        e = MemoryReporterManager.enumerateMultiReporters();
        let handle = function(process, path, kind, units, amount, description) {
            if (path === 'resident') {
                var res = {
                    ts : Date.now(),
                    os : os,
                    cmd : 'nsIMemoryMultiReporter.MultiReporters',
                    result: {
                        mem : amount,
                        unit: 'B'
                    }
                };
                callback(res, true);        
            } else {
                loop();
            }
        };
        let loop = function() {
            if (e.hasMoreElements()) {
                let r = e.getNext();
                if (r instanceof Ci.nsIMemoryMultiReporter) {
                    r.collectReports(handle, undefined);
                } else {
                    loop();
                }
            } else {
                callback(error("internal","failed to get browser memory"));
            }
        }
        loop();

    } else if ("enumerateReporters" in MemoryReporterManager) {
        let e = MemoryReporterManager.enumerateReporters();
        let handle = function(process, path, kind, units, amount, description) {
            if (path === 'resident') {
                var res = {
                    ts : Date.now(),
                    os : os,
                    cmd : 'MemoryReporterManager.enumerateReporters',
                    result: {
                        mem : amount,
                        unit: 'B'
                    }
                };
                callback(res, true);
            } else {
                loop();
            }
        };

        let loop = function() {
            if (e.hasMoreElements()) {
                let r = e.getNext();
                if (r instanceof Ci.nsIMemoryMultiReporter) {
                    r.collectReports(handle, undefined);
                } else {
                    loop();
                }
            } else {
                callback(error("internal","failed to get browser memory"));
            }
        }
        loop();

    } else {
        let done = false;
        let handle = function(process, path, kind, units, amount, description) {
            if (path === 'resident') {
                var res = {
                    ts : Date.now(),
                    os : os,
                    cmd : 'getReports',
                    result: {
                        mem : amount,
                        unit: 'B'
                    }
                };
                callback(res, true);
                done = true;
            }       
        };

        let end = function() {
            if (!done)
                callback(error("internal","failed to get browser memory"));
        }

        if (MemoryReporterManager.getReports.length == 5) {
            MemoryReporterManager.getReports(handle, null, end, null, false);
        } else {
            MemoryReporterManager.getReports(handle, null, end, null);
        }
    }
};
