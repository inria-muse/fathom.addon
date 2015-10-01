const config = require("../lib/config");
const systemapi = require("../lib/systemapi");
const system = require("sdk/system");
const _ = require('underscore');

systemapi.setup();

exports["testerror"] = function(assert, done) {
	systemapi.exec(function(res) {
		assert.ok(res.error !== undefined, 
			"unknown method returns error");
		assert.ok(res.error.type === "nosuchmethod", 
			"unknown method returns correct error");
		done();
	}, { method : 'foo'});
};

exports["testpingtr"] = function(assert, done) {
	systemapi.exec(function(res, doneflag) {
		console.log("test doPingTr",res);
		assert.ok(!res.error, "doPingTr no error");
		assert.ok(res.result.length > 0, "doPingTr hops");
		if (doneflag)
			done();
	}, { method : 'doPingTr', params: ['muse.inria.fr']}, true);
};

exports["testpinglocal"] = function(assert, done) {
	systemapi.exec(function(res, doneflag) {
		console.log("test doPing",res);
		assert.ok(!res.error, "doPing no error");
		assert.ok(res.result.count === 1, "doPing count");
		assert.ok(res.result.rtt.length === 1, "doPing results");
		done();
	}, { method : 'doPing', params: ['localhost', { count : 1 }]});
};

exports["testpingerror"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		assert.ok(res.error, "doPing got error");
		assert.ok(res.error.type === "missingparams", 
			  "doPing got correct error");
		done();
    }, { method : 'doPing', params: []});
};

exports["testpinghop0"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPingToHop",res);
		assert.ok(!res.error, "doPingToHop no error");
		if (res.result) {
			assert.ok(res.result.count === 1, "doPingToHop count");
			assert.ok(res.result.rtt.length === 1, "doPingToHop results");
		}
		done();
    }, { method : 'doPingToHop', params: [0, { count : 1 }]});
};

exports["testpinghop1"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPingToHop",res);
		assert.ok(!res.error, "doPingToHop no error");
		if (res.result) {
			assert.ok(res.result.count === 1, "doPingToHop count");
			assert.ok(res.result.rtt.length === 1, "doPingToHop results");
		}
		done();
    }, { method : 'doPingToHop', params: [1, { count : 1 }]});
};

exports["testpingcont"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPing",res);
		assert.ok(!res.error, "doPing no error");
		assert.ok(res.result.count === 10, "doPing count");
		if (!doneflag)
		    assert.ok(res.result.rtt.length > 0, "doPing results");
		if (doneflag)
		    done();
    }, { method : 'doPing', multiresp : true, params: ['localhost', { count : 10 }]});
};

exports["testpingbcast"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPing",res);
		assert.ok(!res.error, "doPing no error");
		if (doneflag)
		    done();
    }, { method : 'doPing', 
	 params: ['192.168.1.255',{ count : 2, interval : 1, bcast : true }]});
};

exports["testpingttl1"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPing with ttl",res);
		assert.ok(!res.error, "doPing no error");
		assert.ok(res.result.count === 1, "doPing count == 1");
		assert.ok(res.result.time_exceeded_from, 
			  "doPing got time exceeded from " + 
			  res.result.time_exceeded_from);
		done();
    }, { method : 'doPing', params: [config.MSERVER_FR, 
				     { count : 1, ttl : 1, timeout : 1}]});
};

exports["testpingttl3"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doPing with ttl",res);
		assert.ok(!res.error, "doPing no error");
		assert.ok(res.result.count === 1, "doPing count == 1");
		assert.ok(res.result.time_exceeded_from, 
				  "doPing got time exceeded from " + 
				  res.result.time_exceeded_from);
		done();
    }, { method : 'doPing', params: [config.MSERVER_FR, 
				     { count : 1, ttl : 3, timeout : 1}]});
};

exports["testtraceroutelocal"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doTraceroute",res);
		assert.ok(!res.error, "doTraceroute no error");
		assert.ok(res.result.hops[0], "doTraceroute got results");
		assert.ok(res.result.hops[0].address == '127.0.0.1', 
			  "doTraceroute results valid");
		done();
    }, { method : 'doTraceroute', params: ['localhost']});
};

exports["testtraceroutelong"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log("test doTraceroute",res);
		assert.ok(!res.error, "doTraceroute no error");
		if (res.result) {
			assert.ok(res.result.hops.length>0, "doTraceroute got results");
		}
		done();
    }, { method : 'doTraceroute', params: ['www.google.com', {
		count : 1, waittime : 1, maxttl : 20
    }]});
};

exports["testgetos"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		assert.ok(res === require('sdk/system').platform, 
			  "getOS: " + res);
		done();
    }, { method : 'getOS', params: []});
};

exports["testgethostname"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error && res.result, "getHostname: " + res.result);
		done();
    }, { method : 'getHostname'});
};

exports["testgetarp"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "getArp no error");
		done();
    }, { method : 'getArpCache'});
};

exports["testnslookup"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "nslookup no error");
		done();
    }, { method : 'nslookup', params : ['muse.inria.fr']});
};

exports["testgetroute"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "getRoutingTable no error");
		assert.ok(!_.isEmpty(res.result.routes), "getRoutingTable has results");
		assert.ok(_.find(res.result.routes, function(r) { return r.defaultroute;}), "getRoutingTable finds defaultroute(s)");
		assert.ok(res.result.defaultgateway, "getRoutingTable finds defaultgateway");
		done();
    }, { method : 'getRoutingTable'});
};

exports["testgetns"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "getNameservers no error");
		assert.ok(res.result.nameservers.length > 0, "getNameservers got results");
		done();
    }, { method : 'getNameservers'});
};

exports["testgetifacesact"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "getActiveInterfaces no error");
		assert.ok(res.result.length>0, "getActiveInterfaces found some interfaces");
		done();
    }, { method : 'getInterfaces', params : [true]});
};

exports["testgetifacesall"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "getInterfaces no error");
		assert.ok(res.result.length>0, "getInterfaces found some interfaces");
		done();
    }, { method : 'getInterfaces'});
};

exports["testifacestats"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		assert.ok(!res.error, "getIfaceStats no error");
		assert.ok(_.keys(res.result).length>0, "getIfaceStats found some interfaces");
		done();
    }, { method : 'getIfaceStats'});
};

exports["testgetwifi"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		if (!res.error && res.result.bssid) {
		    assert.ok(res.result.bssid,"getWifiInterface bssid " + res.result.bssid);
		    
		    systemapi.exec(function(res2, doneflag) {
				console.log(res2);
				assert.ok(!res2.error, "getWifiSignal no error");
				if (system.platform !== 'winnt')
					assert.ok(res2.result.signal,"getWifiSignal " + res2.result.signal);
				else
					assert.ok(res2.result.quality,"getWifiSignal " + res2.result.quality);

				systemapi.exec(function(res3, doneflag) {
				    console.log(res3);
				    assert.ok(!res3.error, "getWifiNetworks no error");
				    assert.ok(res3.result.length > 0,"getWifiNetworks found networks");
				    done();				    
				}, { method : 'getWifiNetworks'});			
		    }, { method : 'getWifiSignal'});		    
		} else {
		    assert.ok(res!==undefined, "getWifiInterface no wifi or offline");
		    done();
		}
    }, { method : 'getWifiInterface'});
};

exports["testmem"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		if (system.platform !== 'darwin') {
		    assert.ok(!res.error && res.result.memfree > 0, "getMemInfo");
		} else {
		    assert.ok(res.error, "getMemInfo not avail (expected)");
		}
		done();
    }, { method : 'getMemInfo'});
};

exports["testload"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		if (system.platform !== 'winnt') 
			assert.ok(!res.error, "getLoad no error");
		else
			assert.ok(res.error, "getLoad not avail on winnt error");

		if (system.platform !== 'winnt') 
			assert.ok(res.result.tasks.total > 0, "getLoad found tasks");
		if (system.platform !== 'winnt') 
			assert.ok(res.result.loadavg.onemin > 0, "getLoad found loadavg");
		if (system.platform !== 'winnt') 
			assert.ok(res.result.cpu.user > 0, "getLoad found cpu");
		if (system.platform !== 'winnt') 
			assert.ok(res.result.memory.total > 0, "getLoad found memory");
		done();
    }, { method : 'getLoad'});
};

exports["testbmem"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(JSON.stringify(res,null,4));
		if (system.platform === 'darwin') {
			assert.ok(res.error, "getBrowserMemoryUsage fails on darwin (expected)");
		} else {
			assert.ok(!res.error, "getBrowserMemoryUsage no error");
			assert.ok(res.result.mem > 0, "getBrowserMemoryUsage got result");
		}
		done();
    }, { method : 'getBrowserMemoryUsage'});
};

exports["testproxy"] = function(assert, done) {
    systemapi.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "getProxy no error");
		done();
    }, { method : 'getProxyInfo', params : [config.API_URL]});
};

exports["testgetcerterror"] = function(assert, done) {
    systemapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error !== undefined, "getcert error missing uri");
		done();
    }, { method : 'getCertChain',
	 params : []});
};

exports["testgetcertsucc"] = function(assert, done) {
    systemapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "getcert no error");
		assert.ok(res.result !== undefined, "getcert got results");
		done();
    }, { 
    	method : 'getCertChain',
	 	params : ["https://muse.inria.fr"]
	});
};

exports["testresolveurl"] = function(assert, done) {
    systemapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "resolveUrl no error");
		assert.ok(res.result.answers && res.result.answers.length >= 1, 
			  "resolveUrl found ip(s)");
		done();
    }, { 
    	method : 'resolveUrl',
	 	params : ['http://www.google.com']
	});
};

exports["testresolvehostname"] = function(assert, done) {
    systemapi.exec(function(res) {
		console.log(res);
		assert.ok(res.error === undefined, "resolveHostname no error");	
		assert.ok(res.result.answers && res.result.answers.length == 1 &&
			  res.result.answers[0] === '128.93.165.1', 
			  "resolveHostname found correct ip");
		done();
    }, { method : 'resolveHostname',
	 params : ['muse.inria.fr']});
};

exports["testpromise"] = function(assert, done) {
    const { all } = require('sdk/core/promise');
    all([
		systemapi.execp({ method : 'getBrowserMemoryUsage'}),
		systemapi.execp({ method : 'getLoad'}),
		systemapi.execp({ method : 'getNameservers'}),
    ]).then(function(results) {
		// success function
		console.log(JSON.stringify(results, null, 4));
		assert.ok(results.length == 3, "got all results");
		done();
	}, function (reason) {
		assert.ok(reason, "error " + reason);
		done();
    });
};

require("sdk/test").run(exports);

