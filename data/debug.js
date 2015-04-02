/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
   */

/**
 * @fileoverfiew Debug page helper script to fetch and render stats 
 *               from the extension.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
 window.onload = function() {
    $("#upload").click(function() {
        window.fathom.internal(function() {
            alert("Done!");
        }, 'forceupload');
        location.reload();
    });

    $("#purge").click(function() {
        window.fathom.internal(function() {
            alert("Done!");
        }, 'purgeupload');
        location.reload();
    });

    window.fathom.internal(function(stats) {
        var robj = {
            components : _.map(_.keys(stats), function(k) {
                return { 
                    name : k,
                    data : _.map(stats[k], function(v,k) {
                        return { key : k, value : v};
                    })
                };
            })
        };

        var template = document.getElementById('rendertemplate').innerHTML;
        Mustache.parse(template);
        var rendered = Mustache.render(template, robj);

        var e = document.getElementById('rendertarget');
        e.innerHTML = rendered;
    }, 'getstats');
};
