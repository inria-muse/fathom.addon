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

var mediaelems = {};

function collectEvents(elem, video) {         
    var ts = new Date();
    var res = { 
        ts : ts.getTime(),
        timezoneoffset : ts.getTimezoneOffset(),
        media_src : elem.currentSrc.replace('mediasource:', ''),
        media_type: (video ? 'video' : 'audio'),
        events : {} 
    };

    var checkdone = function(reason) {
        if (!res.done) { 
            res.done = (reason !== 'pause');
            if (res.media_src.length>1)
                self.port.emit('perf', res); 
            res.events = {}; // in case of suspend, just empty the event queue
        }
    }

    function listenEvent(en) {
        elem.addEventListener(en, function(e) {
            var current = elem.currentSrc.replace('mediasource:','');
            if (current !== res.media_src) {
                checkdone('newsrc');

                // new video in the same player
                ts = new Date();
                res = { 
                    ts : ts.getTime(),
                    timezoneoffset : ts.getTimezoneOffset(),
                    media_src : current,
                    media_type: (video ? 'video' : 'audio'),
                    events : {} 
                };

                if (video) {
                    res.videoHeight = elem.videoHeight;
                    res.videoWidth = elem.videoWidth;
                }
            }

            let event = { 
                ts : new Date().getTime(), 
                buffered : (elem.buffered.length>0 ? [elem.buffered.start(elem.buffered.length-1),elem.buffered.end(elem.buffered.length-1)] : undefined),
                position : elem.currentTime,
                duration : elem.duration,
                volume : (elem.muted ? -1 : elem.volume), 
                playing : !!(elem.currentTime > 0 && !elem.paused && !elem.ended && elem.readyState > 2),
                readyState : elem.readyState,
                networkState : elem.networkState,
                eventdata : {}
            };

            if (video) {
                event.hasAudio = elem.mozHasAudio;
                event.parsedFrames = elem.mozParsedFrames;
                event.decodedFrames = elem.mozDecodedFrames;
                event.presentedFrames = elem.mozPresentedFrames;
                event.paintedFrames = elem.mozPaintedFrames;
                event.frameDelay = elem.mozFrameDelay;
                var q = elem.getVideoPlaybackQuality();
                event.quality = {
                    creationTime : q.creationTime,
                    totalVideoFrames : q.totalVideoFrames,
                    droppedVideoFrames : q.droppedVideoFrames,
                    corruptedVideoFrames : q.corruptedVideoFrames                    
                }  
            }

            if (en === 'loadedmetadata') {
                event.eventdata.channels = e.mozChannels;
                event.eventdata.sampleRate = e.mozSampleRate;
                event.eventdata.frameBufferLength = e.mozFrameBufferLength;
            }

            // this removes some of the duplicate events (that happen at the same time)
            res.events[event.ts] = event;

            if (en === 'ended' || en === 'error' || en === 'pause') {
                // distinquish user pause from pause at the end of the video
                if (event.duration - event.position < 0.0001)
                    en = 'ended';
                checkdone(en);
            }
        });
    };


    // these events are about the download, pretty verbose .. 
//    listenEvent("progress");
//    listenEvent("stalled");

    // playback updates, pretty verbose
//            listenEvent("timeupdate");


    listenEvent("loadstart");
    listenEvent("suspend");
    listenEvent("abort");
    listenEvent("error");            
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
    listenEvent("ratechange");
    listenEvent("durationchange");
    listenEvent("ended");
};

function findelems() {
    var vids = document.getElementsByTagName("video");
    for (var i = 0; i < vids.length; i++) {
        if (!mediaelems[vids[i].currentSrc]) {
            collectEvents(vids[i], true);
            mediaelems[vids[i].currentSrc] = true;
        }
    }

    var audios = document.getElementsByTagName("audio");
    for (var i = 0; i < audios.length; i++) {
        if (!mediaelems[audios[i].currentSrc]) {
            collectEvents(audios[i], false);
            mediaelems[audios[i].currentSrc] = true;
        }
    } 
}

setTimeout(function() {
    // stuff available onload
    findelems();

    // FIXME: is there a better way than to keep polling the page ?
    setInterval(findelems, 25);

}, 1);
