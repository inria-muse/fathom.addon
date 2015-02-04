const subprocess = require("subprocess");
var timers = require('sdk/timers');

var socketapi = require("./socketapi");
socketapi.start();

var manifest = {
    api : {"tools" : "*"},
    destinations : {
	"*" : {
	    "127.0.0.1" : { 5701 : true,
			    5702 : true,
			    5703 : true }
	}
    },
    neighbors : {},
    isaddonpage : false,
    origin : "localhost",
};

exports["test1 nspriperf to native"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'tools', 
		 submodule : 'iperf', 
		 winid : 1,
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };

    // start native iperf server
    var p = subprocess.call({
	command:     '/usr/bin/iperf',
	arguments:   ['-s','-p 5701'],
      	stdout: console.log,
	stderr: console.error,
	mergeStderr: false
    });

    var args = {
	client : '127.0.0.1', 
	port : 5701, 
	proto : 'tcp',
	time: 3
    };

    var first = true;
    socketapi.exec(function(c) { // start client
	if (first) {
	    assert.ok(c.error === undefined, 
		      "tools.iperf.start client no error");
	    first = false;
	} else {
	    console.log("Interval       Transfer     Bandwidth        Datagrams");
	    console.log(c.snd_total.startTime + "-" +
			c.snd_total.endTime + "\t" + 
			c.snd_total.bytesK + "Kbytes\t"+
			c.snd_total.ratekbit + "Kbit/s\t"+
			c.snd_total.dgramCnt + "");

	    assert.ok(c.error === undefined, 
		      "tools.iperf.start client final report has no error");

	    p.kill(true);
	    timers.setTimeout(done,10);
	}	
    }, getreq('start', [args], true), manifest);
};

exports["test2 native to nspriperf"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'tools', 
		 submodule : 'iperf', 
		 winid : 1,
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };

    var args = {
	port : 5702, 
	proto : 'tcp',
    };

    var first = true;
    var ss = undefined;
    socketapi.exec(function(s) {
	if (!first)
	    return;

	first = false;
	ss = s;
	assert.ok(s.error === undefined, 
		  "tools.iperf.start server no error");

	// native iperf client
	var p = subprocess.call({
	    command:     '/usr/bin/iperf',
	    arguments:   ['-c','127.0.0.1','-p 5702','-t 3'],
      	    stdout: console.log,
	    stderr: console.error,
	    done: function(res) {
		assert.ok(res.exitCode === 0, "client exit success");

		socketapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "tools.iperf.stop server no error");
		    done();

		}, getreq('stop', [ss], false), manifest);
	    },
	    mergeStderr: false
	});
	p.wait();

    }, getreq('start', [args], true), manifest);
};

exports["test3 nspr to nspr"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'tools', 
		 submodule : 'iperf', 
		 winid : 1,
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };

    var sargs = {
	port : 5703, 
	proto : 'tcp',
    };

    var cliargs = {
	client : '127.0.0.1', 
	port : 5703, 
	proto : 'tcp',
	time: 3
    };

    var sfirst = true;
    var ss = undefined;
    socketapi.exec(function(s) {
	if (!sfirst)
	    return;

	assert.ok(s.error === undefined, 
		  "tools.iperf.start server no error");

	sfirst = false;
	ss = s;

	var first = true;
	socketapi.exec(function(c) { // start client
	    if (first) {
		assert.ok(c.error === undefined, 
			  "tools.iperf.start client no error");
		first = false;
	    } else {
		console.log("Interval       Transfer     Bandwidth        Datagrams");
		console.log(c.snd_total.startTime + "-" +
			    c.snd_total.endTime + "\t" + 
			    c.snd_total.bytesK + "Kbytes\t"+
			    c.snd_total.ratekbit + "Kbit/s\t"+
			    c.snd_total.dgramCnt + "");

		assert.ok(c.error === undefined, 
			  "tools.iperf.start client final report has no error");

		socketapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "tools.iperf.stop server no error");

		    timers.setTimeout(done,0);

		}, getreq('stop', [ss], false), manifest); // server
	    }	
	}, getreq('start', [cliargs], true), manifest); // client
    }, getreq('start', [sargs], true), manifest); // server
};

require("sdk/test").run(exports);

