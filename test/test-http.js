var protoapi = require("./protoapi");
var server = "62.210.73.169";

var manifest = {
    api : ["proto.*"],
    allowdst : {
	"tcp" : {"62.210.73.169" : { 80 : true }},
    },
    neighbors : {},
    isaddonpage : false,
    winid : 'test'
};

exports["testunknown"] = function(assert, done) {
    protoapi.exec(function(res) {
	assert.ok(res.error !== undefined, "unknown method returns error");
	done();
    }, { module : "proto", submodule: "http", method : 'asd'}, manifest);
};

exports["testconnect"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "http.create no error, id="+id);

	protoapi.exec(function(res) {
	    assert.ok(res.error === undefined, "http.close no error");
	    done();
	    
	}, { module : "proto", 
	     submodule: "http", 
	     method : 'close', 
	     params : [id]}, manifest);

    }, { module : "proto", 
	 submodule: "http", 
	 method : 'create', 
	 params : [server, 80]}, manifest);
};

exports["testgetmethod"] = function(assert, done) {
    protoapi.exec(function(id) {
	assert.ok(id.error === undefined, "http.create no error");

	protoapi.exec(function(res) {
	    assert.ok(res.error === undefined, "http.send no error");

	    protoapi.exec(function(res) {
		assert.ok(res.error === undefined, 
			  "http.receive no error");
		
		if (res && !res.error)
		    assert.ok(res.indexOf("<html>")>=0, 
			      "http.receive got html document");
		
		protoapi.exec(function(res) {
		    assert.ok(res.error === undefined, 
			      "http.close no error");
		    done();
		    
		}, { module : "proto", 
		     submodule: "http", 
		     method : 'close', 
		     params : [id]}, manifest);
		
	    }, { module : "proto", 
		 submodule: "http", 
		 method : 'receive', 
		 params : [id]}, manifest);
	    
	}, { module : "proto", 
	     submodule: "http", 
	     method : 'send', 
	     params : [id, 'GET', '/']}, 
		      manifest);
	
    }, { module : "proto", 
	 submodule: "http", 
	 method : 'create', 
	 params : [server]}, manifest);
};

require("sdk/test").run(exports);
