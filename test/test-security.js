var _ = require('underscore');
var sec = require("./security");

exports["testerrors"] = function(assert) {
    var m = {
	'api' : [
	    'foo.*',
	],
	'destinations' : []
    };
    var r = sec.parseManifest(m);
    assert.ok((r.error !== undefined && r.error.type == "invalidmanifest"),
	      "parseManifest detects invalid api");

    m = {
	'api' : [],
	'destinations' : ['foo://bar']
    };
    r = sec.parseManifest(m);
    assert.ok((r.error !== undefined && r.error.type == "invalidmanifest"),
	      "parseManifest detects invalid destination protocol");

    m = {
	'api' : [],
	'destinations' : ['bar:asd']
    };
    r = sec.parseManifest(m);
    assert.ok((r.error !== undefined && r.error.type == "invalidmanifest"),
	      "parseManifest detects non-numerical destination port");

    m = {
	'api' : [],
	'destinations' : ['bar:100000']
    };
    r = sec.parseManifest(m);
    assert.ok((r.error !== undefined && r.error.type == "invalidmanifest"),
	      "parseManifest detects invalid destination port");
};


exports["testapiparsing"] = function(assert) {
    var m = {
	'api' : [
	    'socket.*',
	    'proto.http.*',
	],
    };
    r = sec.parseManifest(m);
    assert.ok((r.error === undefined && r.api['socket'] && 
	       r.api['socket']["*"]),
	      "parseManifest parses 1st level wildcard correctly");

    assert.ok((r.error === undefined && r.api['proto'] && 
	       r.api['proto']['http'] && r.api['proto']['http']["*"]),
	      "parseManifest parses 2nd level wildcard correctly");

    m = {
	'api' : [
	    'socket.send',
	    'socket.recv',
	    'proto.dns.lookup'
	],
    };

    r = sec.parseManifest(m);
    assert.ok((r.error === undefined && r.api['socket'] && 
	       r.api['socket']['send'] &&
	       r.api['socket']['recv']),
	      "parseManifest parses 1st level methods correctly");
    
    assert.ok((r.error === undefined && r.api['proto'] && 
	       r.api['proto']['dns'] &&
	       r.api['proto']['dns']['lookup']),
	      "parseManifest parses 2nd level methods correctly");
};

exports["testdstparsing"] = function(assert) {
    m = {
	'destinations' : [
	    'udp://192.168.1.1:53',
	    '*://192.168.1.1:53',
	    '192.168.1.1:5353',
	    '*://192.168.1.1:*',
	    '192.168.1.2',
	    'www.google.com',
	]
    };
    r = sec.parseManifest(m);
    assert.ok((r.error === undefined && r.allowdst['udp'] && 
	       r.allowdst['udp']['192.168.1.1'][53]),
	     "parseManifest parses "+m.destinations[0]+" correctly");

    assert.ok((r.error === undefined && r.allowdst['*'] && 
	       r.allowdst['*']['192.168.1.1'][53]),
	     "parseManifest parses "+m.destinations[1]+" correctly");

    assert.ok((r.error === undefined && r.allowdst['*'] && 
	       r.allowdst['*']['192.168.1.1'][5353]),
	     "parseManifest parses "+m.destinations[2]+" correctly");

    assert.ok((r.error === undefined && r.allowdst['*'] && 
	       r.allowdst['*']['192.168.1.1']['*']),
	     "parseManifest parses "+m.destinations[3]+" correctly");

    assert.ok((r.error === undefined && r.allowdst['*'] && 
	       r.allowdst['*']['192.168.1.2']['*']),
	     "parseManifest parses "+m.destinations[4]+" correctly");

    assert.ok((r.error === undefined && r.allowdst['*'] && 
	       r.allowdst['*']['www.google.com']['*']),
	     "parseManifest parses "+m.destinations[5]+" correctly");

};

exports["testcheckdst"] = function(assert) {
    var m = {
	'destinations' : [
	    'udp://192.168.1.1:53',
	]
    };
    m = sec.parseManifest(m);
    assert.ok(sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission allow full uri match");

    assert.ok(!sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.2'}, m), 
	      "checkDstPermission disallow wrong ip");

    assert.ok(!sec.checkDstPermission(
	{ proto: 'udp', port : 5353, host : '192.168.1.1'}, m), 
	      "checkDstPermission disallow wrong port");

    assert.ok(!sec.checkDstPermission(
	{ proto: 'tcp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission disallow wrong proto");

    m = {
	'api' : [],
	'destinations' : [
	    '*://192.168.1.1:53',
	]
    };
    m = sec.parseManifest(m);
    assert.ok(sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission allow wildcard proto");

    m = {
	'api' : [],
	'destinations' : [
	    'udp://192.168.1.1:*',
	]
    };
    m = sec.parseManifest(m);
    assert.ok(sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission allow wildcard port");

    m = {
	'api' : [],
	'destinations' : [
	    '*://192.168.1.1:*',
	]
    };
    m = sec.parseManifest(m);
    assert.ok(sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission allow all wildcards");

    m = {
	'api' : [],
	'destinations' : [
	    '*://192.168.1.2:*',
	]
    };
    m = sec.parseManifest(m);
    assert.ok(!sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission disallow invalid host");


    m = {
	'api' : [],
	'destinations' : [
	    '*://{upnp}:*',
	]
    };
    m = sec.parseManifest(m);
    // discover host
    m.neighbors['upnp'] = {};
    m.neighbors['upnp']['192.168.1.1'] = true;
    assert.ok(sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.1'}, m), 
	      "checkDstPermission allow upnp discovered host");
    assert.ok(!sec.checkDstPermission(
	{ proto: 'udp', port : 53, host : '192.168.1.2'}, m), 
	      "checkDstPermission disallow upnp invalid host");
};

require("sdk/test").run(exports);
