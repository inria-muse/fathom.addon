const child_process = require("sdk/system/child_process");
const os = require('sdk/system').platform;

const subprocess = require("../lib/subprocess/subprocess");
const utils = require('../lib/utils');

console.log(os);

exports['test1'] = function(assert, done) {
    subprocess.registerDebugHandler(console.log);
    subprocess.registerLogHandler(console.log);
    var p = subprocess.call({
    	command:     (os === 'winnt' ? 'echo' : '/bin/echo'),
          
    	arguments:   ['foo'],
          
    	stdout: function(data) {
          	    console.log(data);
    	    assert.ok((data.trim() === "foo"), "can read from stdout");
    	},

    	stderr: function(data) {
    	    console.log(data);
                assert.ok(false, "got data on standard error " + data);
    	},

    	done: function(res) {
                assert.ok(res.exitCode === 0, "return 0 exit code");
                done();
    	},

    	mergeStderr: false
    });
};

exports['test2'] = function(assert, done) {
    subprocess.registerDebugHandler(console.log);
    subprocess.registerLogHandler(console.log);

    var p = subprocess.call({
    	command:     (os === 'winnt' ? 'C:\\Windows\\System32\\where.exe' : '/usr/bin/which'),
          
    	arguments:   ['ping'],
          
    	stdout: function(data) {
    	    console.log(data);
                assert.ok((data.indexOf("ping")>0), "found ping");
    	},

    	stderr: function(data) {
    	    console.log(data);
                assert.ok(false, "got data on standard error " + data);
    	},

    	done: function(res) {
    	    console.log(res);
                assert.ok(res.exitCode === 0, "return 0 exit code");
                done();
    	},

    	mergeStderr: false
    });
};


exports['test3'] = function(assert, done) {
    const prog = (os === 'winnt' ? 'echo' : '/bin/echo');

    var p = child_process.spawn(prog,['foo']);
    p.stdout.on('data', function(data) {
	console.log(data);
        assert.ok((data.trim() === "foo"), "sdk can read from stdout");
    });

    p.stderr.on('data', function(data) {
	console.log(data);
        assert.ok(false, "sdk got data on standard error " + data);
    });

    p.on('close', function(res) {
	console.log(res);
        assert.ok(res === 0, "sdk return 0 exit code");
        done();
    });
};

exports['test4'] = function(assert, done) {
	var prog = (os === 'winnt' ? 'C:\\Windows\\System32\\where.exe' : '/usr/bin/which');
    var p = child_process.spawn(prog,['ping']);

    p.stdout.on('data', function(data) {
        assert.ok((data.indexOf("ping")>0), "sdk found ping at " + data);
    });

    p.stderr.on('data', function(data) {
        assert.ok(false, "sdk got data on standard error " + data);
    });

    p.on('close', function(code) {
        assert.ok(code === 0, "sdk return 0 exit code");
        done();
    });
};

exports['test5'] = function(assert, done) {
	var prog = (os === 'winnt' ? 'C:\\Windows\\System32\\ping.exe' : '/bin/ping');
    if (os === 'darwin')
        prog = '/sbin/ping';

    var p = child_process.spawn(prog,['-c 1','www.google.com']);

	assert.ok(utils.isExecFile(prog), "is executable");
	
    p.stdout.on('data', function(data) {
        console.log(data);
        assert.ok(data && data.length>0, "ping ok");
    });

    p.stderr.on('data', function(data) {
        assert.ok(false, "sdk got data on standard error " + data);
    });

    p.on('close', function(code) {
        assert.ok(code === 0, "sdk return 0 exit code");
        done();
    });
};

exports['test6'] = function(assert, done) {
    subprocess.registerDebugHandler(console.log);
    subprocess.registerLogHandler(console.log);

    var prog = (os === 'winnt' ? 'C:\\Windows\\System32\\ping.exe' : '/bin/ping');
    if (os === 'darwin')
        prog = '/sbin/ping';

    var p = subprocess.call({
    	command:     prog,
          
    	arguments:   ['-c 1','www.google.com'],
          
    	stdout: function(data) {
            assert.ok(data && data.length>0, "ping ok");
    	},

    	stderr: function(data) {
                assert.ok(false, "got data on standard error " + data);
    	},

    	done: function(res) {
    	    console.log(res);
                assert.ok(res.exitCode === 0, "return 0 exit code");
                done();
    	},

    	mergeStderr: false
    });
};



const { env } = require('sdk/system/environment');
console.log(JSON.stringify(env.PATH,null,4));

require("sdk/test").run(exports);
