var Buffer = require('buffer.js').Buffer; 

exports["testBuffer"] = function(assert) {
    var buf = new Buffer('test');
    var json = buf.toJSON().data;

    assert.ok((json[0] === 116 &&
	       json[1] === 101 &&
	       json[2] === 115 &&
	       json[3] === 116), "buffer to json");

    var copy = new Buffer(json);
    assert.ok(copy.equals(buf), "json to buffer");
};

require("sdk/test").run(exports);
