var env = require('../lib/env');

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

exports["testgetcurrent"] = function(assert, done) {
    var res = env.getcurrent();
    console.log(JSON.stringify(res,null,4));
    assert.ok((res && !res.error), "no error");
    done(); 
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
                assert.ok(res2.cached, "got cached on 2nd req");
                db.getInstance().cleanup();
                done(); 
            });
        });
    });
};

exports["testgetnetworkenv4"] = function(assert, done) {
    // test with db
    var db = require('../lib/db');
    db.getInstance().connect(function() {
        // will do full resolve and cache to db
        env.getnetworkenv(function(res) {
            assert.ok(!res.error, "no error");

            // only does local lookup and gets rest from db
            env.getenvlocal(function(res2) {
                console.log(JSON.stringify(res2,null,4));
                assert.ok(!res2.error, "no error");
                assert.ok(res2.env_id === res.env_id, "got correct db match");
                db.getInstance().cleanup();
                done(); 
            });
        });
    });
};

require("sdk/test").run(exports);