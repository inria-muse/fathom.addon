var tools = require("../lib/toolsapi");
require('../lib/systemapi').setup();

var manifest = {
    isaddon : true,
    winid : 'test',
    neighbors : {}
};

exports["testisconnected"] = function(assert, done) {
    tools.exec(function(res) {
		assert.ok(res, 'connected');
		done();
    }, { method : 'isConnected'});
};

exports["testdnslookup1"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(!res.error, "dnsLookup no error");
		assert.ok(res.answers && res.answers.length == 1 &&
				  res.answers[0] === '128.93.165.1', 
				  "dnsLookup found correct ip");		
		done();
    }, { method : 'dnsLookup', params : ['muse.inria.fr']});
};

exports["testdnslookup2"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(!res.error, "dnsLookup no error");
		assert.ok(res.answers && res.answers.length == 1 &&
				  res.answers[0] === '128.93.165.1', 
				  "dnsLookup found correct ip");		
		done();
    }, { method : 'dnsLookup', params : ['muse.inria.fr', '208.67.222.222']});
};

exports["testdnslookup3"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(!res.error, "dnsLookup no error");
		assert.ok(res.answers && res.answers.length == 1 &&
				  res.answers[0] === '128.93.165.1', 
				  "dnsLookup found correct ip");		
		done();
    }, { method : 'dnsLookup', params : ['muse.inria.fr', '8.8.8.8']});
};


exports["testdnslookup4"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(res);
		assert.ok(res.error, "dnsLookup error");
		done();
    }, { method : 'dnsLookup', params : ['muse.inria.fr', '1.2.3.4']});
};

exports["testlookupmyip"] = function(assert, done) {
    tools.exec(function(res) {
		console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "lookupIP no error");
		assert.ok(res.ip, "lookupIP returns " + res.ip);
		done();
    }, { method : 'lookupIP'});
};

exports["testlookupmac"] = function(assert, done) {
    tools.exec(function(res) {
        console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "lookupMAC no error");
		assert.ok(res.result && res.result.company === "Apple", "lookupMAC ok");
		done();
    }, { method : 'lookupMAC', params: ['54:26:96:ce:3d:89']});
};

exports["testdisclocal"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
	    assert.ok(res.type === 'local', "got correct node type");	
		if (dflag) done();
    }, { method : 'discovery',
	 params : [['local']]});
};

exports["testdiscinternet"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
	    assert.ok(res.type === 'internet', "got correct node type");	
		if (dflag) done();
    }, { method : 'discovery',
	 params : [['internet']]});
};

exports["testdiscroute"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
	    assert.ok(res.type === 'gw', "got correct node type");	
		if (dflag) done();
    }, { method : 'discovery',
	 params : [['route']]}, {neighbors : {}});
};

exports["testdiscmdns"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (res)
		    assert.ok(res.raw['mdns'], "correct raw results");	
		else
		    assert.ok(dflag, "last node is null");	

		if (dflag) done();
    }, { method : 'discovery',
	 params : [['mdns']]}, {neighbors : {}});
};

exports["testdiscupnp"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (res)
		    assert.ok(res.raw['upnp'], "correct raw results");	
		else
		    assert.ok(dflag, "last node is null");	

		if (dflag) done();
    }, { method : 'discovery',
	 params : [['upnp']]}, {neighbors : {}});
};

exports["testdiscping"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (res)
		    assert.ok(res.raw['ping'], "correct raw results");	
		else
		    assert.ok(dflag, "last node is null");	

		if (dflag) done();
    }, { method : 'discovery',
	 params : [['ping'],5]}, {neighbors : {}});
};

exports["testdiscarptable"] = function(assert, done) {
    tools.exec(function(res,dflag) {
		console.log(res);
		if (res)
		    assert.ok(res.raw['arptable'], "correct raw results");	
		if (dflag) done();
    }, { method : 'discovery',
	 params : [['arptable']]}, {neighbors : {}});
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
