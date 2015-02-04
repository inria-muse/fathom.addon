/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverview Debug my connection script.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

/** Test status (maps to CSS classes used to render the UI). */
const TESTSTATUS = {
    NOT_STARTED : 'test-not-running',
    RUNNING : 'test-running',
    SKIP : 'test-skip',
    SUCCESS : 'test-success',
    ERRORS : 'test-errors',
    FAILURE : 'test-failure'
};

// measurement server IP (hosted server at online.net)
const MSERVER = '62.210.73.169';

// public DNS resolver (google resolver)
const DNSSERVER = '8.8.8.8';

/** Model: single test. */
var Test = Backbone.Model.extend({
    defaults: {
	id: -1,
        status: TESTSTATUS.NOT_STARTED,
	isrunning: false,
	starttime: undefined, // start called
	endtime: undefined,   // succ/fail called
        name: '',             // test name
	shortname: '',
	desc : '',            // short description
	json : undefined      // test results to upload
    },
    initialize: function() {
	_.bindAll(this, 'start', 'end'); 
    },
    start: function(msg) {
	console.log('test start ' + this.get('name'));
	this.set('isrunning',true);
	this.set('desc', msg);
	this.set('starttime', Date.now());
	this.set('status', TESTSTATUS.RUNNING); // triggers view update
    },
    end: function(status, msg, json) {
	console.log('test end ' + this.get('name') + " " + status);
	if (status === TESTSTATUS.SKIP && !this.get('starttime'))
	    this.set('starttime', Date.now());
	this.set('isrunning',false);
	this.set('desc', msg);
	this.set('endtime', Date.now());
	this.set('json', json);
	this.set('status', status); // triggers view update
    }
});

/** Model: collection of tests. */
var Tests = Backbone.Collection.extend({
    model : Test
});

/** Model: single testsuite that consists of a number of tests. */
var TestSuite = Backbone.Model.extend({
    defaults: {
        name: '',           // testsuite name
	shortname: '',
	tests : undefined,  // collection of tests
    },
    initialize: function() {
	this.tests = new Tests();
	_.bindAll(this, 'exec'); 
    },
    exec: function(next, skipall) {
	var that = this;
	
	var loop = function(i, skip, obj) {
	    if (i == that.tests.length) {
		setTimeout(next,0,skip);
		return;
	    }

	    if (skip) {
		that.tests.at(i).end(TESTSTATUS.SKIP,"Not run");
		setTimeout(loop,0,i+1,undefined,skip);
	    } else {
		that.tests.at(i).exec(function(skiprest, res) {
		    // propagate res and skip flag
		    setTimeout(loop,0,i+1,skiprest,res);
		}, obj);
	    }
	};

	console.log("start testsuite " + this.get('name') + " skip="+skipall);
	setTimeout(loop,0,0,skipall,undefined);
    },
    toJSON: function(options) {
	var json = { name : this.get('name') };
	json.tests = this.tests.map(function(model) {
	    return model.toJSON(options);
	});
	return json;
    },
    toUploadJSON: function() {
	var json = { name : this.get('shortname') };
	json.results = this.tests.map(function(model) {
	    return { json : model.get('json'),
		     name : model.get('shortname'),
		     ts : model.get('starttime'),
		     d : model.get('endtime')-model.get('starttime'),
		     status : model.get('status') };
	});
	return json;
    }
});

/** Model: collection of test suites. */
var TestSuites = Backbone.Collection.extend({
    model: TestSuite,
    initialize: function() {
	_.bindAll(this,'exec'); 
    },
    exec: function(cb) {
	var that = this;
	var loop = function(i,skip) {
	    if (that.length === i) {
		return cb(that.toJSON());
	    }

	    that.at(i).exec(function(skiprest) {
		setTimeout(loop,0,i+1,skiprest);
	    }, skip);
	};
	setTimeout(loop,0,0,false);
    },
    toJSON: function(options) {
	return {
	    testsuites : this.map(function(model) {
                return model.toJSON(options);
	    })
        };
    },
    toUploadJSON: function() {
	return this.map(function(model) { 
	    var o = model.toUploadJSON();
	    return o;
	});
    }
});

/**
 * Create a new collection of testsuites.
 */
var create_testsuite = function(req) {
    // globally unique test id
    var testidx = 1;
    var addtest = function(suite, t) {
	t.set("id", testidx);
	_.bind(t.exec, t);
	suite.tests.add(t);
	testidx += 1;
    };

    // new testsuite collection
    var testsuites = new TestSuites();

    var testsuite1 = new TestSuite({
	name:"General Connectivity Tests",
	shortname:'connectivity'
    });

    var conntest1 = new Test({
	name: "Network interface availability",
	shortname: 'conn1',
	desc: "Check if there are network interfaces available"
    });
    conntest1.exec = function(next) {
	var that = this;
	that.start("Checking available network interfaces...");
	fathom.system.getActiveInterfaces(function(res) {
	    if (res.error || !res.result || _.isEmpty(res.result)) {
		that.end(TESTSTATUS.FAILURE,"No network interfaces found.",res);
		next(true,undefined); // stop here
	    } else {
		that.end(TESTSTATUS.SUCCESS,"Found network interface(s).",res);
		next(false,_.values(res.result));
	    }
	});
    };

    var conntest2 = new Test({
	name: "Network interface type",
	shortname: 'conn2',
	desc: "Check if there are interfaces with non-local network address"
    });
    conntest2.exec = function(next, res) {
	var that = this;
	that.start("Checking network interface configuration...");
	var pass = _.filter(res, function(iface) {
	    if (iface.ipv4) {
		return iface.ipv4!=='127.0.0.1';
	    } else if (iface.ipv6) {
		return iface.ipv6!=='fe80::1';
	    } else {
		// No IP address
		return false;
	    }
	});
	if (pass.length>0) {
	    that.end(TESTSTATUS.SUCCESS,
		     "Found network interface(s) with network address.",
		     undefined);
	    next(false,pass);
	} else {
	    that.end(TESTSTATUS.FAILURE,
		     "All interfaces have local or no network address.",
		     undefined);
	    next(true,undefined); // stop here
	}
    };
	
    var conntest3 = new Test({
	name: "Network interface configuration",
	shortname: 'conn3',
	desc: "Check if there are interfaces with valid addresse"
    });
    conntest3.exec = function(next, res) {
	var that = this;
	that.start("Checking network interface configuration...");
	var pass = _.filter(res, function(iface) {
	    if (iface.ipv4) {
		// Anything starting with 169.254 is link-local
		return iface.ipv4.indexOf('169.254')!==0;
	    } else if (iface.ipv6) {
		// Anything starting with fe80: is link-local
		return iface.ipv6.indexOf('fe80:')!==0;
	    } else {
		return false; // should not happen, filtered out already
	    }
	});
	if (pass.length>0) {
	    that.end(TESTSTATUS.SUCCESS,
		     "Found network interface(s) with valid address.",
		     undefined);
	    next(false,undefined);
	} else {
	    that.end(TESTSTATUS.FAILURE,
		     "All interfaces have auto-configured addresses.",
		     undefined);
	    next(true,undefined); // stop here
	}
    };

    addtest(testsuite1, conntest1);
    addtest(testsuite1, conntest2);
    addtest(testsuite1, conntest3);    
    testsuites.add(testsuite1);

    var testsuite2 = new TestSuite({
	name:"Name Resolution Tests",
	shortname: 'dns'
    });
    
    var dnstest1 = new Test({
	name: "DNS resolver configuration",
	shortname: 'dns1',
	desc: "Check if there are configured DNS resolvers"
    });
    dnstest1.exec = function(next, res) {
	var that = this;
	that.start("Checking DNS resolvers...");
	fathom.system.getNameservers(function(res) {
	    if (res.error || !res.result || !res.result.nameservers || 
		_.isEmpty(res.result.nameservers)) 
	    {
		that.end(TESTSTATUS.FAILURE,"No DNS resolvers found.",res);
		next(false,undefined);
	    } else {
		that.end(TESTSTATUS.SUCCESS,"Found DNS resolver(s).",res);
		next(false,res.result.nameservers);
	    }
	});
    };

    var localdns = undefined;
    var ghost = 'www.google.com';
    var dnstest2 = new Test({
	name: "DNS lookup",
	shortname: 'dns2',
	desc: "Lookup '"+ghost+"' with the configured resolver"
    });
    dnstest2.exec = function(next, res) {
	var that = this;
	if (res) {
	    localdns = res[0];
	    that.start("Looking up '"+ghost+"' using " + localdns + "...");
	    fathom.proto.dns.create(function(res2) {
		if (!res2.error) {
		    fathom.proto.dns.lookup(function(res3) {
			if (!res3 || res3.error || !res3.answers || 
			    _.isEmpty(res3.answers)) 
			{
			    that.end(TESTSTATUS.ERRORS,
				     "Domain '"+ghost+"' not found. Check resolver " + localdns + " configuration.",
				     res3);
			    next(false,res);
			} else {
			    that.end(TESTSTATUS.SUCCESS,
				     "Domain '"+ghost+"' found.",
				     res3);
			    next(false,res);
			}
		    }, res2, ghost);
		} else {
		    that.end(TESTSTATUS.FAILURE,
			     "Internal error, aborting the test.",
			     res2);
		    next(false,undefined);
		}
	    }, localdns, 'udp', 53);
	} else {
	    // continue to next
	    that.end(TESTSTATUS.SKIP,
		     "Not run. Problem with local DNS configuration.",
		     undefined);
	    next(false,undefined);
	}
    };

    var dnstest3 = new Test({
	name: "Public DNS lookup",
	shortname: 'dns3',
	desc: "Lookup '"+ghost+"' with a public DNS server"
    });
    dnstest3.exec = function(next, res) {
	var that = this;
	that.start("Looking up '"+ghost+"' using a public DNS server ...");
	fathom.proto.dns.create(function(res2) {
	    if (!res2.error) {
		fathom.proto.dns.lookup(function(res3) {
		    if (!res3 || res3.error || !res3.answers || 
			_.isEmpty(res3.answers)) 
		    {
			that.end(TESTSTATUS.ERRORS,
				 "Domain '"+ghost+"' not found using public DNS server.",
				 res3);
			next(false,res);
		    } else {
			that.end(TESTSTATUS.SUCCESS,
				 "Domain '"+ghost+"' found.",
				 res3);
			next(false,res);
		    }
		}, res2, ghost, 5);
	    } else {
		that.end(TESTSTATUS.FAILURE,
			 "Internal error, aborting the test.",
			 res2);
		next(true,undefined);
	    }
	}, DNSSERVER, 'udp', 53);
    };
    
    addtest(testsuite2, dnstest1);
    addtest(testsuite2, dnstest2);
    addtest(testsuite2, dnstest3);
    
    testsuites.add(testsuite2);

    var testsuite3 = new TestSuite({
	name:"Network Level Tests",
	shortname:'network'
    });

    var nettest1 = new Test({
	name: "Network routes",
	shortname: 'net1',
	desc: "Check network route configuration"
    });
    nettest1.exec = function(next) {
	var that = this;
	that.start("Retrieving the routing table...");
	fathom.system.getRoutingTable(function(res) {
	    if (res.error || !res.result || !res.result.defaultroute) {
		that.end(TESTSTATUS.ERRORS,
			 "Missing default route. May not be able to route traffic to the Internet.",
			 res);
		next(false,undefined);
	    } else {
		that.end(TESTSTATUS.SUCCESS,
			 "Found default route(s).",
			 res);
		next(false,res.result);
	    }
	});
    };
    
    var nettest2 = new Test({
	name: "Gateway reachability",
	shortname: 'net2',
	desc: "Check if we can reach the default gateway(s)"
    });
    nettest2.exec = function(next,res) {
	var that = this;
	that.start("Checking the gateway reachability ...");

	if (res) {
	    var gw = res.defaultroute;
	    fathom.system.doPing(function(res1) {
		if (!res1.error && res1.result.rtt.length >= 1) {
		    that.end(TESTSTATUS.SUCCESS,
			     "Can reach the default gateway " + gw.gateway + ".",
			     res1);
		    next(false,undefined);
		} else {
		    that.end(TESTSTATUS.ERRORS,
			     "No response from the default gateway. This may just be a problem with 'ping'.", 
			     res1);
		    next(false,undefined);
		}
	    }, gw.gateway, { count : 2 });
	} else {
	    // continue to next
	    that.end(TESTSTATUS.SKIP,
		     "Not run. Could not determine the default gateway.",
		     undefined);
	    next(false,undefined);
	}
    };

    var nettest3 = new Test({
	name: "Internet reachability",
	shortname: 'net3',
	desc: "Check if we can reach a test server in the internet"
    });
    nettest3.exec = function(next, res) {
	var that = this;
	that.start("Checking the test server reachability ...");

	fathom.system.doPing(function(res1) {
	    if (!res1.error && res1.result.rtt.length >= 1) {
		that.end(TESTSTATUS.SUCCESS,"Can reach the test server.", res1);
		next(false,undefined);
	    } else {
		that.end(TESTSTATUS.ERRORS,
			 "No response from the test server. This may just be a problem with 'ping'.", 
			 res1);
		next(false,undefined);
	    }
	}, MSERVER, { count : 2 });
    };
    
    var nettest4 = new Test({
	name: "Internet reachability (Google)",
	shortname: 'net4',
	desc: "Check if we can reach google servers in the internet"
    });
    nettest4.exec = function(next, res) {
	var that = this;
	that.start("Checking google servers reachability ...");

	fathom.system.doPing(function(res1) {
	    if (!res1.error && res1.result.rtt.length >= 1) {
		that.end(TESTSTATUS.SUCCESS,"Can reach google servers.", res1);
		next(false,undefined);
	    } else {
		// no response from anyone
		that.end(TESTSTATUS.ERRORS,
			 "No response from google servers. This may just be a problem with 'ping'.",
			 res1);
		next(false,undefined);
	    }
	}, ghost, { count : 2 });
    };

    addtest(testsuite3, nettest1);
    addtest(testsuite3, nettest2);
    addtest(testsuite3, nettest3);
    addtest(testsuite3, nettest4);
    testsuites.add(testsuite3);

    var testsuite4 = new TestSuite({
	name:"HTTP Tests",
	shortname:'http'
    });

    var httptest1 = new Test({
	name: "HTTP page load from a test server",
	shortname: 'http1',
	desc: "Check if we can retrieve a web page from a test server"
    });
    httptest1.exec = function(next,res) {
	var that = this;
	that.start("Retrieving a test web page...");

	var fail = function(msg,reso) {
	    that.end(TESTSTATUS.FAILURE,msg,reso);
	    next(true,undefined);
	    return undefined;
	};

	fathom.proto.http.create(function(res1) {
	    if (!res1 || res1.error) {
		return fail("Internal error, aborting the test.",res1);
	    }
		
	    fathom.proto.http.send(function(res2) {
		if (res2.error) {
		    return fail("Failed to send the request to the test server.",res2);
		}
		    
		fathom.proto.http.receive(function(res3) {
		    fathom.proto.http.close(function() {}, res1);

		    if (res3.error) {
			return fail("Failed to receive the response from the test server.",res3);
		    } else {
			that.end(
			    TESTSTATUS.SUCCESS,
			    "HTTP page load from the test server succesfull",
			    res3.split('\r\n')[0]);
			next(false,undefined);
		    }
		}, res1);          // receive
	    }, res1, "GET", '/');  // send	    
	}, MSERVER);               // create
    };

    addtest(testsuite4, httptest1);
    testsuites.add(testsuite4);

    if (req && req.u) {
	// debug access to a specific url
	// TODO: why doesn't the decode work here ?!?
	var url = decodeURIComponent(req.u).replace('%3A',':');
	var l = document.createElement("a");
	l.href = url;
	console.log(JSON.stringify(l));

	var testsuite5 = new TestSuite({
	    name:"Test Access to '"+url+"'",
	    shortname:'debugurl'
	});

	// see if we can resolve its IP
	var test1 = new Test({
	    name: "Hostname lookup",
	    shortname: 'dns',
	    desc: "Check if we can manually resolve IP address of the host"
	});

	test1.exec = function(next,res) {
	    var that = this;
	    if (localdns) {
		that.start("Looking up '"+l.hostname+"' using " + 
			   localdns + "...");
		fathom.proto.dns.create(function(res2) {
		    if (!res2.error) {
			fathom.proto.dns.lookup(function(res3) {
			    if (!res3 || res3.error || !res3.answers || 
				_.isEmpty(res3.answers)) 
			    {
				that.end(TESTSTATUS.ERRORS,
					 "Domain '"+l.hostname+"' not found.",
					 res3);
				next(false,undefined);
			    } else {
				that.end(TESTSTATUS.SUCCESS,
					 "Domain '"+l.hostname+"' found.",
					 res3);
				next(false,res3.answers);
			    }
			}, res2, l.hostname);
		    } else {
			that.end(TESTSTATUS.FAILURE,
				 "Internal error, aborting the test.",
				 res2);
			next(false,undefined);
		    }
		}, localdns, 'udp', 53);
	    } else {
		that.end(TESTSTATUS.SKIP,
			 "No local DNS configuration",
			 undefined);
		next(false,undefined);
	    }
	};

	// is it reachable ?
	var test2 = new Test({
	    name: "Server reachability",
	    shortname: 'network',
	    desc: "Check if we can 'ping' the server"
	});

	test2.exec = function(next,res) {
	    var that = this;
	    if (res) {
		that.start("Checking the server '"+l.hostname+
			   "' reachability ...");

		fathom.system.doPing(function(res1) {
		    if (!res1.error && res1.result.rtt.length == 1) {
			that.end(TESTSTATUS.SUCCESS,
				 "Can reach the server '"+l.hostname+"'.",
				 res1);
			next(false,res);
		    } else {
			that.end(TESTSTATUS.ERRORS,
				 "No response from the server '"+l.hostname+"'. This may just be a problem with 'ping'.", 
				 res1);
			next(false,res);
		    }
		}, res[0], { count : 1 });

	    } else {
		that.end(TESTSTATUS.SKIP,
			 "Server address unknown. Can't check reachability.",
			 undefined);
		next(false,undefined);
	    }
	};

	// can we manually download a page ?
	var test3 = new Test({
	    name: "Download page",
	    shortname: 'http',
	    desc: "Check if we can manually download the page"
	});

	test3.exec = function(next,res) {
	    var that = this;
	    if (res) {
		var fail = function(msg,resx) {
		    that.end(TESTSTATUS.FAILURE,msg,resx);
		    next(true,undefined);
		    return undefined;
		};

		fathom.proto.http.create(function(res1) {
		    if (!res1 || res1.error) {
			return fail("Internal error, aborting the test.",res1);
		    }
		
		    fathom.proto.http.send(function(res2) {
			if (res2.error) {
			    return fail("Failed to send the request to the server.",res2);
			}
			
			fathom.proto.http.receive(function(res3) {
			    fathom.proto.http.close(function() {}, res1);

			    if (res3.error) {
				return fail("Failed to receive the response from the server.",res3);
			    } else {
				that.end(
				    TESTSTATUS.SUCCESS,
				    "HTTP page load from the server succesfull",
				    res3.split('\r\n')[0]);
				next(false,undefined);
			    }
			}, res1);                // receive
		    }, res1, "GET", l.path);     // send	    
		}, res[0], l.port || 80);        // create
	    } else {
		that.end(TESTSTATUS.SKIP,
			 "Server address unknown. Can't download.",
			 undefined);
		next(false,undefined);
	    }
	};

 	addtest(testsuite5, test1);
	addtest(testsuite5, test2);
	addtest(testsuite5, test3);
	testsuites.add(testsuite5);
    }

    return testsuites;
}; // create_testsuite

/**
 * A view to render a single test result line.
 */
var TestView = Backbone.View.extend({
    initialize: function(){
	_.bindAll(this, 'render'); 

	// parse the template once
	this.template = $('#testtemplate').html(),
	Mustache.parse(this.template);

	// the rendering target element
	this.el = $("#test" + this.model.get('id')),

	// on status change re-render this view
	this.model.on("change:status", this.render);

	// render for the first time now
	this.render();
    },
    render: function() {
	var rendered = Mustache.render(this.template, this.model.toJSON());
        this.el.html(rendered);
    }
});

/**
 * A view to render the test suites.
 */
var ResultView = Backbone.View.extend({
    initialize: function(){
	this.template = $('#template').html();
	Mustache.parse(this.template);

	// for now we only render this view once
	// all dynamic updates take place in the test views
	var rendered = Mustache.render(this.template, this.model.toJSON());
        $("#results").html(rendered);

	// initialize test specific views
	var testviews = this.testviews = [];
	this.model.each(function(testsuite) {
	    testsuite.tests.each(function(test) {
		var tv = new TestView({model:test});
		testviews.push(tv); 
	    });
	});
    }
});

// error page helper
var getQuery = function() {
    if (document.baseURI.indexOf('?') <= 0) return undefined;
    var queryString = document.baseURI.split('?')[1];
    var queries = queryString.split("&");
    var params = {}, temp;
    for (var i = 0; i < queries.length; i++ ) {
        temp = queries[i].split('=');
        params[temp[0]] = temp[1];
    }
    return params;
};

window.onload = function() {
    var fathom = fathom || window.fathom;
    if (!fathom)
	throw "Fathom not found";

    fathom.init(function() {
	var testsuites = create_testsuite(getQuery()); 
	var mainview = new ResultView({model:testsuites});

	var ts = new Date(); // starttime
	var startts = window.performance.now();
	testsuites.exec(function(obj) {
	    var elapsed = (window.performance.now() - startts); // ms
	    fathom.uploaddata('debugtool', { 
		ts : ts.getTime(),
		timezoneoffset : ts.getTimezoneOffset(),
		elapsed : elapsed,
		results : testsuites.toUploadJSON()
	    });
	    fathom.close();
	});
    });
};
