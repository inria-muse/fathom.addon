var timers = require('sdk/timers');
var socketapi = require("../lib/socketapi");


const PORT = 9797;

var manifest = {
    api : {"socket" : "*"},
    allowdst : {
        "*" : { 
            "128.93.101.81" : { 80 : true },    // muse.inria.fr
            "123.123.123.123" : { 9797 : true },// random 
            "127.0.0.1" : { 9797 : true },
            "{server}" : { '*' : true }
        },
    },
    neighbors : {},
    isaddonpage : false,
    winid : 'test'
};

exports["testunknown"] = function(assert, done) {
    socketapi.start();
    socketapi.exec(function(res) {
        assert.ok(res.error !== undefined, "unknown method returns error");
        socketapi.stop();
        done();
    }, { method : 'asd'}, manifest);
};

exports["testudp"] = function(assert, done) {
    socketapi.start();
    var reqid = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { module : 'socket', 
             submodule : 'udp', 
             id : reqid,
             multiresp : cont, // multiresponse request
             method : method, 
             params : params};
    };

    var cli = function() {
        socketapi.exec(function(s) {
            assert.ok(s.error === undefined, 
                  "client socket.udp.openSocket no error");

            socketapi.exec(function(res) {
                assert.ok(res.error === undefined, 
                      "client socket.udp.udpConnect no error");

                socketapi.exec(function(res) {
                    assert.ok(res.error === undefined, 
                          "client socket.udp.send no error");

                    socketapi.exec(function(res) {
                        assert.ok(res.error === undefined, 
                              "client socket.udp.recv no error");
                        
                        assert.ok(res && res.data === "foo", 
                              "client socket.udp.recv got pong");

                        socketapi.exec(function() {}, getreq('close',[s]));

                    },getreq('recv',[s,true,2000]),manifest);
                },getreq('send',[s,"foo"]),manifest);       
            }, getreq('udpConnect',[s, "127.0.0.1", PORT]),manifest);
        }, getreq('udpOpen',[]),manifest);  
    };

    // start server
    socketapi.exec(function(s) {
        assert.ok(s.error === undefined, 
              "server socket.udp.openSocket no error");

        var stimer = undefined;
        var serverclose = function(ok) {
            if (stimer)
                timers.clearTimeout(stimer);
            stimer = undefined;
            if (s) {
                socketapi.exec(function(res) {
                    socketapi.exec(function() {}, getreq('close',[s]));
                    socketapi.stop();
                    done();                 
                }, getreq('udpRecvStop',[s]),manifest);
            }
        };
        stimer = timers.setTimeout(serverclose, 5000); // test will end in 5s

        socketapi.exec(function(res) {
            assert.ok(res.error === undefined, 
                  "server socket.udp.udpBind no error");

            // start client side and listen for responses
            timers.setTimeout(cli, 0);

            socketapi.exec(function(res) {
                assert.ok((res.error === undefined), 
                      "server socket.udp.udpRecvFromStart no error");
                
                if (res.data && res.data === "foo") { // got ping - send pong
                    assert.ok(true, 
                          "server socket.udp.udpRecvFromStart got ping");

                    // add the host to the server list so that we can send
                    // data back
                    manifest.neighbors['server'] = {};
                    manifest.neighbors['server'][res.address] = true;

                    socketapi.exec(function(res) {
                        assert.ok(res.error === undefined, 
                              "server socket.udp.udpSendTo no error");

                    }, getreq('udpSendTo',[s,res.data,res.address,res.port]),manifest);
                }
            }, getreq('udpRecvFromStart', [s, true], true),manifest);
        }, getreq('udpBind',[s, 0, PORT, true]),manifest);
    }, getreq('udpOpen',[]),manifest);
};


exports["testudpmany"] = function(assert, done) {
    socketapi.start();
    var reqid = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { module : 'socket', 
             submodule : 'udp', 
             id : reqid,
             multiresp : cont, // multiresponse request
             method : method, 
             params : params};
    };

    // just sends a udp packet and closes the socket after
    var cnt = 0;
    var cli = function() {
        socketapi.exec(function(s) {
            assert.ok(s.error === undefined, 
                  "client socket.udp.openSocket no error");

            socketapi.exec(function(res) {
                assert.ok(res.error === undefined, 
                      "client socket.udp.udpConnect no error");

                socketapi.exec(function(res) {

                    assert.ok(res.error === undefined,                      
                          "client socket.udp.send no error");

                    socketapi.exec(function(res) {
                        // don't expect to receive anything - just close down
                        socketapi.exec(function() { 
                            cnt += 1; 
                            if (cnt >= 100) {
                                assert.ok(cnt == 100, 
                                      "all closed - done");
                                socketapi.stop();
                                done();
                            }
                        }, getreq('close',[s]), manifest);
                    },getreq('recv',[s,true,500]), manifest);
                },getreq('send',[s,"foo"]), manifest);       
            }, getreq('udpConnect',[s, "123.123.123.123", PORT]), manifest);
        }, getreq('udpOpen',[]), manifest);  
    };

    // start bunch of cli's in parallel
    for (var i = 0; i < 100; i++) {
        timers.setTimeout(cli,0);
    }
};


exports["testtcp"] = function(assert, done) {
    socketapi.start();

    var reqid = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { 
            module : 'socket', 
            submodule : 'tcp', 
            id : reqid,
            multiresp : cont, // multiresponse request
            method : method, 
            params : params};
    };

    // just sends a tcp packet and closes the socket after
    var cli = function() {
        socketapi.exec(function(s) {
            console.log(s);
            assert.ok(s.error === undefined, 
                  "client socket.tcp.openSendSocket no error");

            socketapi.exec(function(res) {
                console.log(res);
                assert.ok(res.error === undefined,                      
                      "client socket.tcp.send no error");

                socketapi.exec(function(res) {
                    console.log(res);
                    assert.ok(res.error === undefined,                      
                          "client socket.tcp.send no error");

                    socketapi.exec(function() { 
                        socketapi.stop();
                        done();

                    }, getreq('close',[s]), manifest);
                },getreq('recv',[s,true,1000]), manifest);
            },getreq('send',[s,"HEAD HTTP/1.1 /\n\r\n\r"]), manifest);       
        }, getreq('tcpOpenSendSocket',["128.93.101.81", 80]), manifest);  
    };

    timers.setTimeout(cli,0);
};

exports["testtcpmany"] = function(assert, done) {
    socketapi.start();

    var reqid = 0;
    var getreq = function(method, params, cont) {
        reqid += 1; 
        cont = (cont !== undefined ? cont : false);
        return { 
            module : 'socket', 
            submodule : 'tcp', 
            id : reqid,
            multiresp : cont, // multiresponse request
            method : method, 
            params : params};
    };

    var tests = 50;

    // just sends a tcp packet and closes the socket after
    var cnt = 0
    var cli = function() {
        socketapi.exec(function(s) {
            console.log(s);
            assert.ok(s.error === undefined, 
                  "client socket.tcp.openSendSocket no error");

            socketapi.exec(function(res) {
                console.log(res);
                assert.ok(res.error === undefined,                      
                      "client socket.tcp.send no error");

                socketapi.exec(function(res) {
                    console.log(res);
                    assert.ok(res.error === undefined,                      
                          "client socket.tcp.send no error");

                    socketapi.exec(function() { 
                        cnt += 1;
                        if (cnt==tests) {
                            socketapi.stop();
                            done();
                        }

                    }, getreq('close',[s]), manifest);
                },getreq('recv',[s,true,500]), manifest);
            },getreq('send',[s,"HEAD HTTP/1.1 /\n\r\n\r"]), manifest);       
        }, getreq('tcpOpenSendSocket',["128.93.101.81", 80]), manifest);  
    };

    for (var i = 0; i < tests; i++ ) {
        timers.setTimeout(cli,20);
    }
};

require("sdk/test").run(exports);
