var tools = require("./toolsapi");

var manifest = {
    isaddon : true,
    winid : 'test',
    neighbors : {}
};

exports["testlookupmyip"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(!res.error, "lookupIP no error");
		assert.ok(res.ip, "lookupIP returns " + res.ip);
		done();
    }, { method : 'lookupIP'});
};

exports["testlookupmac"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(!res.error, "lookupMAC no error");
		assert.ok(res.company === "Apple", "lookupMAC ok");
		done();
    }, { method : 'lookupMAC', params: ['54:26:96:ce:3d:89']});
};

exports["testgetcerterror"] = function(assert, done) {
    tools.exec(function(res) {
		assert.ok(res.error !== undefined, "getcert error missing uri");
		console.log(res);
		done();
    }, { method : 'getCertChain',
	 params : [undefined]});
};

exports["testgetcert"] = function(assert, done) {
    tools.exec(function(res) {
		assert.ok(res.error === undefined, "getcert no error");
		console.log(res);
		done();
    }, { 
    	method : 'getCertChain',
	 	params : ["https://muse.inria.fr"]
	});
};

exports["testlookupurl"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "lookupUrl no error");
		assert.ok(res.answers && res.answers.length >= 1, 
			  "lookupUrl found ip(s)");
		done();
    }, { 
    	method : 'lookupUrl',
	 	params : ['http://www.google.com']
	});
};

exports["testlookuphostname"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "lookupHostname no error");	
		assert.ok(res.answers && res.answers.length == 1 &&
			  res.answers[0] === '128.93.165.1', 
			  "lookupHostname found correct ip");
		done();
    }, { method : 'lookupHostname',
	 params : ['muse.inria.fr']});
};

exports["testgetdesc"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "getDesc no error");	
		done();
    }, { method : 'getDesc',
	 params : []});
};

exports["testdisclocal"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.type === 'local', "got correct node type");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['local']]});
};

exports["testdiscinternet"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.type === 'internet', "got correct node type");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['internet']]});
};

exports["testdiscroute"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.type === 'gw', "got correct node type");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['route']]}, {neighbors : {}});
};

exports["testdiscmdns"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.raw['mdns'], "correct raw results");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['mdns']]}, {neighbors : {}});
};

exports["testdiscping"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.raw['ping'], "correct raw results");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['ping']]}, {neighbors : {}});
};

exports["testdiscupnp"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.raw['upnp'], "correct raw results");	
		else
		    done();
    }, { method : 'discovery',
	 params : [5,['upnp']]}, {neighbors : {}});
};

exports["testdiscall"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (!dflag)
		    assert.ok(res.address, "found " + res.address);	
		else
		    done();
    }, { method : 'discovery',
	 params : [10, undefined]}, {neighbors : {}});
};

exports["teststartstop"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "start API no error");
		
		tools.exec(function(res) {
		    console.log(res);
		    assert.ok(res.error === undefined, "stop API no error");	

		    done();

		}, { method : 'stop',
		     submodule : 'remoteapi',

		     params : []}, manifest);
    }, { method : 'start',
	 submodule : 'remoteapi',
	 params : []}, manifest);
};

exports["testfathomdisc"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "start API no error");
		
		tools.exec(function(res,ready) {
		    console.log(res);
		    if (!res.timeout) {
			assert.ok(res.error === undefined, "disc no error");
			assert.ok(res.address !== undefined, "disc new host " + 
				  res.address);
		    } else {
			assert.ok(res.timeout && ready, "timeout and ready");
		    }

		    if (ready) {
			tools.exec(function(res) {
			    console.log(res);
			    assert.ok(res.error === undefined, "stop API no error");
			    done();

			}, { method : 'stop',
			     submodule : 'remoteapi',
			     params : []}, manifest);
		    }
		}, { method : 'discovery',
		     submodule : 'remoteapi',
		     params : []}, manifest);		
    }, { method : 'start',
	 submodule : 'remoteapi',
	 params : []}, manifest);
};

exports["testfathomapierror"] = function(assert, done) {
    tools.exec(function(res) {
	console.log(res);
	assert.ok(res.error === undefined, "start API no error");
	
	tools.exec(function(res,ready) {
	    console.log(res);
	    assert.ok(res.error !== undefined, "makereq expected error");
	    assert.ok(res.error.type === "jsonrpc", 
		      "makereq expected error type");

	    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "stop API no error");
		done();
		
	    }, { method : 'stop',
		 submodule : 'remoteapi',
		 params : []}, manifest);

	}, { method : 'makereq',
	     submodule : 'remoteapi',
	     params : [{address:'127.0.0.1'},'foo']}, manifest);
	
    }, { method : 'start',
	 submodule : 'remoteapi',
	 params : []}, manifest);
};

exports["testfathomapicall"] = function(assert, done) {
    tools.exec(function(res) {
	console.log(res);
	assert.ok(res.error === undefined, "start API no error");
	
	tools.exec(function(res,ready) {
	    console.log(res);
	    assert.ok(res.error === undefined, "makereq no error");
	    assert.ok(res.result === require('sdk/system').platform, 
		      "makereq got expected result");

	    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "stop API no error");
		done();
		
	    }, { method : 'stop',
		 submodule : 'remoteapi',
		 params : []}, manifest);

	}, { method : 'makereq',
	     submodule : 'remoteapi',
	     params : [{address:'127.0.0.1'},'system.getOS']}, manifest);
	
    }, { method : 'start',
	 submodule : 'remoteapi',
	 params : []}, manifest);
};



require("sdk/test").run(exports);
