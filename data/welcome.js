/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2016 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew Welcome page script for user pref settings.
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
window.onload = function() {

  $("#baselineupload").change(function() {
  	var obj = {baselineupload:$("#baselineupload").is(":checked")};
  	window.fathom.internal(undefined, 'setuserpref', obj);
  });

  $("#enablebaseline").change(function() {
   var obj = {enablebaseline:$("#enablebaseline").is(":checked")};
   window.fathom.internal(undefined, 'setuserpref', obj);
 });

  $("#pageloadupload").change(function() {
   var obj = {baselineupload:$("#pageloadupload").is(":checked")};
   window.fathom.internal(undefined, 'setuserpref', obj);
 });

  $("#enablepageload").change(function() {
   var obj = {enablebaseline:$("#enablepageload").is(":checked")};
   window.fathom.internal(undefined, 'setuserpref', obj);
 });

  $("#enablefathomapi").change(function() {
   var obj = {enablefathomapi:$("#enablefathomapi").is(":checked")};
   window.fathom.internal(undefined, 'setuserpref', obj);
 });
};
