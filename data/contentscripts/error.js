/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Customize 'about:neterror' pages with Fathom debugtool
 * button.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */

var getQuery = function() {
    var queryString = document.baseURI.split('?')[1];
    var queries = queryString.split("&");
    var params = {}, temp;
    for (var i = 0; i < queries.length; i++ ) {
        temp = queries[i].split('=');
        params[temp[0]] = temp[1];
    }
    return params;
};

if (document.baseURI.indexOf('neterror')>0) {
  console.log('neterror: ' + document.baseURI);
  var b = document.getElementById('errorTryAgain');
  if (b) {	    
  	var fb = document.createElement("button"); 
  	fb.id = "errorRunFathom";
  	fb.style = "margin-left:15px;";
  	fb.onclick = function() { 
  	    self.port.emit('fathom', getQuery());
  	};
  	fb.innerHTML = "Debug My Connection with Fathom";
  	b.parentNode.insertBefore(fb, b.nextSibling);
  }
} // else some other error