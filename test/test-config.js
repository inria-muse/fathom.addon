exports['test1'] = function(assert, done) {
    var config = require('../lib/config');
    assert.ok(config.get('config','version') == 0, "got correct version");
    done();
}

exports['test2'] = function(assert, done) {
    var config = require('../lib/config');
    var timers = require('sdk/timers');
    config.update();
    timers.setTimeout(function() {
        assert.ok(config.get('config','version') == 0, "version no change");
        done();
    }, 2000);
}

require("sdk/test").run(exports);