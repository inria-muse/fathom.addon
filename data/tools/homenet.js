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
	var res = "<h5>"+n.name+"</h5>"+
	    "<p><ul>"+
	    "<li>IP "+n.address+"</li>"+
	    "</ul></p>";
	return res;
    };

    // SVG canvas
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
	.style("position", "relative")
	.append("div")
        .attr("class", "infofloat")
        .style("opacity", 0);

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
	    infobox.html(formatInfoStr(n));
	    infobox.transition()
		.duration(100)
		.style("opacity", .9);

	    clickednode = d3.select(this);
	    clickednode.select("circle").transition()
		.duration(100)
		.attr("r", defaultr+defaultr/3);
	} else {
	    infobox.transition()
		.duration(100)
		.style("opacity", 0)
	    
	    clickednode.select("circle").transition()
		.duration(100)
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
	    return n.cssstyle;
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
	return (n.address == newnode.address);
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
	    var tmpnode = node;
	    node = newnode;
	    node.cssstyle = 'localhost-node';
	    node.raw = _.extend(node.raw, tmpnode.raw);
	    that.localnode = node;
	    break;
	case 'peer':
	    // keep old values unless missing
	    node.name = node.name || newnode.name;
	    node.rpc = node.rpc || newnode.rpc;
	    node.reachable = node.reachable || newnode.reachable;
	    node.raw = _.extend(node.raw, newnode.raw);
	    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'peer-node';
	    break;
	case 'gw':
	    node.type = newnode.type; // peer turns into gw
	    // for others keep old values unless missing
	    node.name = node.name || newnode.name;
	    node.rpc = node.rpc || newnode.rpc;
	    node.reachable = node.reachable || newnode.reachable;
	    node.raw = _.extend(node.raw, newnode.raw);
	    node.cssstyle = (node.rpc ? 'rpc-' : '') + 'gw-node';
	    break;
	case 'internet':
	    // should not happen (we only get single update for i-node)
	    that.internet = node;
	    break;
	}
    }

    // links
    switch (node.type) {
    case 'peer':
	// connect peer to gw
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
	// connect gw to peer(s)
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

    // check default gw when local or gw updates take place
    if (node.type !== 'peer' &&
	node.type !== 'internet' &&
	that.localnode) 
    {
	var gwip = that.localnode.raw['local'].networkenv.gateway_ip;
	var gw = _.find(that.nodes, function(n) {
	    return (n.type === 'gw' &&
		    n.address === gwip);
	});
	if (gw) {
	    that.defaultgw = gw;
	    if (gw.reachable && !that.hasEdge(that.localnode,gw))
		that.addEdge(that.localnode,gw);
	}
    }

    // check internet conn updates
    if (node.type !== 'peer' &&
	that.defaultgw && that.defaultgw.reachable && 
	that.internet && that.internet.reachable && 
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

    fathom.init(function() {
	var ts = new Date(); // starttime
	var startts = window.performance.now();
	var results = [];

	// FIXME: mobile flag + adjust width ?
	var g = new NetGraph('#canvas', false, 640);

	fathom.tools.discovery(function(node) {
	    if (node.type) {
		results.push(node);
		g.addNode(node);
		g.redraw();
	    } else {
		// all done
		var elapsed = (window.performance.now() - startts); // ms
		fathom.uploaddata({ 
		    ts : ts.getTime(),
		    timezoneoffset : ts.getTimezoneOffset(),
		    elapsed : elapsed,
		    results : _.map(results,function(o) {
			// remove UI related keys from the data
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
		});
		fathom.close();
	    }
	}); // disc	
    }); // init
};

