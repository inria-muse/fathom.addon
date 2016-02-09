var socketapi = require("../lib/socketapi");
var protoapi = require("../lib/protoapi");

socketapi.start();
protoapi.start();

var manifest = {
    neighbors : {},
    isaddon : true,
    winid : 'test'
};

exports["testunknown"] = function(assert, done) {
    protoapi.exec(function(res) {
		assert.ok(res.error !== undefined, "unknown method returns error");
		done();
    }, { module : "proto", submodule: "jsonrpc", method : 'asd'}, manifest);
};

exports["testcreatecli"] = function(assert, done) {
    protoapi.exec(function(id) {
		assert.ok(id.error === undefined, "jsonrpc.create no error");
		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, "jsonrpc.close no error");
		    done();
		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'close', 
		     params : [id]}, manifest);
    }, { module : "proto", 
	 submodule: "jsonrpc", 
	 method : 'create', 
	 params : ["127.0.0.1",2343,false,"udp"]}, manifest);
};

exports["testcreateserv"] = function(assert, done) {
    protoapi.exec(function(id) {
		assert.ok(id.error === undefined, "jsonrpc.create no error");
		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, "jsonrpc.close no error");
		    done();
		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'close', 
		     params : [id]}, manifest);
    }, { module : "proto", 
	 submodule: "jsonrpc", 
	 method : 'create', 
	 params : [undefined,2343,true,"udp"]}, manifest);
};

exports["testudp"] = function(assert, done) {
    var docli = function() {
		protoapi.exec(function(id) {
		    assert.ok(id.error === undefined, "jsonrpc.create no error");

		    protoapi.exec(function(res) {
				console.log(res);

				assert.ok(res.error === undefined, "jsonrpc.makereq no error");
				assert.ok(res.result === "pong", "jsonrpc.makereq got pong");

				protoapi.exec(function(res) {
				    assert.ok(res.error === undefined, 
					      "jsonrpc.close no error");
				    done();

				}, { module : "proto", 
				     submodule: "jsonrpc", 
				     method : 'close', 
				     params : [id]}, manifest);

		    }, { module : "proto", 
			 submodule: "jsonrpc", 
			 method : 'makereq', 
			 params : [id,"ping"]}, manifest);

		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'create', 
		     params : ["127.0.0.1",2343,false,"udp"]}, manifest);	

	}; // docli


	// create server
    protoapi.exec(function(id) {
		assert.ok(id.error === undefined, "jsonrpc.create server no error");

		// start listening for requests
		protoapi.exec(function(req) {
		    console.log(req)
		    
		    assert.ok(req.error === undefined, "jsonrpc.listen no error");
		    assert.ok(req.method === "ping", "jsonrpc.listen got ping");

		    req.result = "pong";

		    protoapi.exec(function(res) {
				console.log(res);
				assert.ok(res.error === undefined, "jsonrpc.sendres no error");

				protoapi.exec(function(res) {
				    assert.ok(res.error === undefined, 
					      "jsonrpc.close no error");		    

			}, { module : "proto", 
			     submodule: "jsonrpc", 
			     method : 'close', 
			     params : [id]}, manifest);

		    }, { module : "proto", 
			 submodule: "jsonrpc", 
			 method : 'sendres', 
			 params : [id,req]}, manifest);

		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'listen', 
		     params : [id]}, manifest);

		// make ping
		docli();

    }, { module : "proto", 
	 submodule: "jsonrpc", 
	 method : 'create', 
	 params : [undefined,2343,true,"udp"]}, manifest);
};

exports["testmulticast"] = function(assert, done) {
    var config = require("../lib/config");

    var docli = function() {
	protoapi.exec(function(id) {
	    assert.ok(id.error === undefined, "jsonrpc.create no error");

	    protoapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "jsonrpc.makereq no error");
		assert.ok(res.result === "pong", "jsonrpc.makereq got pong");

		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "jsonrpc.close no error");
		    done();

		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'close', 
		     params : [id]}, manifest);

	    }, { module : "proto", 
		 submodule: "jsonrpc", 
		 method : 'makereq', 
		 params : [id,"ping"]}, manifest);

	}, { module : "proto", 
	     submodule: "jsonrpc", 
	     method : 'create', 
	     params : [config.DISCOVERY_LOCAL_IP,
		       config.DISCOVERY_LOCAL_PORT,
		       false,"multicast"]}, manifest);	
    };

    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "jsonrpc.create no error");

	protoapi.exec(function(req) {
	    console.log(req)
	    assert.ok(req.error === undefined, "jsonrpc.listen no error");
	    assert.ok(req.method === "ping", "jsonrpc.listen got ping");

	    req.result = "pong";

	    protoapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "jsonrpc.sendres no error");

		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "jsonrpc.close no error");		    

		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'close', 
		     params : [id]}, manifest);

	    }, { module : "proto", 
		 submodule: "jsonrpc", 
		 method : 'sendres', 
		 params : [id,req]}, manifest);

	}, { module : "proto", 
	     submodule: "jsonrpc", 
	     method : 'listen', 
	     params : [id]}, manifest);

	docli();
    }, { module : "proto", 
	 submodule: "jsonrpc", 
	 method : 'create', 
	 params : [config.DISCOVERY_LOCAL_IP,
		   config.DISCOVERY_LOCAL_PORT,
		   true,
		   "multicast"]}, manifest);
};


exports["testhttpcli"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "jsonrpc.create no error");	

	protoapi.exec(function(token) {
	    console.log(token);
	    assert.ok(token.error === undefined, "jsonrpc.makereq auth no error");

	    protoapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "jsonrpc.makereq test no error");

		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, "jsonrpc.close no error");
		    done();
		    
		}, { module : "proto", 
		     submodule: "jsonrpc", 
		     method : 'close', 
		     params : [id]}, manifest);
		
	    }, { module : "proto", 
		 submodule: "jsonrpc", 
		 method : 'makereq', 
		 params : [id,
			   "active.heartbeat",
			   [new Date().getTime()],
			   "bismark",
			   {auth:token}
			  ]}, manifest);

	}, { module : "proto", 
	     submodule: "jsonrpc", 
	     method : 'makereq', 
	     params : [id,
		       "login",
		       ["root","passw0rd"],
		       "auth"
		      ]}, manifest);
	
    }, { module : "proto", 
	 submodule: "jsonrpc", 
	 method : 'create', 
	 params : ["192.168.1.1",
		   80,
		   false,
		   "http",
		   "/cgi-bin/luci.dbg/fathom"
		  ]}, manifest);
};

require("sdk/test").run(exports);

