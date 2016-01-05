/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Host whitelist page script.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
window.onload = function() {
    $("#save").click(function() {
        var whitelist = [];
        $("input:checkbox").each(function() {
            var $this = $(this);
            whitelist.push({
                host : $this.attr("id"),
                disabled : !($this.is(":checked"))
            });
        });
        window.fathom.internal(function(done) {
    	    alert("Changes saved!");
	      }, 'setwhitelist', whitelist);
    });
    
    window.fathom.internal(function(res) {
      var template = $('#template').html();
      Mustache.parse(template);
      var rendered = Mustache.render(template, { whitelist : res });
      $('#rendertarget').html(rendered);
    }, 'getwhitelist');
};