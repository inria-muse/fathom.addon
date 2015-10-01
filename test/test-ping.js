var socketapi = require("../lib/socketapi");
socketapi.start();

var manifest = {
    api : {"tools" : "*"},
    allowdst : {
	"*" : {"127.0.0.1" : { 5700 : true }},
    },
    neighbors : {},
    isaddonpage : false,
    origin : "localhost",
};

exports["test1 nspr ping invalid proto"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'tools', 
		 submodule : 'ping', 
		 winid : 1,
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };
    socketapi.exec(function(s) {
	assert.ok(s.error !== undefined, 
		  "tools.ping.start server invalid proto");
	done();
    }, getreq('start',[{proto : 'asd'}],true),manifest);
};

exports["test2 nspr ping"] = function(assert, done) {
    var reqid = 0;
    var getreq = function(method, params, cont) {
	reqid += 1;	
	cont = (cont !== undefined ? cont : false);
	return { module : 'tools', 
		 submodule : 'ping', 
		 winid : 1,
		 id : reqid,
		 multiresp : cont, // multiresponse request
		 method : method, 
		 params : params};
    };

    var first = true;
    socketapi.exec(function(s) {
	assert.ok(s.error === undefined, 
		  "tools.ping.start server no error");

	socketapi.exec(function(c) { // start client
	    if (first) {
		assert.ok(c.error === undefined, 
			  "tools.ping.start client no error");
		first = false;
	    } else {
		assert.ok(c.error === undefined, 
			  "tools.ping.start client final report has no error");

		assert.ok(c.stats.packets.sent === 3, 
			  "tools.ping.start client sent right num of pings");

		assert.ok(c.stats.packets.lost === 0, 
			  "tools.ping.start client received right num of resp ");

		socketapi.exec(function(ss) {
		    assert.ok(ss.error === undefined, 
			      "tools.ping.stop server no error");
		    done();
		}, getreq('stop',[s]),manifest);
	    }

	}, getreq('start', [{client : '127.0.0.1', port : 5700, proto : 'udp', count : 3}], true), manifest);

    }, getreq('start', [{port : 5700, proto : 'udp'}], true) ,manifest);
};


require("sdk/test").run(exports);

