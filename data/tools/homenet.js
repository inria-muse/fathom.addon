/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverview Homenet discovery tool.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

// The network graph, all d3 stuff is hidden here
var NetGraph = function(elem, clickevents, width) {
    var canvas = $(elem); // canvas div
    var width = this.width = (width || 0.85*canvas.width());
    var height = this.height = width/1.61;

    var nodeid = this.nodeid = 0;

    // The node label
    var getName = function(n) {
        var name = '';
        if (n.type === 'local') {
            name = 'Your Device';

        } else if (n.type === 'internet') {
            name = 'Internet';

        } else if (n.type === 'gw') {
            if (n.raw['upnp'] && 
                n.raw['upnp'].xml && 
                n.raw['upnp'].xml.friendlyName)
                name = n.raw['upnp'].xml.friendlyName;
            else if (n.raw['mdns'] && 
               n.raw['mdns'].hostname)
                name = 'Gateway ' + n.raw['mdns'].hostname.replace('.local','');
            else
                name = 'Internet Gateway';

        } else {
            name = undefined;
            if (n.raw['upnp']) {
                if (n.raw['upnp'].xml && n.raw['upnp'].xml.friendlyName)
                    name = n.raw['upnp'].xml.friendlyName;
                else if (n.raw['upnp'].iswin)
                    name = "Windows Device";
                else if (n.raw['upnp'].islinux)
                    name = "Linux Device";
                else if (n.raw['upnp'].isdarwin)
                    name = "Mac Device";
            }

            if (!name && n.raw['mdns']) {
                if (n.raw['mdns'].hostname)
                    name = n.raw['mdns'].hostname.replace('.local','');
                else if (n.raw['mdns'].iswin)
                    name = "Windows Device";
                else if (n.raw['mdns'].islinux)
                    name = "Linux Device";
                else if (n.raw['mdns'].isdarwin)
                    name = "Mac Device";
            }

            if (!name && n.raw['ping'] && n.raw['ping'].arp && n.raw['ping'].arp.hostname) {
                name = n.raw['ping'].arp.hostname;
                if (name === '?')
                    name = undefined;
            }

            if (!name && n.raw['arp'] && n.raw['arp'].hostname)
                name = n.raw['arp'].hostname;

            if (!name && n.raw['devinfo'])
                name = n.raw['devinfo'].company + ' Device';

            if (!name)
                name = 'Network Device';
        }

        // Make sure is capitalized
        return name.charAt(0).toUpperCase() + name.slice(1);
    };

    var getHostname = function(n) {
        var res = undefined;
        if (n.type === 'local') {
            res = n.raw['local'].hostname;
        } else if (n.raw['mdns'] && n.raw['mdns'].hostname) {
            res = n.raw['mdns'].hostname;
        } else if (n.raw['arp'] && n.raw['arp'].hostname) {
            res = n.raw['arp'].hostname;
        }
        return res;
    };

    var formatInfoStr = function(n) {
        var res = "<h5 class=\"upper\">"+getName(n)+"</h5><p><ul>";
        var hn = getHostname(n);
        if (hn)
            res += "<li>Hostname: "+hn+"</li>";

        switch (n.type) {
        case 'local':    
        case 'peer':    
        case 'gw':
            if (n.ipv4)
                res += "<li>IP: "+n.ipv4+"</li>";
            else if (n.ipv6)
                res += "<li>IP: "+n.ipv6+"</li>";

            if (n.raw['arp'] && n.raw['arp'].mac)
                res += "<li>Interface MAC: "+n.raw['arp'].mac+"</li>";
            else if (n.raw['local'] && n.raw['local'].networkenv)
                res += "<li>Interface MAC: "+n.raw['local'].networkenv.default_iface_mac+"</li>";

            if (n.raw['devinfo'] && n.raw['devinfo'].company)
                res += "<li>Interface Manufacturer: "+n.raw['devinfo'].company+"</li>";

            break;

        case 'internet':
            if (n.raw['internet']) {
                res += "<li>Public IP: "+n.raw['internet'].ip+"</li>";
                res += "<li>ISP: "+n.raw['internet'].isp+"</li>";
                if (n.raw['internet'].city)
                    res += "<li>Location: "+n.raw['internet'].city;
                if (n.raw['internet'].country)
                    res += " ("+n.raw['internet'].country+")</li>";
            } else {
                res += "<li>Not connected!</li>";
            }
            break;
        }

        res += "</ul></p>";
        return res;
    };

    // SVG canvas
    d3.select(elem)
        .attr("width", width)
        .style("position", "relative")

    var svg = d3.select(elem).append("svg:svg")
        .attr("class", "net-graph")
        .attr("width", width)
        .attr("height", height);

    // Outer borders to the canvas
    var rect = svg.append("rect")
        .attr("width", width)
        .attr("height", height)
        .attr("class", "canvas");

    // Edge and node groups
    var eg = svg.append("g")
        .attr("render-order", -1);
    var ng = svg.append("g")
        .attr("render-order", 1);

    // info float
    var infobox = d3.select(elem)
        .append("div")
        .attr("class", "infofloat")
        .style("position", "absolute")
        .style('top', '5px')
        .style('left', '50%')
        .style('margin-left', (-width/2+10)+'px')
        .style("opacity", 0); // hidden

    var tick = function() {
        link.attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });
        node.attr("transform", function(d) { 
            return "translate(" + d.x + "," + d.y + ")"; });
    };

    var force = d3.layout.force()
        .nodes([])
        .links([])
        .gravity(0.1)
        .charge(-300)
        .linkDistance(0.25*width) 
        .size([width, height])
        .on("tick", tick);

    var nodes = this.nodes = force.nodes();
    var links = this.links = force.links();

    var node = ng.selectAll(".circle"); // circle group
    var link = eg.selectAll(".line");   // edge group

    // node radius
    var defaultr = 0.03 * width;
    var getdefaultr = function(n) {
        if (nodes.length > 20 && n.type === 'peer') {
            return defaultr / 3.0;
        } else if (nodes.length > 10 && n.type === 'peer') {
            return defaultr / 2.0;
        } else {
            return defaultr;
        }        
    }
    var gettransr = function(n) {
        if (nodes.length > 20 && n.type === 'peer') {
            return defaultr / 3.0;
        } else if (nodes.length > 10 && n.type === 'peer') {
            return (defaultr + defaultr/3.0) / 2.0;
        } else {
            return (defaultr + defaultr/3.0);
        }
    }

    var nodemouseover = function(n) {
        infobox.html(formatInfoStr(n));
        infobox.transition()
            .duration(300)
            .style("opacity", .9);
        d3.select(this).select("circle").transition()
            .duration(300)
            .attr("r", gettransr);
    };

    var nodemouseout = function () {
        infobox.transition()
            .duration(300)
            .style("opacity", 0);
        d3.select(this).select("circle").transition()
            .duration(300)
            .attr("r", getdefaultr);
    };

    var clickednode = undefined;
    var nodemouseclick = function(n) {
        if (clickednode === undefined) {
            clickednode = d3.select(this);
            infobox.html(formatInfoStr(n));
            infobox.transition()
                .duration(300)
                .style("opacity", .9);
            clickednode.select("circle").transition()
                .duration(300)
                .attr("r", gettransr);

        } else {
            infobox.transition()
                .duration(300)
                .style("opacity", 0)
            clickednode.select("circle").transition()
                .duration(300)
                .attr("r", getdefaultr);                
            clickednode = undefined;
        }
    };

    var redraw = this.redraw = function() {
        // data join
        link = link.data(links);

        // enter
        link.enter().append("line")
                .attr("class", "edge");

        // data join
        node = node.data(nodes);

        // enter
        var g = node.enter().append("g");
        if (clickevents) {
            g.on("click", nodemouseclick)
                .call(force.drag);
        } else {
            g.on("mouseover", nodemouseover)
                .on("mouseout", nodemouseout)
                .call(force.drag);
        }

        g.append("circle")
            .attr("r", getdefaultr);

        g.append("text")
            .attr("class", "label")
            .attr("dx", 10)
            .attr("dy", ".15em");

        // enter + update
        node.selectAll("text").text(getName);

        node.attr("class", function(n) {
            switch (n.type) {
            case 'internet':
                return 'node i-node';
                break;

            case 'local':
                return 'node localhost-node';
                break;

            case 'peer':
                return 'node peer-node';
                break;

            case 'gw':
                return 'node gw-node';
                break;      
            default:
                return 'node';
            }
        });

        force.start();
    };

    // redraw to init
    redraw();
}; // NetGraph

NetGraph.prototype.addNode = function(newnode) {
    var that = this;

    // check if we already know this node ?
    var node = _.find(that.nodes, function(n) {
        return ((n.ipv4!==undefined && n.ipv4 === newnode.ipv4) || 
                (n.ipv6!=undefined && n.ipv6 === newnode.ipv6) ||
                (n.type === 'local' && newnode.ipv4 === '127.0.0.1'));
    });

    if (!node) {
        // new node !
        console.log('newnode',newnode);
        node = newnode;
        node.id = that.nodeid++;

        switch (node.type) {
        case 'internet':
            // fix the internet node to top of the graph
            node.x = that.width*0.5;
            node.y = that.height*0.1;
            node.fixed = true;
            that.internet = node;
            break;

        case 'local':
            that.localnode = node;
            break;
        }
        that.nodes.push(node);

    } else {
        console.log('updatenode',node);
        console.log('updatenode with',newnode);

        switch (newnode.type) {
        case 'local':
            // override previous (mdns/upnp/fathom) info with local
            node.type = 'local';
            node.rpc = node.rpc || newnode.rpc;
            node.reachable = node.reachable || newnode.reachable;
            node.raw = _.extend(node.raw, newnode.raw);
            that.localnode = node;
            break;

        case 'gw':
            node.type = 'gw'; // peer turns into gw
            node.rpc = node.rpc || newnode.rpc;
            node.reachable = node.reachable || newnode.reachable;
            node.raw = _.extend(node.raw, newnode.raw);
            break;

        case 'peer':
            // keep original type
            node.rpc = node.rpc || newnode.rpc;
            node.reachable = node.reachable || newnode.reachable;
            node.raw = _.extend(node.raw, newnode.raw);
            break;
        }
    }

    // update links
    var gws = _.filter(that.nodes, function (n) { return (n.type === 'gw'); });
    _.each(gws, function(gw) {
        // local - > gw
        if (that.localnode && gw.reachable && !that.hasEdge(that.localnode, gw)) {
            that.addEdge(that.localnode, gw);
        }

        // gw -> internet
        if (that.internet && (gw.internet_reachable || that.internet.reachable) && !that.hasEdge(gw, that.internet)) {
            that.addEdge(gw, that.internet);
        }
    }); 

    // check peer connections (after basic network is there)
    if (gws.length > 0 && that.localnode && that.internet) {
        // loop over peers
        _.each(_.filter(that.nodes, function (n) { return (n.type === 'peer'); }), function(peer) {            
            if (!that.isConnected(peer)) {
                console.log('check peer', peer);

                var longestgw = undefined;
                var bitsv4 = 0;
                var bitsv6 = 0;

                // do longest prefix match to find the correct gw
                _.each(gws, function(gw) {
                    if (peer.ipv4 && gw.ipv4) {
                        var bits = 32;
                        while (bits >= bitsv4) {
                            var addr = ipaddr.parse(peer.ipv4);
                            var range = ipaddr.parse(gw.ipv4);
                            if (addr.match(range, bits)) {
                                bitsv4 = bits;
                                longestgw = gw;
                                bits = 0;
                            }
                            bits -= 1;
                        }
                    } else if (peer.ipv6 && gw.ipv6) {
                        var bits = 64;
                        while (bits >= bitsv6) {
                            var addr = ipaddr.parse(peer.ipv6);
                            var range = ipaddr.parse(gw.ipv6);
                            if (addr.match(range, bits)) {
                                bitsv6 = bits;
                                longestgw = gw;
                                bits = 0;
                            }
                            bits -= 1;
                        }
                    } // else dunno how to match
                });
                console.log('longest', longestgw);

                if (longestgw && (bitsv6 > 0 || bitsv4 > 0)) {
                    that.addEdge(peer, longestgw);
                }
            }
        });
    }
};

/** Connect nodes a and b. */
NetGraph.prototype.addEdge = function(a, b) {
    this.links.push({
        source : a,
        target : b
    });
};

/** Are nodes a and b connected ? */
NetGraph.prototype.hasEdge = function(a, b) {
    return (_.find(this.links, function(e) {
        return ((e.source.id === a.id &&
                 e.target.id === b.id) ||
                (e.source.id === b.id &&
                 e.target.id === a.id));
    }) !== undefined);
};

/** Is node connected to some other node ? */
NetGraph.prototype.isConnected = function(a) {
    return (_.find(this.links, function(e) {
        return (e.source.id === a.id ||
                e.target.id === a.id);
    }) !== undefined);
};

window.onload = function() {
    var fathom = fathom || window.fathom;
    if (!fathom)
        throw "Fathom not found";

    $('#canvas').empty();
    $('#waitspin').show();

    var utemplate = document.getElementById('uploadtemplate').innerHTML;
    Mustache.parse(utemplate);
    var renderu = function(params) {
        var rendered = Mustache.render(utemplate, params);
        var e = document.getElementById('upload');
        e.innerHTML = rendered;        
    };    

    // check the upload prefs
    fathom.internal(function(pref) {
        if (pref !== 'askme') {
            renderu({upload : (pref === 'always'), ready : false });
        }
    }, 'getuserpref', 'homenetupload');

    fathom.init(function() {
        var ts = new Date(); // starttime
        var startts = window.performance.now();

        // FIXME: mobile flag + adjust width ?
        var g = new NetGraph('#canvas', false, 650);

        var done = function() {
            var elapsed = (window.performance.now() - startts); // ms
            $('#waitspin').hide();

            // get raw data
            var json = _.map(g.nodes, function(o) {
                // remove UI related keys from the json data
                return _.omit(o,
                  "id",
                  "index",
                  "weight",
                  "x",
                  "y",
                  "px",
                  "py",
                  "fixed");
            });
                    
            fathom.internal(function(userok) {
                renderu({upload : userok, ready : true});
                $("#showdata").click(function() {
                    var win = window.open("../rawdata.html");
                    setTimeout(function() { win.json = json; },0);
                });
            }, 'upload', { 
                ts : ts.getTime(),
                timezoneoffset : ts.getTimezoneOffset(),
                elapsed : elapsed,
                results : json
            }); // upload

            setTimeout(function() { fathom.close(); }, 0);
        };

        // local discovery
        fathom.tools.discovery(function(node) {
            if (node && node.type) {
                g.addNode(node);
                g.redraw();
                return;
            }

            // local stuff done, do more discovery
            fathom.tools.discovery(function(node) {
                if (node && node.type) {
                    g.addNode(node);
                    g.redraw();
                    return;
                }

                // get ArpCache and resolve MACs to manufacturers
                fathom.system.getArpCache(function(res) {
                    if (!res.error) {
                        var pending = res.result.length;                        
                       _.each(res.result, function(neigh) {
                            var node = _.find(g.nodes, function(n) {
                                return (n.ipv4!==undefined && n.ipv4 === neigh.address);
                            });

                            if (node) {
                                node.raw['arp'] = neigh;

                                fathom.tools.lookupMAC(function(lookupres) {
                                    console.log(lookupres);
                                    if (lookupres && !lookupres.error) {
                                        node.raw['devinfo'] = lookupres;
                                    }

                                    pending -= 1;
                                    if (pending <= 0) {
                                        done();
                                    }
                               }, neigh.mac);

                            } else {
                                pending -= 1;
                                if (pending <= 0) {
                                    done();
                                }
                            }
                        });
                    } else {
                        done();
                    }
                });
            }, 10, ['ping','mdns','upnp']);  // disc using networking protos
        }, 5, ['local','internet','route']); // disc based on local info
    }); // init
}; // onload