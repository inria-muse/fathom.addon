var baselinedb = require("./baselinedb");
const fileIO = require('sdk/io/file');
const ss = require("sdk/simple-storage");

exports["test1"] = function(assert, done) {
	var db = new baselinedb.DB();
	var file = db.dbfile.path;
	assert.ok(db!==undefined, 'created');
	assert.ok(db.version == ss.storage['baseline_dbschema'], 'schema ok ' + db.version);
	assert.ok(!fileIO.exists(file),'file does not exist');
	assert.ok(!db.isConnected(), 'not connected after create');

	db.connect(function(res) {
		console.log(res);
		assert.ok(fileIO.exists(file),'file exists after connect');
		assert.ok(!res || (res && !res.error), 'connect ok');
		assert.ok(db.isConnected(), 'is connected after connect');

		db.close();
		assert.ok(!db.isConnected(), 'not connected after close');
		assert.ok(fileIO.isFile(file),'file exists after close');
		db = undefined;

		// test update from 4 to 5
		ss.storage['baseline_dbschema'] = 4;
		db = new baselinedb.DB();
		assert.ok(db.version == ss.storage['baseline_dbschema'], 'schema ok ' + db.version);
		db.connect(function(res) {
			console.log(res);
			assert.ok(!res || (res && !res.error), 're-connect ok');			
			assert.ok(db.isConnected(), 'is connected after connect');
			assert.ok(db.version == 5, 'schema ok after update');
			assert.ok(ss.storage['baseline_dbschema'] == 5, 'schema ok after update');

			db.cleanup();
			assert.ok(!fileIO.exists(file),'file removed');

			done();
		});
	});
};

require("sdk/test").run(exports);
