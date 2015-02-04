const subprocess = require("subprocess");
var timers = require('sdk/timers');

var socketapi = require("./socketapi");
socketapi.start();

var manifest = {
    api : {"tools" : "*"},
    allowdst : {
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
	arguments:   ['-s','-u','-p 5701'],
      	stdout: console.log,
	stderr: console.error,
	mergeStderr: false
    });

    var args = {
	client : '127.0.0.1', 
	port : 5701, 
	proto : 'udp',
	bandwidth : '1m',
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
	    assert.ok(c.snd_rcv_total.dgramCnt === c.snd_total.dgramCnt, 
		      "tools.iperf.start client no packets lost");

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
	proto : 'udp',
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
	    arguments:   ['-u','-c','127.0.0.1','-p 5702','-t 3','-b 1m'],
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
	proto : 'udp',
    };

    var cliargs = {
	client : '127.0.0.1', 
	port : 5703, 
	proto : 'udp',
	bandwidth : '1m',
	time: 3
    };

    var sfirst = true;
    var ss = undefined;
    socketapi.exec(function(s) {
	if (!sfirst)
	    return;

	sfirst = false;
	ss = s;
	assert.ok(s.error === undefined, 
		  "tools.iperf.start server no error");


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
		assert.ok(c.snd_rcv_total.dgramCnt+1 === c.snd_total.dgramCnt, 
			  "tools.iperf.start client no packets lost");

		socketapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "tools.iperf.stop server no error");
		    done();

		}, getreq('stop', [ss], false), manifest); // server
	    }	
	}, getreq('start', [cliargs], true), manifest); // client
    }, getreq('start', [sargs], true), manifest); // server
};

require("sdk/test").run(exports);

