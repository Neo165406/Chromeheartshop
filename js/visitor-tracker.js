// js/visitor-tracker.js
// Anonymous visitor counter. Each phone / browser gets ONE random ID (kept in
// localStorage) and one Firestore document: /visitors/<id>. No names, phone
// numbers or emails are stored. The numbers are only readable from the admin
// "Visitors" tab (firestore.rules -> isAdmin()).
//
// Loaded on every public page by js/footer.js. It does NOT run on admin pages,
// skips bots, and skips any device that ticked "Don't count this device" in the
// admin Visitors tab.

import { db, doc, setDoc, serverTimestamp } from './firebase-config.js';
import { increment } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

var SESSION_GAP_MS = 30 * 60 * 1000; // a new "visit" = 30+ minutes since the last page view

function newId(){
  if(window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function deviceType(ua){
  if(/android/i.test(ua)) return 'Android';
  if(/iphone|ipad|ipod/i.test(ua)) return 'iOS';
  if(/windows|macintosh|linux|cros/i.test(ua)) return 'Desktop';
  return 'Other';
}

// Where the visitor came from: the referrer's host (e.g. google.com), or "direct".
function visitSource(){
  try{
    if(!document.referrer) return 'direct';
    var host = new URL(document.referrer).hostname.replace(/^www\./, '');
    var own = location.hostname.replace(/^www\./, '');
    return (host && host !== own) ? host.slice(0, 100) : 'direct';
  }catch(e){
    return 'direct';
  }
}

async function track(){
  var ua = navigator.userAgent || '';
  if(navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|headless/i.test(ua)) return;
  if(/admin/i.test(location.pathname)) return;

  var id, first, newVisit;
  try{
    if(localStorage.getItem('fs_no_track') === '1') return;
    id = localStorage.getItem('fs_device_id');
    if(!id){
      id = newId();
      localStorage.setItem('fs_device_id', id);
      localStorage.setItem('fs_first_seen', String(Date.now()));
    }
    first = Number(localStorage.getItem('fs_first_seen')) || Date.now();
    var last = Number(localStorage.getItem('fs_last_seen')) || 0;
    newVisit = !last || (Date.now() - last) > SESSION_GAP_MS;
    localStorage.setItem('fs_last_seen', String(Date.now()));
  }catch(e){
    return; // storage blocked -> can't tell devices apart, so don't count
  }

  var data = {
    firstSeen: first,
    lastSeen: serverTimestamp(),
    lastPage: (location.pathname + location.search).slice(0, 300),
    device: deviceType(ua)
  };
  if(newVisit){
    data.visits = increment(1);
    data.source = visitSource();
  }
  await setDoc(doc(db, 'visitors', id), data, { merge: true });
}

track().catch(function(e){
  console.error('visitor-tracker error:', (e && e.code) ? e.code + ' — ' + e.message : e);
});
