var env = require('../lib/env');
const timers = require("sdk/timers");

exports["testnetworklocal"] = function(assert, done) {
    env.getenvlocal(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    });
};

exports["testnetworkfull"] = function(assert, done) {
    env.getenvfull(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    });
};

exports["testgetnetworkenv1"] = function(assert, done) {
    env.getnetworkenv(function(res) {
        console.log(JSON.stringify(res,null,4));
        assert.ok(!res.error, "no error");
        done(); 
    });
};

exports["testgetnetworkenv2"] = function(assert, done) {
    // test with db
    var db = require('../lib/db');
    db.getInstance().connect(function() {
        env.getnetworkenv(function(res) {
            console.log(JSON.stringify(res,null,4));
            assert.ok(!res.error, "no error");
            assert.ok(res.env_id != null, "has sql id");
            db.getInstance().cleanup();
            done(); 
        });
    });
};

exports["testgetnetworkenv3"] = function(assert, done) {
    // test with db
    var db = require('../lib/db');
    db.getInstance().connect(function() {
        env.getnetworkenv(function(res) {
            assert.ok(!res.error, "no error");
            env.getnetworkenv(function(res2) {
                console.log(JSON.stringify(res2,null,4));
                assert.ok(!res2.error, "no error");
                assert.ok(res2.cached, "got cached on 2nd req (< 5s)");
                db.getInstance().cleanup();
                done(); 
            });
        });
    });
};

exports["testgetnetworkenv4"] = function(assert, done) {
    var db = require('../lib/db');
    db.getInstance().connect(function() {
        env.getnetworkenv(function(res) {
            // returns local info
            console.log(JSON.stringify(res,null,4));
            assert.ok(!res.error, "no error");
            assert.ok(!res.public_ip, "expected no public_ip");

            timers.setTimeout(function() {
                env.getnetworkenv(function(res2) {
                    console.log(JSON.stringify(res2,null,4));
                    assert.ok(!res2.error, "no error");
                    assert.ok(res2.public_ip && res2.public_ip!=='0.0.0.0', "got public_ip");
                    assert.ok(res2.cached, "not cached on 2nd req (> 5s)");
                    db.getInstance().cleanup();
                    done(); 
                });
            }, 5010);
        });
    });
};

require("sdk/test").run(exports);