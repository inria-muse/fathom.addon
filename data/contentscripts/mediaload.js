/*
   Fathom - Browser-based Network Measurement Platform

   Copyright (C) 2011-2015 Inria Paris-Roquencourt 
                           International Computer Science Institute (ICSI)

   See LICENSE for license and terms of usage. 
*/

/**
 * @fileoverfiew A simple content script to fetch the html video
 * and audio elements performance metrics.
 *
 * @author Anna-Kaisa Pietilainen <anna-kaisa.pietilainen@inria.fr> 
 */
(function() {
    if (typeof self !== "undefined") {
        function collectEvents(elem, video) {         
            console.log(elem.baseURI);   

            var ts = new Date();
            var res = { 
                ts : ts.getTime(),
                timezoneoffset : ts.getTimezoneOffset(),
                base_uri : elem.baseURI,
                media_src : elem.currentSrc,
                media_type: (video ? 'video' : 'audio'),
                media_duration : elem.duration,
                events : {} 
            };

            function listenEvent(en) {
                elem.addEventListener(en, function(e) {
                    if (elem.currentSrc !== res.media_src) {
                        if (!res.done) {
                            console.log(res);
                            self.port.emit('perf', res);                            
                        }

                        // new video in the same player
                        ts = new Date();
                        res = { 
                            ts : ts.getTime(),
                            timezoneoffset : ts.getTimezoneOffset(),
                            base_uri : elem.baseURI,
                            media_src : elem.currentSrc,
                            media_type: (video ? 'video' : 'audio'),
                            media_duration : elem.duration,
                            events : {} 
                        };
                    }

                    let event = { 
                        ts : new Date().getTime(), 
                        buffered : (elem.buffered.length>0 ? [elem.buffered.start(elem.buffered.length-1),elem.buffered.end(elem.buffered.length-1)] : undefined),
                        position : elem.currentTime,
                        duration : elem.duration,
                        parsedFrames : elem.mozParsedFrames,
                        decodedFrames : elem.mozDecodedFrames,
                        presentedFrames : elem.mozPresentedFrames,
                        paintedFrames : elem.mozPaintedFrames,
                        frameDelay : elem.mozFrameDelay
                    };

                    console.log("video event " + en, JSON.stringify(event,null,4));
                    if (!res.events[en])
                        res.events[en] = [];    
                    res.events[en].push(event);

                    if (en === 'ended' || en === 'error') {
                        res.done = true;
                        console.log(res);
                        self.port.emit('perf', res);
                    }
                });
            };

            listenEvent("loadstart");
            listenEvent("progress"); // downloaded bytes
            listenEvent("suspend");
            listenEvent("abort");
            listenEvent("error");            
            listenEvent("stalled");
            listenEvent("play");
            listenEvent("pause");
            listenEvent("loadedmetadata");
            listenEvent("loadeddata"); // first data frame received
            listenEvent("waiting"); // no frames to play
            listenEvent("playing");
            listenEvent("canplay");
            listenEvent("canplaythrough");
            listenEvent("seeking");
            listenEvent("seeked");
//            listenEvent("timeupdate");
            listenEvent("ratechange");
            listenEvent("durationchange");
            listenEvent("ended");
        };

        setTimeout(function() {
            var vids = document.getElementsByTagName("video");
            for (var i = 0; i < vids.length; i++) {
                collectEvents(vids[i], true);
            }

            var audios = document.getElementsByTagName("audio");
            for (var i = 0; i < audios.length; i++) {
                collectEvents(audios[i], false);
            }
        }, 100);
    }
}());