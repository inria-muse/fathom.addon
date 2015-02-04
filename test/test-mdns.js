var protoapi = require("./protoapi");

var manifest = {
    api : ["proto.*"],
    allowdst : {
	"multicast" : {"224.0.0.251" : { 5353 : true }}, // mDNS discovery
	"*" : {"{mdns}" : { "*" : true }}, // nodes found by mDNS
    },
    neighbors : {},
    isaddonpage : false,
    winid : "test"
};

exports["testmdnsunknown"] = function(assert, done) {
    protoapi.exec(function(res) {
	assert.ok(res.error !== undefined, "unknown method returns error");
	done();
    }, { module : "proto", submodule: "mdns", method : 'asd'}, manifest);
};

exports["testmdnscreate"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "mnds.create no error");
	protoapi.exec(function(res) {
	    assert.ok(res.error === undefined, "mdns.close no error");
	    done();
	}, { module : "proto", 
	     submodule: "mdns", 
	     method : 'close', 
	     params : [id]}, manifest);
    }, { module : "proto", 
	 submodule: "mdns", 
	 method : 'create', 
	 params : []}, manifest);
};

exports["testmdnsdiscovery"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "mdns.create no error");
	protoapi.exec(function(dev, doneflag) {
	    assert.ok(dev.error === undefined, "mdns.discovery no error");

	    console.log(dev);

	    if (!dev.timeout)
		assert.ok(dev.address !== undefined, 
			  "mdns.discovery returns device with ip " + 
			  dev.address);

	    if (doneflag)
		done();

	}, { module : "proto", 
	     submodule: "mdns", 
	     method : 'discovery', 
	     params : [id, 10]}, manifest);
    }, { module : "proto", 
	 submodule: "mdns", 
	 method : 'create', 
	 params : []}, manifest);
};

require("sdk/test").run(exports);
