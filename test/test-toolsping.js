var tools = require("./toolsapi");

var manifest = {
    isaddon : true,
    winid : 'test',
    neighbors : {}
};

exports["testxmlhttp1"] = function(assert, done) {
    tools.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "no error");
		if (doneflag)
		    done();
    }, { 
    	module : 'tools',
	 	submodule : 'ping', 
	 	method : 'start', 
	 	params : ['62.210.73.169', { proto : 'xmlhttpreq', count : 5, reports : true}],
	 	id : 1
    }, manifest);
};

exports["testxmlhttp2"] = function(assert, done) {
    tools.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "no error");
		if (doneflag)
		    done();
    }, { 
    	module : 'tools',
	 	submodule : 'ping', 
	 	method : 'start', 
	 	params : ['www.google.com', { proto : 'xmlhttpreq', count : 1}],
	 	id : 1
    }, manifest);
};

exports["testhttp1"] = function(assert, done) {
    tools.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "no error");
		if (doneflag)
		    done();
    }, { 
    	module : 'tools',
	 	submodule : 'ping', 
	 	method : 'start', 
	 	params : ['62.210.73.169', { proto : 'http', count : 1}],
	 	id : 1
    }, manifest);
};

exports["testhttp2"] = function(assert, done) {
    tools.exec(function(res, doneflag) {
		console.log(res);
		assert.ok(!res.error, "no error");
		if (doneflag)
		    done();
    }, { 
    	module : 'tools',
	 	submodule : 'ping', 
	 	method : 'start', 
	 	params : ['62.210.73.169', { proto : 'http', count : 5, reports : true}],
	 	id : 1
    }, manifest);
};

require("sdk/test").run(exports);
