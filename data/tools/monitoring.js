/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverview Monitoring graphs.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

// y-axis metrics
const ylabels = {
    'cpu' :     'utilization',
    'load' :    'load',
    'tasks' :   'count',
    'mem' :     'bytes',
    'traffic' : 'bit/s',
    'wifi' :    'quality',
    'rtt' :     'ms',
    'pageload' :'count',
    'pageload_delay' :'ms'
};

// map metric group to series and their labels
// defines the line ordering too
const linelabels = {
    'tasks' : {
		'tasks_total' : "All", 
		'tasks_sleeping' : 'Sleeping',
		'tasks_running' : 'Running' 
    },
    'load' : {
		'loadavg_onemin' : '1-min', 
		'loadavg_fivemin' : '5-min', 
		'loadavg_fifteenmin' : '15-min'
    },
    'cpu' : {
		'cpu_idle' : 'Idle',
		'cpu_user' : 'User', 
		'cpu_system' : 'System'
    },
    'mem' : {
		'mem_total' : 'Available', 
		'mem_used' : 'Used', 
		'mem_free' : 'Free', 
		'mem_ff' : 'Used by Firefox'
    },
    'wifi' : {
		'wifi_signal' : 'Signal',
		'wifi_noise' : 'Noise',
		'wifi_quality' : 'Quality'
    },
    'traffic' : {
		'rx' : "Received", 
		'tx' : "Transmitted"
    },
    'rtt' : {
		'rtt1' : 'Home gateway (1st hop)', 
		'rtt2' : 'Access link (2nd hop)', 
		'rtt3' : 'ISP (3rd hop)', 
		'rttx' : 'Measurement server (in France)'
    },
    'pageload' : {
		'pageload_total' : 'Page Load', 
		'pageload_firstbyte' : 'Network Access',
		'pageload_dns' : 'DNS request'
    },
    'pageload_delay' : {
		'pageload_total_delay' : 'Page Load Time', 
		'pageload_firstbyte_delay' : 'Network (first byte)',
		'pageload_dns_delay' : 'DNS request' 
    }
}

var getxrange = function(range) {
    var max_x = new Date();
    var min_x = undefined;
    var iv = undefined;
    switch (range) {
    case "day":
		// beg of next hour
		max_x.setHours(max_x.getHours()+1,0);
		// -24h - 1sec ago
		min_x = new Date(max_x.getTime() - 24*60*60*1000 - 1000);  
		iv = 120;
		break;
    case "week":
		max_x.setDate(max_x.getDate()+1);
		min_x = new Date(max_x.getTime() - 7*24*60*60*1000 - 1000);
		iv = 600;
		break;
    case "month":
		max_x.setDate(max_x.getDate()+7);
		min_x = new Date(max_x.getTime() - 30*24*60*60*1000 - 1000);  
		iv = 3600;
		break;
    case "year":
		max_x.setMonth(max_x.getMonth()+1);
		min_x = new Date(max_x.getTime() - 365*24*60*60*1000 - 1000);  
		iv = 6*3600;
		break;
    }
    return [min_x,max_x,iv];
};

var drawemptychart = function(metric, width, height) {
    MG.data_graphic({
		error: 'No data available',
		chart_type: 'missing-data',
		missing_text: 'No data available',
		target: '#chart-'+metric,
		width: width || $('#chart-'+metric).width(),
		height: height || $('#chart-'+metric).width()/1.61,
		left: 30,
		right: 30,
		top: 30,
		bottom: 30
    });
};

var drawchart = function(metric, range, data) {
    var xrange = getxrange(range);

    var lines = _.map(_.keys(data), function(k) { 
		return linelabels[metric][k];
    });

    // array of array per line
    var linedata = _.map(_.keys(data), function(k) {
	var tmp = _.filter(data[k], function(d) {
	    // filter away non range values
	    return (d['date']>=xrange[0] && d['date']<=xrange[1]);
	});
	// add zeroes to hide gaps
	var res = [];
	var prev = undefined;
	var lim = 2*xrange[2]*1000; // twice the measurement iv (ms)
	_.each(tmp, function(v) {
	    if (prev && (v['date'].getTime()-prev['date'].getTime()) > lim) {
		// gap
		res.push({ 
		    date : new Date(prev['date'].getTime()+1000*xrange[2]/2),
		    value : null,
		    missing : true,
		    metric : prev['metric']});
		res.push({ 
		    date : new Date(v['date'].getTime()-1000*xrange[2]/2),
		    value : null,
		    missing : true,
		    metric : prev['metric']});
	    }
	    res.push(v);
	    prev = v;
	});
	return res;
    });

    if (linedata.length <= 0 || linedata[0].length <= 0)
	return;

    var isdelay = (metric === 'rtt' || metric === 'pageload_delay');

    var min_y = undefined;
    var max_y = undefined;
    if (metric === 'rtt') {
	min_y = 0.1;
	max_y = 10000;
    } else if (metric === 'pageload_delay') {
	min_y = 1;
	max_y = 30000;
    }
	

    MG.data_graphic({
	width: $('#chart-'+metric).width(),
	height: $('#chart-'+metric).width()/1.61,
	left: 80,
	right: 5,
	top: 20,
	bottom: (range==='year' ? 30 : 20),
	target: '#chart-'+metric,
	data: linedata,
	x_accessor: 'date',
	y_accessor: 'value',
	min_x: xrange[0],
	max_x: xrange[1],
	interpolate : 'linear',
	missing_is_undefined : true,
	min_y: min_y,
	max_y: max_y,
	y_autoscale: !isdelay,
	y_scale_type: (isdelay ? 'log' : 'linear'),
	format: ((metric === 'cpu' || metric === 'wifiq') ? 'percentage' : 'count'),
	area: false,
	y_label: ylabels[metric],
	y_extended_ticks: true,
	show_secondary_x_label : (range==='year'),
	legend : lines,
	legend_target : '#legend-'+metric,
	aggregate_rollover: true
    });
};

/** environment timeline */
var drawenvchart = function(range, data) {
    var xrange = getxrange(range);
    var datainrange = _.filter(data, function(d) {
		var ts = new Date(d.ts);
		return (ts>=xrange[0] && ts<=xrange[1]);
    });
    if (datainrange.length <= 0)
		return; // nothing to show

    var idx = 0;
    var envs = {};

    // add #num suffix to make labels unique
    var uniqlabel = function(label) {
		var t = _.find(envs, function(v) {
		    return (v.l === label || v.l === label+' [1]');
		});

		if (t) {
		    // two or more networks with the same label
		    if (!t.lidx) {
				t.lidx = 1
				t.l += ' ['+t.lidx+']'; // 1st
		    }
		    t.lidx += 1;
		    label += '['+t.lidx+']';
		} // else first with this label
		return label;
    };

    var ddata = _.map(datainrange, function(d) { 
		if (!envs[d.env_id]) {
		    idx += 1;
		    var e = { 
				id : idx, 
				l : 'Environment' + idx // name must be unique!
		    };

		    if (d.userlabel) {
				// user has given a label (unique by design)
				e.l = d.userlabel; 
		    } else if (d.ssid) {
				e.l = uniqlabel(d.ssid);
		    } else if (d.isp) {
				e.l = uniqlabel(d.isp);
		    }
		    envs[d.env_id] = e;
		}

		// for the graphic
		d.date = new Date(d.ts);
		d.y = envs[d.env_id].id;
		d.env = envs[d.env_id].l;
		return d;
    });

    // info box template, set the default text visible
    var infotemplate = document.getElementById('envinfotemplate').innerHTML;
    Mustache.parse(infotemplate);
    $('#info-env-default').show();
    $('#info-env').hide();

    MG.data_graphic({
		data: datainrange,
		chart_type: 'point',
		width: $('#chart-env').width(),
		height: 5*_.size(envs)+100,
		left: 20,
		right: 5,
		top: 50,
		bottom: (range==='year' ? 30 : 20),
		target: '#chart-env',
		min_y: 1,
		max_y: _.size(envs),
		min_x: xrange[0],
		max_x: xrange[1],
		color_range : ["#8a89a6", "#6b486b", "#d0743c", "#98abc5", "#7b6888", "#a05d56", "#ff8c00"],
		x_accessor: 'date',
		y_accessor: 'y',
	        y_axis: false,
		color_accessor:'env',
		color_type:'category',
		show_secondary_x_label : (range==='year'),
		legend : _.uniq(_.pluck(envs, 'l')),
		legend_target : '#legend-env',
		show_rollover_text: false,
		mouseclick: function(d, i) {
		    if (i>0 && d && d.point) {
				$('#info-env').html(
				    Mustache.render(
					infotemplate, 
					d.point));

				$('#userlabel-input').hide();
				$('#userlabel-input-error').hide();
				$('#userlabel-text').show();

				$('#userlabel-edit').click(function() {
				    $('#userlabel-input').toggle();
				    $('#userlabel-text').toggle();
				    $("#userlabel-text-input").prop('disabled', false);
				});

				$('#userlabel-cancel').click(function() {
				    $('#userlabel-input').toggle();
				    $('#userlabel-text').toggle();
				});

				$('#userlabel-save').click(function() {
				    var olde = d.point.env;
				    var newe = $('#userlabel-text-input').val();
				    if (newe && newe.length > 0 && olde !== newe) {
						// update in the baseline db, fails if not unique
						fathom.internal(function(res) {
						    if (res.error) {
							console.log(res);
							$('#userlabel-input-error').html('Not unique! Try again.');
							$('#userlabel-input').show();
							$('#userlabel-text').hide();
							$('#userlabel-input-error').show();
							return;
						    }

						    // update the graph
						    _.each(ddata, function(dd) { 
							if (dd.env_id === d.point.env_id) {
							    dd.env = newe;
							    dd.userlabel = newe;
							}
						    });
						    $('#userlabel-s').html(newe);

						    $('#userlabel-input').hide();
						    $('#userlabel-input-error').hide();
						    $('#userlabel-text').show();

						},'setenvlabel',[d.point.env_id, newe]);
				    } else {			       
						// did not change
						$('#userlabel-input').toggle();
						$('#userlabel-text').toggle();
				    }
				});
		    }

		    $('#info-env-default').toggle();
		    $('#info-env').toggle();
		}
    });
};

/** Get baseline data for the range and (re-)draw graphs. */
var loadgraphs = function(range) {    
    $('#info-env-default').hide();
    $('#info-env').hide();

	// make visible for rendering
	_.each(['env','page','net','sys'], function(g) {
		var asel = '#toggle'+g; // the toggle anchor
		var divsel = '#'+g;     // the div to hide/show
		if (!$(divsel).is(':visible')) {
			$(asel).children('.fa').removeClass('fa-plus-square-o');
			$(asel).children('.fa').addClass('fa-minus-square-o');
			$(divsel).show();
		}
	});

    // clear all figures and set to no data
    $('#chart-env').empty();
    drawemptychart('env', undefined, 100);

    _.each(_.keys(linelabels), function(metric) {
		$('#chart-'+metric).empty();
		drawemptychart(metric);
    });

    // upload preferences
    var utemplate = document.getElementById('uploadtemplate').innerHTML;
    Mustache.parse(utemplate);

    fathom.internal(function(prefs) {
		var rendered = Mustache.render(
		    utemplate, 
		    {
				upload : (prefs[0] === 'always'),
				uploadpl : (prefs[1] === 'always')
		    });
		var e = document.getElementById('upload');
		e.innerHTML = rendered;

		$("#showdata").click(function() {
		    fathom.internal(function(json) {
			var win = window.open("../rawdata.html");
			win.json = json;
		    },'getjson',['baseline']);
		});

		$("#showdatapl").click(function() {
		    fathom.internal(function(json) {
			var win = window.open("../rawdata.html");
			win.json = json;
		    },'getjson',['pageload']);
		});

    }, 'getuserpref', ['baselineupload','pageloadupload']);

    var error = function(err) {
		console.error(err);
		fathom.close();
		return;
    };

    // get the baselines
    fathom.init(function() {
		fathom.baseline.getEnv(function(res) {
		    if (res.error) 
				return error(res.error);
		    if (!res.data || res.data.length < 1)
				return error('not enough baseline env data');

		    drawenvchart(range, res.data);

		    fathom.baseline.get(function(res) {				
				if (res.error) 
				    return error(res.error);
				if (!res.data || res.data.length < 2) 
				    return error('not enough baseline measurement data');

				fathom.close();

				_.each(_.keys(linelabels), function(metric) {
				    var flatres = [];
				    var tmp = { tx : -1, rx : -1, txts : undefined, rxts : undefined };

				    _.each(res.data, function(sample) {
						_.each(linelabels[metric], function(stitle,sname) {
						    if (!sample[sname]) return; // ignore empty vals

						    var obj = {
								date : new Date(sample.ts),
								value : sample[sname],
								metric : sname
						    };

						    if (metric == 'cpu')
								obj.value = obj.value/100.0;

						    if (metric == 'traffic' && sname == 'tx') {
								if (tmp.txts && sample.ts-tmp.txts>0) {
								    // average cross-traffic bit/s
								    obj.value = ((sample[sname] - tmp.tx)*8.0)/(sample.ts - tmp.txts);
								} else {
								    obj = undefined;
								}
								tmp.tx = sample[sname];
								tmp.txts = sample.ts;
						    }

						    if (metric == 'traffic' && sname == 'rx') {
								if (tmp.rxts && sample.ts-tmp.rxts>0) {
								    // average cross-traffic bit/s
								    obj.value = ((sample[sname] - tmp.rx)*8.0)/(sample.ts - tmp.rxts);
								} else {
								    obj = undefined;
								}
								tmp.rx = sample[sname];
								tmp.rxts = sample.ts;
						    }

						    if (metric == 'wifi') {
						    	return; // FIXME
						    }

						    if (obj)
								flatres.push(obj);
						});
				    });

				    flatres = _.groupBy(flatres, 'metric');
				    setTimeout(drawchart,0,metric,range,flatres);
				});
				setTimeout(function() {
					// hide sys graphs by default
					$('#togglesys').children('.fa').removeClass('fa-minus-square-o');
					$('#togglesys').children('.fa').addClass('fa-plus-square-o');
					$('#sys').hide();
				},0);
		    }, range, ['cpu','load','tasks','mem','traffic','wifi','rtt','pageload','pageload_delay']); // getMetrics
		}, range); // getEnv
    });
};

$(window).load(function() {
    var fathom = fathom || window.fathom;
    if (!fathom)
		throw "Fathom not found";

	// time range button actions
    _.each(['day','month','week','year'], function(range) {
		$('#last'+range).click(function() {
		    // button styles
		    $('.pure-button-active').removeClass('pure-button-active');
		    $('#last'+range).addClass('pure-button-active');

		    // draw
		    loadgraphs(range);	
		});
    });

	// hide/show graph groups
	_.each(['env','page','net','sys'], function(g) {
		var asel = '#toggle'+g; // the toggle anchor
		var divsel = '#'+g;     // the div to hide/show
		$(asel).click(function() {
			if ($(divsel).is(':visible')) {
				$(asel).children('.fa').removeClass('fa-minus-square-o');
				$(asel).children('.fa').addClass('fa-plus-square-o');
				$(divsel).hide();
			} else {
				$(asel).children('.fa').removeClass('fa-plus-square-o');
				$(asel).children('.fa').addClass('fa-minus-square-o');
				$(divsel).show();
			}
		});
	});

    // default view last 24h
    loadgraphs('day');
});

