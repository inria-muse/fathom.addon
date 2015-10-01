// tests for opening up various dialogs
var dialogs = require('../lib/ui/dialogs');

exports["testSecDialog"] = function(assert, done) {
    var sec = require("../lib/security");
    var m = {
	'location' : { href : 'http://foo.bar' },
	'description' : 'testing security dialog',
	'api' : ["socket.*", "proto.*", "tools.*", "system.*"],
	'destinations' : [
	    'udp://192.168.1.1:53',
	    'http://www.google.com',
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
