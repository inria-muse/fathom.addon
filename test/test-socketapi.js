var timers = require('sdk/timers');
var socketapi = require("../lib/socketapi");

var manifest = {
    api : {"socket" : "*"},
    allowdst : {
	"*" : {"127.0.0.1" : { 9797 : true },
	       "{server}" : { '*' : true }},
    },
    neighbors : {},
    isaddonpage : false,
    winid : 'test'
};

exports["testunknown"] = function(assert, done) {
    socketapi.exec(function(res) {
	assert.ok(res.error !== undefined, "unknown method returns error");
	done();
    }, { method : 'asd'}, manifest);
};

exports["testudp"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'socket', 
		 submodule : 'udp', 
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };

    var cli = function() {
	socketapi.exec(function(s) {
	    assert.ok(s.error === undefined, 
		      "client socket.udp.openSocket no error");

	    socketapi.exec(function(res) {
		assert.ok(res.error === undefined, 
			  "client socket.udp.udpConnect no error");

		socketapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "client socket.udp.send no error");

		    socketapi.exec(function(res) {
			assert.ok(res.error === undefined, 
				  "client socket.udp.recv no error");
			
			assert.ok(res && res.data === "foo", 
				  "client socket.udp.recv got pong");

			socketapi.exec(function() {}, getreq('close',[s]));

		    },getreq('recv',[s,true,2000]),manifest);
		},getreq('send',[s,"foo"]),manifest);		
	    }, getreq('udpConnect',[s, "127.0.0.1", 9797]),manifest);
	}, getreq('udpOpen',[]),manifest);	
    };

    // start server
    socketapi.exec(function(s) {
	assert.ok(s.error === undefined, 
		  "server socket.udp.openSocket no error");

	var stimer = undefined;
	var serverclose = function(ok) {
	    if (stimer)
		timers.clearTimeout(stimer);
	    stimer = undefined;
	    socketapi.exec(function(res) {
		socketapi.exec(function() {}, getreq('close',[s]));
		done();	
	    }, getreq('udpRecvStop',[s]),manifest);
	};
	stimer = timers.setTimeout(serverclose, 5000);

	socketapi.exec(function(res) {
	    assert.ok(res.error === undefined, 
		      "server socket.udp.udpBind no error");

	    // start client side and listen for responses
	    timers.setTimeout(cli,0);

	    socketapi.exec(function(res) {
		assert.ok((res.error === undefined), 
			  "server socket.udp.udpRecvFromStart no error");
		
		if (res.data && res.data === "foo") { // got ping - send pong
		    assert.ok(true, 
			      "server socket.udp.udpRecvFromStart got ping");

		    // add the host to the server list so that we can send
		    // data back
		    manifest.neighbors['server'] = {};
		    manifest.neighbors['server'][res.address] = true;

		    socketapi.exec(function(res) {
			assert.ok(res.error === undefined, 
				  "server socket.udp.udpSendTo no error");

		    },getreq('udpSendTo',[s,res.data,res.address,res.port]),manifest);
		}

	    }, getreq('udpRecvFromStart', [s, true], true),manifest);
	}, getreq('udpBind',[s, 0, 9797, true]),manifest);
    }, getreq('udpOpen',[]),manifest);
};

require("sdk/test").run(exports);
