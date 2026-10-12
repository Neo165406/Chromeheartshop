// js/admin-visitors.js — "Visitors" tab for the admin panel.
// Shows how many different phones / browsers visited the site (one random ID
// per device, written by js/visitor-tracker.js) and the most recent visitors.
//
// It adds its own tab + panel to admin.html (same pattern as admin-reviews.js)
// and is loaded from js/admin-reviews.js, so admin.html needs no change.
//
// Reading needs the logged-in admin's UID to exist in Firestore -> "admins"
// collection (firestore.rules -> isAdmin()), and the updated firestore.rules
// must be PUBLISHED in the Firebase console.

import { db, collection, getDocs, query, where, orderBy, limit } from './firebase-config.js';
import { getCountFromServer } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js';

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toMs(v){
  if(v == null) return 0;
  if(typeof v === 'number') return v;
  if(typeof v.toMillis === 'function') return v.toMillis();
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

function fmt(ms){
  if(!ms) return '-';
  try{ return new Date(ms).toLocaleString('en-GB', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }); }
  catch(e){ return '-'; }
}

function startOfDay(daysBack){
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysBack);
  return d;
}

function errText(e){
  return (e && e.code ? e.code + ' — ' : '') + (e && e.message ? e.message : e);
}

async function count(q){
  const snap = await getCountFromServer(q);
  return snap.data().count;
}

// ---------- inject tab + panel ----------
const tabsBar = document.querySelector('.tabs');
const dash = document.getElementById('dash');

if(tabsBar && dash && !document.getElementById('visitorsPanel')){
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.panel = 'visitorsPanel';
  tab.textContent = 'Visitors';
  // place it just before "Settings" if present, else at the end
  const settingsTab = tabsBar.querySelector('[data-panel="settingsPanel"]');
  if(settingsTab) tabsBar.insertBefore(tab, settingsTab);
  else tabsBar.appendChild(tab);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'visitorsPanel';
  panel.innerHTML = `
    <div class="card-form">
      <h3>Visitors</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.5;margin-bottom:14px;">Every phone or browser is counted once, using a random ID saved on that device. Clearing browser data or using private mode counts as a new device. Search bots are not counted.</p>
      <div class="stat-grid">
        <div class="stat-box"><div class="n" id="vsTotal">–</div><div class="l">Total devices</div></div>
        <div class="stat-box"><div class="n" id="vsNewToday">–</div><div class="l">New today</div></div>
        <div class="stat-box"><div class="n" id="vsToday">–</div><div class="l">Active today</div></div>
        <div class="stat-box"><div class="n" id="vsWeek">–</div><div class="l">Active last 7 days</div></div>
        <div class="stat-box" style="grid-column:1 / -1;"><div class="n" id="vsReturning">–</div><div class="l">Came back (2+ visits)</div></div>
      </div>
      <label style="display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--text-dim);margin-top:14px;cursor:pointer;">
        <input type="checkbox" id="vsIgnore" style="width:auto;"> Don't count this device (use on your own phone)
      </label>
      <p class="status-msg" id="vsStatus"></p>
    </div>
    <div class="list" id="vsList"></div>`;
  const settingsPanel = document.getElementById('settingsPanel');
  if(settingsPanel) dash.insertBefore(panel, settingsPanel);
  else dash.appendChild(panel);

  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    loadVisitors();
  });

  const ignoreBox = document.getElementById('vsIgnore');
  try{ ignoreBox.checked = localStorage.getItem('fs_no_track') === '1'; }catch(e){}
  ignoreBox.addEventListener('change', () => {
    try{
      if(ignoreBox.checked) localStorage.setItem('fs_no_track', '1');
      else localStorage.removeItem('fs_no_track');
    }catch(e){
      document.getElementById('vsStatus').textContent = 'Could not save this setting: ' + errText(e);
    }
  });
}

// ---------- data ----------
async function loadVisitors(){
  const list = document.getElementById('vsList');
  const status = document.getElementById('vsStatus');
  if(!list) return;
  status.textContent = '';
  list.innerHTML = 'Loading...';
  try{
    const col = collection(db, 'visitors');
    const todayStart = startOfDay(0);
    const weekStart = startOfDay(6);
    const [total, activeToday, activeWeek, newToday, returning, recent] = await Promise.all([
      count(col),
      count(query(col, where('lastSeen', '>=', todayStart))),
      count(query(col, where('lastSeen', '>=', weekStart))),
      count(query(col, where('firstSeen', '>=', todayStart.getTime()))),
      count(query(col, where('visits', '>=', 2))),
      getDocs(query(col, orderBy('lastSeen', 'desc'), limit(50)))
    ]);
    document.getElementById('vsTotal').textContent = total;
    document.getElementById('vsToday').textContent = activeToday;
    document.getElementById('vsWeek').textContent = activeWeek;
    document.getElementById('vsNewToday').textContent = newToday;
    document.getElementById('vsReturning').textContent = returning;

    if(recent.empty){
      list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;">No visitors recorded yet.</p>';
      return;
    }
    list.innerHTML = '';
    recent.docs.forEach(d => {
      const v = d.data();
      const el = document.createElement('div');
      el.className = 'item';
      el.style.alignItems = 'flex-start';
      el.innerHTML = `
        <div class="info">
          <h4>Device ${esc(d.id.slice(0, 6))} · ${esc(v.device || '-')}</h4>
          <p>${esc(v.visits || 1)} visit(s) · from ${esc(v.source || '-')}</p>
          <p style="word-wrap:break-word;overflow-wrap:anywhere;">${esc(v.lastPage || '-')} · ${esc(fmt(toMs(v.lastSeen)))}</p>
          <p>First seen: ${esc(fmt(toMs(v.firstSeen)))}</p>
        </div>`;
      list.appendChild(el);
    });
  }catch(e){
    console.error('Admin visitors load failed:', e);
    list.innerHTML = '';
    status.textContent = 'Could not load visitors: ' + errText(e)
      + (e && e.code === 'permission-denied' ? ' (publish the updated firestore.rules in the Firebase console, and make sure your admin UID is a document in the "admins" collection)' : '')
      + (e && e.code === 'failed-precondition' ? ' (open the link in the console error to create the missing index)' : '');
  }
}
