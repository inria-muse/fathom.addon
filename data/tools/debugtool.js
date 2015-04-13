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
    RUNNING :     'test-running',
    SKIP :        'test-skip',
    SUCCESS :     'test-success',
    ERRORS :      'test-errors',
    FAILURE :     'test-failure'
};

// measurement server IP (hosted server at online.net)
// FIXME: should come from the extension (or defined runtime as closest mserver ... )
const MSERVER = '62.210.73.169';

// public DNS resolver (google resolver)
const DNSSERVER = '8.8.8.8';

// Host to check (DNS/HTTP)
const HOST= 'www.google.com';

/** Model: single test. */
var Test = Backbone.Model.extend({
    defaults: {
        id: -1,
        status: TESTSTATUS.NOT_STARTED,
        statustxt: "Not started yet.",
        isrunning: false,
        starttime: undefined, // start called
        endtime: undefined,   // succ/fail called
        name: '',             
        shortname: '',
        help: '',
        'test-running-txt' :     'Executing ...',
        'test-skip-txt' :        'Skipped.',
        'test-success-txt' :     'Success!',
        'test-errors-txt' :      'Errors encountered during the test. This may indicate a problem.',
        'test-failure-txt' :     'Failed.',
        json : undefined      // test results to upload
    },
    initialize: function() {
        _.bindAll(this, 'start', 'end'); 
    },
    start: function() {
        console.log('test start ' + this.get('name'));
        this.set('isrunning',true);
        this.set('starttime', Date.now());
        this.set('statustxt', this.get(TESTSTATUS.RUNNING+'-txt'));
        this.set('status', TESTSTATUS.RUNNING); // triggers view update
    },
    end: function(status, json) {
        console.log('test end ' + this.get('name') + " " + status);
        if (status === TESTSTATUS.SKIP && !this.get('starttime'))
            this.set('starttime', Date.now());
        this.set('isrunning',false);
        this.set('endtime', Date.now());
        this.set('json', json);
        this.set('statustxt', this.get(status+'-txt'));
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
        name: '',
        shortname: '',
        help: '',
        tests : undefined   // collection of tests
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
                that.tests.at(i).end(TESTSTATUS.SKIP, undefined);
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
        var json = { name : this.get('name'), help : this.get('help') };
        json.tests = this.tests.map(function(model) {
            return model.toJSON(options);
        });
        return json;
    },
    toUploadJSON: function() {
        var json = { name : this.get('shortname') };
        json.results = this.tests.map(function(model) {
            return { 
                json : model.get('json'),
                name : model.get('shortname'),
                ts : model.get('starttime'),
                d : model.get('endtime')-model.get('starttime'),
                status : model.get('status') 
            };
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

    //-------------------------------------------
    var testsuite1 = new TestSuite({
        name: "General Connectivity Tests",
        shortname: 'connectivity',
        help: "Set of tests to verify if your network interfaces are available and correctly configured."
    });

    var conntest1 = new Test({
        name: "Network interface availability",
        shortname: 'conn1',
        help: "Checks if you have active network interfaces. If the test fails, make sure your network interface is enabled, cables are connected and that you network router/gateway/modem/wifi access point is switched on.",
        'test-running-txt' : 'Retrieving available network interfaces ...',
        'test-success-txt' : 'Found network interface(s).',
        'test-failure-txt' : 'No network interfaces found.',
    });

    conntest1.exec = function(next) {
        var that = this;
        that.start();
        fathom.system.getActiveInterfaces(function(res) {
            if (res.error || !res.result || _.isEmpty(res.result)) {
                that.end(TESTSTATUS.FAILURE,res);
                next(true,undefined); // stop here
            } else {
                that.end(TESTSTATUS.SUCCESS,res);
                next(false,res.result);
            }
        });
    };

    var conntest2 = new Test({
        name: "Network interface type",
        shortname: 'conn2',
        help: "Checks if other than loopback interface is available. If the test fails, make sure your network interface is enabled, cables are connected and that you network router/gateway/modem/wifi access point is switched on.",
        'test-running-txt' : 'Checking network interfaces ...',
        'test-success-txt' : 'Found network interface(s) with non-loopback IP address.',
        'test-failure-txt' : 'Only the loopback interface is available.',
    });
    conntest2.exec = function(next, res) {
        var that = this;
        that.start();
        var pass = _.filter(res, function(iface) {            
            if (iface.ipv4) {
                return (ipaddr.IPv4.isValid(iface.ipv4) && ipaddr.parse(iface.ipv4).range() !=='loopback');
            } else if (iface.ipv6) {
                return (ipaddr.IPv6.isValid(iface.ipv6) && ipaddr.parse(iface.ipv6).range() !=='loopback');
            } else {
                // No IP address
                return false;
            }
        });

        if (pass.length>0) {
            that.end(TESTSTATUS.SUCCESS,pass);
            next(false,pass);
        } else {
            that.end(TESTSTATUS.FAILURE,pass);
            next(true,undefined); // stop here
        }
    };

    var conntest3 = new Test({
        name: "Network interface configuration",
        shortname: 'conn3',
        help: "Checks if there are interfaces with valid IP address available. If the test fails, most likely your gateway/router/modem/wifi access point does not provide you an IP address. Check both your local and the gateway's configurations.",
        'test-running-txt' : 'Checking network interface(s) configuration ...',
        'test-success-txt' : 'Found network interface(s) with valid address.',
        'test-failure-txt' : 'All interface(s) have link-local address.',
    });
    conntest3.exec = function(next, res) {
        var that = this;
        that.start();
        var pass = _.filter(res, function(iface) {
            if (iface.ipv4) {
                var addr = (ipaddr.IPv4.isValid(iface.ipv4) ? ipaddr.parse(iface.ipv4) : undefined);
                return (addr && (addr.range() === 'unicast' || addr.range() === 'private'));
            } else if (iface.ipv6) {
                var addr = (ipaddr.IPv6.isValid(iface.ipv6) ? ipaddr.parse(iface.ipv6) : undefined);
                return (addr && (addr.range() === 'unicast' || addr.range() === 'uniqueLocal' || addr.range() === 'ipv4Mapped'));
            } else {
                return false;
            }
        });

        if (pass.length>0) {
            that.end(TESTSTATUS.SUCCESS,pass);
            next(false,undefined);
        } else {
            that.end(TESTSTATUS.FAILURE,pass);
            next(true,undefined); // stop here
        }
    };

    addtest(testsuite1, conntest1);
    addtest(testsuite1, conntest2);
    addtest(testsuite1, conntest3);    
    testsuites.add(testsuite1);

    //-------------------------------------------
    var testsuite2 = new TestSuite({
        name:"Name Resolution Tests",
        shortname: 'dns',
        help: "Set of tests to check your DNS (name to IP address resolution) configuration and correct operation."
    });

    var dnstest1 = new Test({
        name: "DNS resolver configuration",
        shortname: 'dns1',
        help: "Checks if there are configured DNS resolvers. If this test has erros, most likely your gateway/router/modem/wifi access point does not provide you a valid DNS configuration. Check both your local and the gateway's configurations.",
        'test-running-txt' : 'Retrieving DNS configuration ...',
        'test-success-txt' : 'Found local DNS resolver(s).',
        'test-errors-txt' : 'No local DNS resolver(s) found.',        
    });
    dnstest1.exec = function(next, res) {
        var that = this;
        that.start();
        fathom.system.getNameservers(function(res) {
            if (res.error || !res.result || !res.result.nameservers || 
                _.isEmpty(res.result.nameservers)) 
            {
                that.end(TESTSTATUS.ERRORS,res);
                next(false,[]); // continue tests
            } else {
                that.end(TESTSTATUS.SUCCESS,res);
                next(false,res.result.nameservers);
            }
        });
    };

    var localdns = undefined;
    var dnstest2 = new Test({
        name: "DNS lookup with local resolver",
        shortname: 'dns2',
        help: "Resolves '"+HOST+"' IP address with your local DNS resolver using Fathom DNS implementation over UDP. If the test fails, your local DNS resolver may not be working correctly or UDP is blocked in your network.",
        'test-running-txt' : 'Resolving ' + HOST + '...',
        'test-skip-txt' : 'Skipped. No local DNS resolvers found.',
        'test-success-txt' : 'Resolution completed succesfully.',
        'test-failure-txt' : '"' + HOST + '" not found.',
        'test-errors-txt' : 'Fathom had a problem while trying to resolve the name.',                
    });
    dnstest2.exec = function(next, res) {
        var that = this;
        if (res && res.length>0) {
            localdns = res[0];
            that.start();
            fathom.proto.dns.create(function(res2) {
                if (!res2.error) {
                    fathom.proto.dns.lookup(function(res3) {
                        if (!res3 || res3.error) {
                            that.end(TESTSTATUS.ERRORS,res3);
                        } else if (!res3.answers || _.isEmpty(res3.answers)) {
                            that.end(TESTSTATUS.FAILURE,res3);
                        } else {
                            that.end(TESTSTATUS.SUCCESS,res3);
                        }
                        next(false,undefined); // continue to next in anycase
                    }, res2, HOST);
                } else {
                    that.end(TESTSTATUS.ERRORS,res2);
                    next(false,undefined); // continue to next
                }
            }, localdns, 'udp', 53);
        } else {
            that.end(TESTSTATUS.SKIP,undefined);
            next(false,undefined); // continue to next
        }
    };

    var dnstest3 = new Test({
        name: "DNS lookup with public DNS resolver",
        shortname: 'dns3',
        help: "Tries to resolve '"+HOST+"' IP address with a public DNS resolver '"+DNSSERVER+"' using Fathom DNS implementation over UDP. If the test fails, the public DNS service may not be reachable or UDP is blocked in your network.",
        'test-running-txt' : 'Resolving "' + HOST + '" with public DNS...',
        'test-success-txt' : 'Resolution completed succesfully.',
        'test-failure-txt' : '"' + HOST + '" not found.',
        'test-errors-txt' : 'Fathom had a problem while trying to resolve the name.', 
    });
    dnstest3.exec = function(next, res) {
        var that = this;
        that.start();
        fathom.proto.dns.create(function(res2) {
            if (!res2.error) {
                fathom.proto.dns.lookup(function(res3) {
                    if (!res3 || res3.error) {
                        that.end(TESTSTATUS.ERRORS,res3);
                    } else if (!res3.answers || _.isEmpty(res3.answers)) {
                        that.end(TESTSTATUS.FAILURE,res3);
                    } else {
                        that.end(TESTSTATUS.SUCCESS,res3);
                    }
                    next(false,undefined); // continue
                }, res2, HOST, 5);
            } else {
                that.end(TESTSTATUS.ERRORS,res2);
                next(false,undefined);
            }
        }, DNSSERVER, 'udp', 53);
    };

    var dnstest4 = new Test({
        name: "DNS lookup with Firefox name lookup",
        shortname: 'dns4',
        help: "Resolves '"+HOST+"' IP address with Firefox name lookup. If the test fails, your local DNS configuration is not correct.",
        'test-running-txt' : 'Resolving "' + HOST + '" with Firefox...',
        'test-success-txt' : 'Resolution completed succesfully.',
        'test-failure-txt' : '"' + HOST + '" not found.'
    });
    dnstest4.exec = function(next, res) {
        var that = this;
        that.start();
        fathom.tools.lookupHostname(function(res2) {
            if (!res2.error && res2.answers && !_.isEmpty(res2.answers)) {
                that.end(TESTSTATUS.SUCCESS,res2);
                next(false,undefined);
            } else {
                that.end(TESTSTATUS.FAILURE,res2);
                next(false,undefined);
            }
        }, HOST);
    };


    addtest(testsuite2, dnstest1);
    addtest(testsuite2, dnstest2);
    addtest(testsuite2, dnstest3);
    addtest(testsuite2, dnstest4);
    testsuites.add(testsuite2);

    // ------------------------------------------
    var testsuite3 = new TestSuite({
        name:"Network Level Tests",
        shortname:'network',
        help: "Set of tests to check your network level configuration and internet reachability."
    });

    var nettest1 = new Test({
        name: "Default gateway and routes",
        shortname: 'net1',
        help: "Checks your network route configuration. If this test fails, check your network configuration. If it has errors, some of the network traffic may not be routed correctly.",
        'test-running-txt' : "Retrieving the route configuration ...",
        'test-success-txt' : 'Found default gateway and route(s).',
        'test-errors-txt' : 'No default gateway or route(s) found.',
        'test-failure-txt' : 'No route(s) found.'
    });
    nettest1.exec = function(next) {
        var that = this;
        that.start();
        fathom.system.getRoutingTable(function(res) {
            if (res.error || !res.result || (_.isEmpty(res.result.routes) && !res.result.defaultgateway)) {
                that.end(TESTSTATUS.FAILURE,res);
                next(true,undefined); // stop here
            } else if (!_.find(res.result.routes, function(r) { return r.defaultroute; }) && !res.result.defaultgateway) {
                that.end(TESTSTATUS.ERRORS,res);
                next(false,res.result);
            } else {
                that.end(TESTSTATUS.SUCCESS,res);
                next(false,res.result);
            }
        });
    };

    var nettest2 = new Test({
        name: "Default gateway reachability",
        shortname: 'net2',
        help: "Checks if we can reach (ping) the default gateway. If the test has errors, this may just be a problem with ping (e.g. the gateway does not support pinging).",
        'test-running-txt' : "Trying to reach the default gateway ...",
        'test-success-txt' : 'Got a response from the default gateway.',
        'test-errors-txt' : 'No response from the default gateway.',
        'test-skip-txt' : 'Skipped. Could not detect the default gateway.'
    });
    nettest2.exec = function(next,res) {
        var that = this;
        that.start();

        if (res && res.defaultgateway) {
            var gw = res.defaultgateway;
            fathom.system.doPing(function(res1) {
                if (!res1.error && res1.result.rtt.length >= 1) {
                    that.end(TESTSTATUS.SUCCESS,res1);
                } else {
                    that.end(TESTSTATUS.ERRORS,res1);
                }
                next(false,undefined);
            }, gw.gateway, { count : 3, interval : 0.5, timeout : 3});
        } else {
            // continue to next
            that.end(TESTSTATUS.SKIP,undefined);
            next(false,undefined);
        }
    };

    var nettest3 = new Test({
        name: "Internet reachability",
        shortname: 'net3',
        help: "Checks if we can reach (ping) a test server in the internet. If the test has errors, this may just be a problem with ping (e.g. the network blocks ping traffic or the server is temporarily down).",
        'test-running-txt' : "Trying to reach the test server ...",
        'test-success-txt' : 'Got a response from the test server.',
        'test-errors-txt' : 'No response from the test server.'
    });
    nettest3.exec = function(next, res) {
        var that = this;
        that.start();
        fathom.system.doPing(function(res1) {
            if (!res1.error && res1.result.rtt.length >= 1) {
                that.end(TESTSTATUS.SUCCESS,res1);
            } else {
                that.end(TESTSTATUS.ERRORS,res1);
            }
            next(false,undefined);
        }, MSERVER, { count : 3, interval : 0.5, timeout : 5});
    };

    var nettest4 = new Test({
        name: "Internet reachability ("+HOST+")",
        shortname: 'net4',
        help: "Check if we can reach (ping) \""+HOST+"\". If the test has errors, this may just be a problem with ping (e.g. the network blocks ping traffic or the server is temporarily down).",
        'test-running-txt' : "Trying to reach \""+HOST+"\" ...",
        'test-success-txt' : 'Got a response from "'+HOST+'".',
        'test-errors-txt' : 'No response from "'+HOST+'".'
    });
    nettest4.exec = function(next, res) {
        var that = this;
        that.start();
        fathom.system.doPing(function(res1) {
            if (!res1.error && res1.result.rtt.length >= 1) {
                that.end(TESTSTATUS.SUCCESS,res1);
            } else {
                that.end(TESTSTATUS.ERRORS,res1);
            }
            next(false,undefined);
        }, HOST, { count : 3, interval : 0.5, timeout : 5});
    };

    addtest(testsuite3, nettest1);
    addtest(testsuite3, nettest2);
    addtest(testsuite3, nettest3);
    addtest(testsuite3, nettest4);
    testsuites.add(testsuite3);

    //-------------------------------------------
    var testsuite4 = new TestSuite({
        name:"HTTP Tests",
        shortname:'http',
        help: 'Set of tests to check HTTP (application) level connectivity.'
    });

    var httptest1 = new Test({
        name: "HTTP page load from the test server",
        shortname: 'http1',
        help: "Checks if we can retrieve a web page from a test server. If the test has errors, this may indicate a problem with your network connection. If it fails, the test server may be temporarily down.",
        'test-running-txt' : 'Retrieving a web page from the test server ...',
        'test-success-txt' : 'HTTP download from test server succeeded.',
        'test-errors-txt' : 'Connection problem while trying to download from the test server.', 
        'test-failure-txt' : 'HTTP download from test server failed.'
    });
    httptest1.exec = function(next,res) {
        var that = this;
        that.start();
        fathom.tools.ping.start(function(res1) {
            if (!res1 || res1.error) {
                that.end(TESTSTATUS.ERRORS,res1);
            } else if (res1.pings && res1.pings.length > 0) {
                that.end(TESTSTATUS.SUCCESS,res1);
            } else {
                that.end(TESTSTATUS.FAILURE,res1);
            }
            next(false,undefined);
        }, MSERVER, { proto : 'xmlhttpreq', count : 1});
    };

    var httptest2 = new Test({
        name: 'HTTP page load ('+HOST+')',
        shortname: 'http2',
        help: 'Checks if we can retrieve a web page from "'+HOST+'". If the has errors, this may indicate a problem with your network connection. If it fails, "'+HOST+'" may be temporarily down.',
        'test-running-txt' : 'Retrieving http://'+HOST+'/ ...',
        'test-success-txt' : 'HTTP download from "'+HOST+'" succeeded.',
        'test-errors-txt' : 'Connection problem while trying to download from "'+HOST+'".', 
        'test-failure-txt' : 'HTTP download from "'+HOST+'" failed.'
    });
    httptest2.exec = function(next,res) {
        var that = this;
        that.start();
        fathom.tools.ping.start(function(res1) {
            if (!res1 || res1.error) {
                that.end(TESTSTATUS.ERRORS,res1);
            } else if (res1.pings && res1.pings.length > 0) {
                that.end(TESTSTATUS.SUCCESS,res1);
            } else {
                that.end(TESTSTATUS.FAILURE,res1);
            }
            next(false,undefined);
        }, HOST, { proto : 'xmlhttpreq', count : 1});
    };

    addtest(testsuite4, httptest1);
    addtest(testsuite4, httptest2);
    testsuites.add(testsuite4);

    if (req && req.u) {
        // debug access to a specific url
        // TODO: why doesn't the decode work here ?!?
        var url = decodeURIComponent(req.u).replace('%3A',':');
        var l = document.createElement("a");
        l.href = url;
        console.log('debugging',JSON.stringify(l));

        var testsuite5 = new TestSuite({
            name:"Test Access to '"+url+"'",
            shortname:'debugurl',
            help: 'Set of tests to troubleshoot access problem with "'+url+'".'
        });

        // see if we can resolve its IP
        var test1 = new Test({
            name: "Hostname lookup",
            shortname: 'dns',
            help: "Checks if we can resolve IP address of the host. If this test fails, you don't see the page because its IP address could not be found.",
            'test-running-txt' : 'Resolving ' + l.hostname + '...',
            'test-success-txt' : 'Resolution completed succesfully.',
            'test-failure-txt' : '"' + l.hostname + '" not found.',
            'test-errors-txt' : 'Connection problem while trying to resolve the name.'
        });

        test1.exec = function(next,res) {
            var that = this;
            that.start();
            if (localdns) {
                fathom.proto.dns.create(function(res2) {
                    if (!res2.error) {
                        fathom.proto.dns.lookup(function(res3) {
                            if (!res3 || res3.error) {
                                that.end(TESTSTATUS.ERRORS,res3);
                                next(false,undefined);                                
                            } else if (!res3.answers || _.isEmpty(res3.answers)) {
                                that.end(TESTSTATUS.FAILURE,res3);
                                next(true,undefined);
                            } else {
                                that.end(TESTSTATUS.SUCCESS,res3);
                                next(false,res3.answers);
                            }
                        }, res2, l.hostname);
                    } else {
                        that.end(TESTSTATUS.ERRORS,res2);
                        next(false,undefined);
                    }
                }, localdns, 'udp', 53);
            } else {
                // try with firefox
                fathom.tools.lookupHostname(function(res2) {
                    if (!res2.error) {
                        that.end(TESTSTATUS.SUCCESS,res2);
                        next(false,res2.answers);
                    } else {
                        that.end(TESTSTATUS.FAILURE,res2);
                        next(false,undefined);
                    }
                }, l.hostname);                
            }
        };

        // is it reachable ?
        var test2 = new Test({
            name: "Server reachability",
            shortname: 'network',
            help: "Checks if we can reach (ping) the server. If the test has errors, the server may be temporarily down or does not respond to pings.",
            'test-running-txt' : "Trying to reach \""+l.hostname+"\" ...",
            'test-success-txt' : 'Got a response from "'+l.hostname+'".',
            'test-errors-txt' : 'No response from "'+l.hostname+'".'                
        });

        test2.exec = function(next,res) {
            var that = this;
            if (res && res.length>0) {
                that.start();
                fathom.system.doPing(function(res1) {
                    if (!res1.error && res1.result.rtt.length >= 1) {
                        that.end(TESTSTATUS.SUCCESS,res1);
                    } else {
                        that.end(TESTSTATUS.ERRORS,res1);
                    }
                    next(false,res);
                }, res[0], { count : 2, interval : 0.5, timeout : 5 });
            } else {
                that.start();
                fathom.system.doPing(function(res1) {
                    if (!res1.error && res1.result.rtt.length >= 1) {
                        that.end(TESTSTATUS.SUCCESS,res1);
                    } else {
                        that.end(TESTSTATUS.ERRORS,res1);
                    }
                    next(false,res);
                }, l.hostname, { count : 2, interval : 0.5, timeout : 5 });
            }
        };

        // can we manually download a page ?
        var test3 = new Test({
            name: "Download page",
            shortname: 'http',
            help: "Checks if we can download the page.",
            'test-running-txt' : 'Retrieving http://'+url+'/ ...',
            'test-success-txt' : 'HTTP download from "'+url+'" succeeded.',
            'test-errors-txt' : 'Connection problem while trying to download from "'+url+'".', 
            'test-failure-txt' : 'HTTP download from "'+url+'" failed.'
        });
        test3.exec = function(next,res) {
            var that = this;
            that.start();
            fathom.tools.ping.start(function(res1) {
                if (!res1 || res1.error) {
                    that.end(TESTSTATUS.ERRORS,res1);
                } else if (res1.pings && res1.pings.length > 0) {
                    that.end(TESTSTATUS.SUCCESS,res1);
                } else {
                    that.end(TESTSTATUS.FAILURE,res1);
                }
                next(false,undefined);
            }, url, { proto : 'xmlhttpreq', count : 1});
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
    initialize: function() {
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
    if (document.baseURI.indexOf('?') <= 0) 
        return undefined;

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

    var utemplate = document.getElementById('uploadtemplate').innerHTML;
    Mustache.parse(utemplate);
    fathom.internal(function(pref) {
        var rendered = Mustache.render(
            utemplate, 
            {upload : (pref === 'always'), ready : false });
        var e = document.getElementById('upload');
        e.innerHTML = rendered;
    }, 'getuserpref', 'debugtoolupload');

    fathom.init(function() {
        var testsuites = create_testsuite(getQuery()); 
        var mainview = new ResultView({model:testsuites});

        var ts = new Date(); // starttime
        var startts = window.performance.now();
        testsuites.exec(function(obj) {
            var elapsed = (window.performance.now() - startts); // ms

            // get raw data
            var json = testsuites.toUploadJSON();

            // queue for upload
            fathom.internal(function(userok) {
                // update the upload block
                var rendered = Mustache.render(
                    utemplate, 
                    {upload : userok, ready : true});
                var e = document.getElementById('upload');
                e.innerHTML = rendered;

                // enable the data link
                $("#showdata").click(function() {
                    var win = window.open("../rawdata.html");
                    win.json = json;
                });

                fathom.close();

            }, 'upload', { 
                ts : ts.getTime(),
                timezoneoffset : ts.getTimezoneOffset(),
                elapsed : elapsed,
                results : json
            });
        }); // exec
    }); // init
};
