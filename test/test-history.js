let { search } = require("sdk/places/history");

// Simple query

exports["test"] = function(assert, done) {

  search({}, {sort : 'visitCount', count : 10, descending : true}).on("error", function (err) {
    assert.ok(false,'error: ' + err);
  }).on("end", function (results) {
    // results is an array of objects containing
    // data about visits to any site on developers.mozilla.org
    // ordered by visit count
    console.log(JSON.stringify(results,null,4));
    assert.ok(results, 'got results');
    done();
  });
}

require("sdk/test").run(exports);