var protoapi = require("./protoapi");

var manifest = {
    api : {"proto" : { '*' : true}},
    allowdst : {
	"udp" : {"127.0.0.1" : { "53" : true },
		 "192.168.1.1" : { "53" : true },
		 "8.8.8.8" : { "53" : true }},
	"tcp" : {"127.0.0.1" : { "53" : true },
		 "192.168.1.1" : { "53" : true },
		 "8.8.8.8" : { "53" : true }},
    },
    neighbors : {},
    isaddon : false,
    winid : "test"
};

exports["testcreate"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");
	protoapi.exec(function(res) {
	    assert.ok(res.error === undefined, "dns.close no error");
	    done();
	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'close', 
	     params : [id]}, manifest);
    }, { module : "proto", 
	 submodule: "dns", 
	 method : 'create', 
	 params : ['8.8.8.8']}, manifest);
};

exports["testmylookup"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length == 1 &&
		      res.answers[0] === '128.93.165.1', 
		      "lookupHostname found correct ip");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'muse.inria.fr',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['8.8.8.8','udp',53]}, manifest);
};

exports["testmylookup2"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length > 1,
		      "dns.lookup got multiple ips");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'www.google.com',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['8.8.8.8','udp',53]}, manifest);
};


exports["testlookuptcp"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    console.log(res);
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length == 1 &&
		      res.answers[0] === '128.93.165.1', 
		      "lookupHostname found correct ip");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'muse.inria.fr',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['8.8.8.8','tcp',53]}, manifest);
};

exports["testlookuptcp2"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    console.log(res);
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length > 1,
		      "dns.lookup got multiple ips");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'www.google.com',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['8.8.8.8','tcp',53]}, manifest);
};

exports["testlocallookuptcp"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    console.log(res);
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length == 1 &&
		      res.answers[0] === '128.93.165.1', 
		      "lookupHostname found correct ip");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'muse.inria.fr',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['192.168.1.1','tcp',53]}, manifest);
};

exports["testlocallookupudp"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "dns.create no error");

	protoapi.exec(function(res, doneflag) {
	    console.log(res);
	    assert.ok(res.error === undefined, "dns.lookup no error");
	    assert.ok(res.timeout === undefined, "dns.lookup no timeout");
	    assert.ok(res.answers && res.answers.length == 1 &&
		      res.answers[0] === '128.93.165.1', 
		      "lookupHostname found correct ip");

	    // cleanup
	    protoapi.exec(function(res) {}, { module : "proto", 
					      submodule: "dns", 
					      method : 'close', 
					      params : [id]}, manifest);

	    done();

	}, { module : "proto", 
	     submodule: "dns", 
	     method : 'lookup', 
	     params : [id, 'muse.inria.fr',10]}, manifest);

    }, { module : "proto", 
	 submodule : "dns", 
	 method : 'create', 
	 params : ['192.168.1.1','udp',53]}, manifest);
};


require("sdk/test").run(exports);
