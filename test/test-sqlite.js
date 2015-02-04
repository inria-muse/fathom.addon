
const { Unknown } = require('sdk/platform/xpcom');
const {Cc, Ci, Cu} = require("chrome");
Cu.import("resource://gre/modules/Sqlite.jsm");

exports["testjsm"] = function(assert, done) {
    Sqlite.openConnection({path: "MyDB.sqlite"}).then(
	function onOpen(conn) {
	    assert.ok(conn!==undefined, "open");

	    conn.execute("SELECT 1").then(
		function onStatementComplete(result) {
		    assert.ok(result!==undefined, "result " + result);

		    conn.close().then(
			function onClose() {
			    assert.ok(true, "done");
			    done();
			},
			function(err) {
			    assert.ok(err, "close fails " + err);
			    done();
			}
		    ); // close
		},
		function(err) {
		    assert.ok(err, "execute fails " + err);
		    done();
		}
	    ); // execute
	},
	function(err) {
	    assert.ok(err, "open fails " + err);
	    done();
	}
    ).then(null, function handleError(err) {
	assert.ok(err, "something fails " + err);
	done();
    });; // open
};

require("sdk/test").run(exports);

