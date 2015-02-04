const os = require('sdk/system').platform;
console.log(os);

exports['test1'] = function(assert, done) {
    const subprocess = require("subprocess");
    subprocess.registerDebugHandler(console.log);
    subprocess.registerLogHandler(console.log);
    var p = subprocess.call({
	command:     (os === 'winnt' ? 'echo' : '/bin/echo'),
      
	arguments:   ['foo'],
      
	stdout: function(data) {
            assert.ok((data.trim() === "foo"), "can read from stdout");
	},

	stderr: function(data) {
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
    const subprocess = require("subprocess");
    subprocess.registerDebugHandler(console.log);
    subprocess.registerLogHandler(console.log);
    var p = subprocess.call({
	command:     (os === 'winnt' ? 'C:\\Windows\\System32\\where.exe' : '/usr/bin/which'),
      
	arguments:   ['ping'],
      
	stdout: function(data) {
            assert.ok((data.indexOf("ping")>0), "found ping");
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


exports['test3'] = function(assert, done) {
    const child_process = require("sdk/system/child_process");
	const prog = (os === 'winnt' ? 'echo' : '/bin/echo');
    var p = child_process.spawn(prog,['foo']);
    p.stdout.on('data', function(data) {
        assert.ok((data.trim() === "foo"), "sdk can read from stdout");
    });
    p.stderr.on('data', function(data) {
        assert.ok(false, "sdk got data on standard error " + data);
    });
    p.on('close', function(code) {
        assert.ok(code === 0, "sdk return 0 exit code");
        done();
    });
};

exports['test4'] = function(assert, done) {
    const child_process = require("sdk/system/child_process");
	var prog = (os === 'winnt' ? 'C:\\Windows\\System32\\where.exe' : '/usr/bin/which');
    var p = child_process.spawn(prog,['ping']);

    p.stdout.on('data', function(data) {
        assert.ok((data.indexOf("ping")>0), "sdk found ping");
    });

    p.stderr.on('data', function(data) {
        assert.ok(false, "sdk got data on standard error " + data);
    });

    p.on('close', function(code) {
        assert.ok(code === 0, "sdk return 0 exit code");
        done();
    });
};

const { env } = require('sdk/system/environment');
console.log(JSON.stringify(env.PATH,null,4));

require("sdk/test").run(exports);
