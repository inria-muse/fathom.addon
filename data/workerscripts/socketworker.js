/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
   */

/**
 * @fileoverfiew The main socket ChromeWorker script.
 *
 * Each socket worker handles a single socket in a separate ChromeWorker 
 * thread.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

//--------- GLOBAL FUNCS ---------

importScripts("./debug.js");
var tag = 'socket';

// create new ctypes buffer of size
var newBuffer = function(size) {
  return ctypes.unsigned_char.array(size)();
}

// create new ctypes buffer from a string
var newBufferFromString = function(str) {
  return ctypes.unsigned_char.array()(str);
}

// default implementation (SLOW!!) - overriden with NSPR.PR_Now below.
var gettime = function() {
    return (new Date()).getTime();
};

// time since epoch in ms
var gettimets = function() {
    return (new Date()).getTime();
};

//--------- GLOBAL FUNCS END ---------

// namespace objects populated by other importedScripts
var NSPR = {};   // NSPR API wrapper
var socket = {}; // fathom.socket.*
var tools = {};  // fathom.tools.*

// 'this' worker state
var worker = {
    id : -1,
    nsprpath : undefined,
    nsprname : undefined,
    os : undefined,
    socket : undefined,
    buf : undefined,
    buflen : undefined,
    multirespstop : false,
};

var getBuffer = function(len) {
    if (!worker.buf || worker.buflen < len) {
        dump('create buffer size='+len+'B\n');
        worker.buf = newBuffer(len);
        worker.buflen = len;
    }
    return worker.buf;
};

var cleanup = function() {
    if (worker.socket && worker.socket !== -1) {
        NSPR.sockets.PR_Close(worker.socket);
    }
    worker.socket = undefined;
    if (NSPR.closeLib)
        NSPR.closeLib();
    NSPR = {}    
    close();
};

var sendres = function(id) {
    return function(err, data, done) {
        if (err)
            debug(tag, "sendres error: " + JSON.stringify(err));
        
        var res = {
            workerid : worker.id, // this worker id
            id : id,      // unique request id
            data : data,  // data object or undefined if err
            error : err,  // err or undefined if ok
            done : done   // request done ? 
        };
        postMessage(JSON.stringify(res));
    };
};

// handle messages from the addon
onmessage = function(event) {
    if (!event.data) {
        error(tag,"got empty message");
        return;
    }

    var msg = JSON.parse(event.data);
    if (!msg || !msg.method) {
        error(tag,"got invalid message: " + event.data);
        return;
    }

    var api = socket;
    if (msg.module === 'tools')
        api = tools;

    if (msg.createworker) {     
        // init worker config
        worker.id = msg.workerid;  // just for identifying debugs
        worker.nsprpath = msg.nsprpath;
        worker.nsprname = msg.nsprname;
        worker.os = msg.os;
        debug(tag, "createworker " + worker.id);

        // load helper scripts
        try {
            // NSPR methods, exported to NSPR.*, used by all other scripts
            importScripts("./nspr.js");

            // high-res timer
            gettime = function() { return NSPR.util.PR_Now()/1000.0; };

            // Socket methods, exported to socket.*
            importScripts("./socket.js");
            importScripts("./broadcast.js");
            importScripts("./multicast.js");
            importScripts("./tcp.js");
            importScripts("./udp.js");      

            if (msg.module === 'tools') {
                // Tools, exported to tools.*, depend on the above
                importScripts("./ping.js");
                importScripts("./Long.js");
                importScripts("./iperf.js");
            }

        } catch (e) {
            error(tag,"importScripts fails: "+e);
            sendres(msg.id)("internal error", undefined, true);
            return;
        }

        if (api[msg.method] && 
            typeof api[msg.method] === 'function') {
                // open a new socket
            var s = api[msg.method].apply(null, msg.params);
            if (s.error) {
                sendres(msg.id)(
                    "Failed to open socket: " + s.error,
                    undefined,
                    true);
                setTimeout(function() { cleanup(); },0); // kill the worker too

            } else {
                // ok
                worker.socket = s;
                sendres(msg.id)(undefined, {}, true);
            }

        } else if (api[msg.submodule][msg.method] && 
                   typeof api[msg.submodule][msg.method] === 'function') {
            // start ping or iperf
            var args = [sendres(msg.id)].concat(msg.params);
            var s = api[msg.submodule][msg.method].apply(null, args);
            if (s.error) {
                sendres(msg.id)(
                    "Failed to start: " + s.error,
                    undefined,
                    true);
                setTimeout(function() { cleanup(); },0); // kill the worker too
            } else {
                // started ok
                worker.socket = s;
                sendres(msg.id)(undefined, {}, false); // started
            }
        } else {
            sendres(msg.id)("No such method: "+ 
                msg.module + "." + 
                (msg.submodule ? msg.submodule + "." : "") +
                msg.method,
                undefined,
                true);
        }

    } else if (msg.method === 'close') {
        cleanup();

    } else if (api[msg.method] && 
               typeof api[msg.method] === 'function') {

        if (!worker.socket) {
            sendres(msg.id)("Socket not open", undefined, true);
            return;
        }

        if (msg.multiresp) {
            // multiresponse request, add callback as first param
            var args = [sendres(msg.id), worker.socket].concat(msg.params);
            var r = api[msg.method].apply(null, args);
            sendres(msg.id)(undefined, r, false);
        } else {
            // single response-request, blocks and returns result
            var args = [worker.socket].concat(msg.params);
            var r = api[msg.method].apply(null, args);
            sendres(msg.id)(undefined, r, true);
        }

    } else if (api[msg.submodule][msg.method] && 
               typeof api[msg.submodule][msg.method] === 'function') {

        if (!worker.socket) {
            sendres(msg.id)("Socket not open", undefined, true);
            return;
        }

        if (msg.multiresp) {
            // multiresponse request, add callback as first param
            var args = [sendres(msg.id), worker.socket].concat(msg.params);
            var r = api[msg.submodule][msg.method].apply(null, args);
            sendres(msg.id)(undefined, r, false);
        } else {
            // single response-request, blocks and returns result
            var args = [worker.socket].concat(msg.params);
            var r = api[msg.submodule][msg.method].apply(null, args);
            sendres(msg.id)(undefined, r, true);
        }

    } else {
        sendres(msg.id)("No such method: " + 
            msg.module + "." + 
            (msg.submodule ? msg.submodule + "." : "") + 
            msg.method, 
            undefined, true);
    }
};

// fatal errors
onerror = function(event) { 
    dump("error: fathom: ChromeWorker [socketworker]: " + 
       JSON.stringify(event) + "\n");
    postMessage(JSON.stringify({error : event, done : true}));
    cleanup();
};