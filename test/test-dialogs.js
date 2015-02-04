// tests for opening up various dialogs
var dialogs = require('./ui/dialogs');

exports["testSecDialog"] = function(assert, done) {
    var sec = require("./security");
    var m = {
	'api' : ["socket.*", "proto.*", "tools.*", "system.*"],
	'destinations' : [
	    'udp://192.168.1.1:53',
	    '192.168.1.2',
	    '*://{mdns}:*'
	]
    };
    m = sec.parseManifest(m);
    dialogs.showSecurityDialog(function(res) {
	assert.ok(true, "security dialog");
	done();
    }, m);
};

exports["testAboutDialog"] = function(assert, done) {
    dialogs.showAboutDialog(function() {
	assert.ok(true, "about dialog");
	done();
    });
};

exports["testUploadDialog"] = function(assert, done) {
    dialogs.showUploadDialog(function(res) {
	assert.ok(true, "about dialog " + res);
	done();
    },'asd');
};

require("sdk/test").run(exports);
