var protoapi = require("./protoapi");

var manifest = {
    api : ["proto.*"],
    allowdst : {
	"multicast" : {"239.255.255.250" : { 1900 : true }}, // UPnP discovery
	"*" : {"{upnp}" : { "*" : true }}, // node found by UPnP
    },
    neighbors : {},
    isaddonpage : false,
    winid : "test"
};

exports["testunknown"] = function(assert, done) {
    protoapi.exec(function(res) {
	assert.ok(res.error !== undefined, "unknown method returns error");
	done();
    }, { module : "proto", submodule: "upnp", method : 'asd'}, manifest);
};

exports["testcreate"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "upnp.create no error");
	protoapi.exec(function(res) {
	    assert.ok(res.error === undefined, "upnp.close no error");
	    done();
	}, { module : "proto", 
	     submodule: "upnp", 
	     method : 'close', 
	     params : [id]}, manifest);
    }, { module : "proto", 
	 submodule: "upnp", 
	 method : 'create', 
	 params : []}, manifest);
};

exports["testdiscovery"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "upnp.create no error");
	protoapi.exec(function(dev, doneflag) {
	    console.log(JSON.stringify(dev,null,4));
	    assert.ok(dev.error === undefined, "upnp.discovery no error");
	    if (!dev.timeout)
		assert.ok(dev.address !== undefined, 
			  "upnp.discovery returns device with ip " + 
			  dev.address);

	    if (doneflag)
		done();

	}, { module : "proto", 
	     submodule: "upnp", 
	     method : 'discovery', 
	     params : [id, 10]}, manifest);
    }, { module : "proto", 
	 submodule: "upnp", 
	 method : 'create', 
	 params : []}, manifest);
};

require("sdk/test").run(exports);
