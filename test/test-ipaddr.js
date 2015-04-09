var ipaddr = require('ipaddr');
var _ = require('underscore');

exports["testRangeMatch"] = function(assert) {
    var addr = ipaddr.parse("2001:db8:1234::1");
    console.log(addr.range());
    var range = ipaddr.parse("2001:db8::");

    assert.ok(addr.match(range, 32), "matches");


    var addr2 = ipaddr.parse("128.93.62.141");
    console.log(addr2.range());
    var range2 = ipaddr.parse("128.93.1.100");

    assert.ok(addr2.match(range2, 16), "matches");
};

exports["testParsing"] = function(assert) {
    var addr = ipaddr.parse("192.168.1.1");
    assert.ok((addr.octets[0] === 192 &&
	       addr.octets[1] === 168 &&
	       addr.octets[2] === 1 &&
	       addr.octets[3] === 1), "octets ok");

    assert.ok(!ipaddr.isValid("fe80::1%lo0"), "mac ipv6");
    assert.ok(ipaddr.isValid("fe80::1"), "mac ipv6");
    assert.ok(!ipaddr.IPv4.isValid("fe80::1"), "mac ipv6");
    assert.ok(ipaddr.IPv6.isValid("fe80::1"), "mac ipv6");

    assert.ok(ipaddr.parse('123456'), "long");

};

require("sdk/test").run(exports);
