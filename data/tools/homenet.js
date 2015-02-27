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

    var formatInfoStr = function(n) {
        var name = n.name || 'Network Device';
        if (!name && n.raw['upnp']) {
	    if (n.raw['upnp'].iswin)
		name = "Windows Device";
	    else if (n.raw['upnp'].islinux)
		name = "Linux Device";
	    else if (n.raw['upnp'].isdarwin)
		name = "Mac Device";
        }
        
        if (!name && n.raw['mdns']) {
	    if (n.raw['mdns'].iswin)
		name = "Windows Device";
	    else if (n.raw['mdns'].islinux)
		name = "Linux Device";
	    else if (n.raw['mdns'].isdarwin)
		name = "Mac Device";
        }

        var res = "<h5 class=\"upper\">"+name+"</h5><p><ul>";
	switch (n.type) {
	case 'local':    
	    res += "<li>Hostname: "+n.raw['local'].hostname+"</li>";
	    res += "<li>IP: "+n.address+"</li>";
	    break;
	case 'peer':    
	    res += "<li>IP: "+n.address+"</li>";
	    break;
	case 'gw':
	    res += "<li>IP: "+n.address+"</li>";
	    break;
	case 'internet':
	    res += "<li>Public IP: "+n.address+"</li>";
	    res += "<li>ISP: "+n.raw['internet'].isp+"</li>";
	    res += "<li>Location: "+n.raw['internet'].city+
		", "+n.raw['internet'].country+"</li>";
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
        .style('top', '10px')
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

    var force =	d3.layout.force()
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

    var defaultr = 0.04 * width;

    var nodemouseover = function(n) {
	infobox.html(formatInfoStr(n));
	infobox.transition()
	    .duration(300)
	    .style("opacity", .9);

	d3.select(this).select("circle").transition()
	    .duration(300)
	    .attr("r", defaultr+defaultr/3);
    };
 
    var nodemouseout = function () {
	infobox.transition()
	    .duration(300)
	    .style("opacity", 0)

	d3.select(this).select("circle").transition()
	    .duration(300)
	    .attr("r", defaultr);
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
		.attr("r", defaultr+defaultr/3);
	} else {
	    infobox.transition()
		.duration(300)
		.style("opacity", 0)
	    
	    clickednode.select("circle").transition()
		.duration(300)
		.attr("r", defaultr);
	    clickednode = undefined;
	}
    };

    var redraw = this.redraw = function() {
	// data join
	link = link.data(links);

	// enter
	link.enter().append("line")
            .attr("class", "edge"); // TODO: wireless or fixed link ?

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
            .attr("r", function(d) { return defaultr; });
	
	g.append("text")
            .attr("class", "label")
            .attr("dx", 10)
            .attr("dy", ".15em");

	// enter + update
        node.selectAll("text").text(function(n) {
	    return n.name;
	});

	node.attr("class", function(n) {
	    return "node " + n.cssstyle;
	});

	force.start();
    };

    // redraw to init
    redraw();
}; // NetGraph

NetGraph.prototype.addNode = function(newnode) {
    var that = this;

    console.log(newnode);

    // check if we already know this node ?
    var node = _.find(that.nodes, function(n) {
	return (n.address === newnode.address);
    });

    if (!node) {
	// new node
	node = newnode;
	node.id = that.nodeid++;
	switch (node.type) {
	case 'internet':
	    // fix the internet node to top of the graph
	    node.x = that.width*0.5;
	    node.y = that.height*0.1;
	    node.fixed = true;
	    node.cssstyle = 'i-node';
	    that.internet = node;
	    break;

	case 'local':
	    node.cssstyle = 'localhost-node';
	    that.localnode = node;
	    break;

	case 'peer':
	    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'peer-node';
	    break;

	case 'gw':
	    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'gw-node';
	    break;	    

	}
	that.nodes.push(node);

    } else {
	switch (newnode.type) {
	case 'local':
	    // override previous (mdns/upnp/fathom) info with local
	    node.type = 'local';
	    node.name = newnode.name;
	    node.rpc = newnode.rpc;
	    node.reachable = newnode.reachable;
	    node.cssstyle = 'localhost-node';
	    node.raw = _.extend(node.raw, newnode.raw);
	    that.localnode = node;
	    break;

	case 'peer':
	    if (node.type !== 'local') {
		// update missing values
		node.name = node.name || newnode.name;
		node.rpc = node.rpc || newnode.rpc;
		node.reachable = node.reachable || newnode.reachable;
	        if (node.type !== 'gw') {
		    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'peer-node';
                }
	    }
	    node.raw = _.extend(node.raw, newnode.raw);
	    break;

	case 'gw':
	    node.type = newnode.type; // peer turns into gw
	    node.name = node.name || newnode.name;
	    node.rpc = node.rpc || newnode.rpc;
	    node.reachable = node.reachable || newnode.reachable;
	    node.raw = _.extend(node.raw, newnode.raw);
	    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'gw-node';
	    break;

	case 'internet':
	    // should not happen (we only get single update for i-node)
	    break;
	}
    }

    // links
    switch (node.type) {
    case 'peer':
	// connect peer to each gw
	_.each(that.nodes, function(n) {
	    // FIXME: check that the IP subnets match
	    if ((n.type === 'gw') &&
		!that.hasEdge(node,n)) 
	    {
		that.addEdge(node,n);
	    }
	});
	break;

    case 'gw':
	// connect gw to each peer
	_.each(that.nodes, function(n) {
	    // FIXME: check that the IP subnets match
	    if ((n.type === 'peer') &&
		!that.hasEdge(node,n)) 
	    {
		that.addEdge(node,n);
	    }
	});
	break;

    case 'local':
	break;

    case 'internet':
	break;
    }

    // check for default gateway link
    if (that.localnode && !that.defaultgw) {
	var gwip = that.localnode.raw['local'].networkenv.gateway_ip;
	var gw = _.find(that.nodes, function(n) {
	    return (n.type === 'gw' &&
		    n.address === gwip);
	});

	if (gw) {
	    that.defaultgw = gw;
            // link to gw if reachable (from some discovery proto) or in the routing table
	    if ((gw.reachable || gw.raw['route']) && !that.hasEdge(that.localnode,gw))
		that.addEdge(that.localnode,gw);
	}
    }

    // check for internet link
    if (that.defaultgw && 
	(that.defaultgw.reachable || that.defaultgw.raw['route']) && 
	that.internet && 
	that.internet.reachable && 
	!that.hasEdge(that.internet,that.defaultgw)) 
    {
	that.addEdge(that.internet,that.defaultgw);
    }
};

NetGraph.prototype.addEdge = function(a, b) {
    this.links.push({
	source : a,
	target : b
    });
};

NetGraph.prototype.hasEdge = function(a, b) {
    return (_.find(this.links, function(e) {
	return ((e.source.address === a.address &&
		 e.target.address === b.address) ||
		(e.source.address === b.address &&
		 e.target.address === a.address))
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
    fathom.internal(function(pref) {
	var rendered = Mustache.render(
	    utemplate, 
	    {upload : (pref === 'always'), ready : false });
	var e = document.getElementById('upload');
	e.innerHTML = rendered;
    }, 'getuserpref', 'homenetupload');

    fathom.init(function() {
	var ts = new Date(); // starttime
	var startts = window.performance.now();

	// FIXME: mobile flag + adjust width ?
	var g = new NetGraph('#canvas', false, 640);

	// start the remote API for discovering other Fathoms
	fathom.tools.remoteapi.start(function() {});

	fathom.tools.discovery(function(node) {
	    if (node.type) {
		g.addNode(node);
		g.redraw();
	    } else {
		// all done
		var elapsed = (window.performance.now() - startts); // ms
		$('#waitspin').hide();

		// contains lots of duplicate info, strip down before upload
		if (g.localnode && g.localnode.raw['fathom']) {
		    g.localnode.raw['fathom'] = {
			"address" : g.localnode.raw['fathom'].address,
			"descriptor" : {
			    "fathom_node_id" : g.localnode.raw['fathom'].descriptor.fathom_node_id
			}
		    };
		}

		// get raw data
		var json = _.map(g.nodes, function(o) {
		    // remove UI related keys from the uploaded data
		    return _.omit(o,
				  "id",
				  "cssstyle",
				  "index",
				  "weight",
				  "x",
				  "y",
				  "px",
				  "py",
				  "fixed");
		})
		
		// queue for upload
		fathom.internal(function(userok) {
		    // update the upload block
		    var rendered = Mustache.render(
			utemplate, 
			{upload : userok, ready : true});
		    var e = document.getElementById('upload');
		    e.innerHTML = rendered;

		    // enable the data link
		    $("#showdata").click(function() {
			var win = window.open("../rawdata.html");
			win.json = json;
		    });


		    // stop using the extension
		    fathom.tools.remoteapi.stop(function() {});
		    fathom.close();
		    
		}, 'upload', { 
		    ts : ts.getTime(),
		    timezoneoffset : ts.getTimezoneOffset(),
		    elapsed : elapsed,
		    results : json
		});
	    }
	}); // disc	
    }); // init
};

