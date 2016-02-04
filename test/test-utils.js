var u = require('../lib/utils');

exports["testgetipinfo"] = function(assert, done) {
    u.getIpInfo(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    }, '88.173.211.195');
};

exports["testlookuppromise"] = function(assert, done) {
    const { all } = require('sdk/core/promise');
    all([
        u.getIpInfoP('88.173.211.195')
    ]).then(function(results) {
        // success function
        console.log(JSON.stringify(results, null, 4));
        assert.ok(results.length == 1, "got all results");
        done();
    }, function (reason) {
        assert.ok(reason, "error " + reason);
        done();
    });
};

exports["testlookupip"] = function(assert, done) {
    u.lookupIP(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    });
};

exports["testlookupmac"] = function(assert, done) {
    u.lookupMAC(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    }, '4c:72:b9:27:28:ea');
};

require("sdk/test").run(exports);