var ipaddr = require('ipaddr');
var _ = require('underscore');

exports["testRangeMatch"] = function(assert) {
    var addr = ipaddr.parse("2001:db8:1234::1");
    var range = ipaddr.parse("2001:db8::");

    assert.ok(addr.match(range, 32), "matches");
};

exports["testParsing"] = function(assert) {
    var addr = ipaddr.parse("192.168.1.1");
    assert.ok((addr.octets[0] === 192 &&
	       addr.octets[1] === 168 &&
	       addr.octets[2] === 1 &&
	       addr.octets[3] === 1), "octets ok");
};

require("sdk/test").run(exports);
