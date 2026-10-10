// js/admin-reviews.js — "Reviews" tab for the admin panel.
// Lists every customer review and lets the admin delete any of them.
//
// It adds its own tab + panel to admin.html, so admin.html only needs this line
// at the very end of <body> (after the other scripts):
//   <script type="module" src="./js/admin-reviews.js"></script>
//
// Deleting needs the logged-in admin's UID to exist in Firestore → "admins"
// collection (firestore.rules → isAdmin()).

import { db, collection, getDocs, deleteDoc, doc } from './firebase-config.js';

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

function fmtDate(ms){
  if(!ms) return '';
  try{ return new Date(ms).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
  catch(e){ return ''; }
}

function stars(n){
  n = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// ---------- inject tab + panel ----------
const tabsBar = document.querySelector('.tabs');
const dash = document.getElementById('dash');

if(tabsBar && dash && !document.getElementById('reviewsPanel')){
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.panel = 'reviewsPanel';
  tab.textContent = 'Reviews';
  // place it just before "Settings" if present, else at the end
  const settingsTab = tabsBar.querySelector('[data-panel="settingsPanel"]');
  if(settingsTab) tabsBar.insertBefore(tab, settingsTab);
  else tabsBar.appendChild(tab);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'reviewsPanel';
  panel.innerHTML = `
    <div class="card-form">
      <h3>Customer reviews</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.5;">Reviews customers post on product pages. Delete any review you don't want shown.</p>
      <div class="field" style="margin-top:14px;margin-bottom:0;">
        <label>Show</label>
        <select id="rvAdminFilter"><option value="">All products</option></select>
      </div>
      <p class="status-msg" id="rvAdminStatus"></p>
    </div>
    <div class="list" id="rvAdminList"></div>`;
  const settingsPanel = document.getElementById('settingsPanel');
  if(settingsPanel) dash.insertBefore(panel, settingsPanel);
  else dash.appendChild(panel);

  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    loadReviews();
  });

  document.getElementById('rvAdminFilter').addEventListener('change', render);
}

// ---------- data ----------
let allReviews = [];
let productNames = {};

async function loadReviews(){
  const list = document.getElementById('rvAdminList');
  const status = document.getElementById('rvAdminStatus');
  if(!list) return;
  status.textContent = '';
  list.innerHTML = 'Loading...';
  try{
    const [rSnap, pSnap] = await Promise.all([
      getDocs(collection(db, 'reviews')),
      getDocs(collection(db, 'products'))
    ]);
    productNames = {};
    pSnap.docs.forEach(d => { productNames[d.id] = d.data().name || d.id; });
    allReviews = rSnap.docs
      .map(d => ({ id: d.id, ...d.data(), ms: toMs(d.data().createdAt) }))
      .sort((a, b) => b.ms - a.ms);

    // rebuild the product filter (keep current choice if still valid)
    const sel = document.getElementById('rvAdminFilter');
    const prev = sel.value;
    const ids = Array.from(new Set(allReviews.map(r => r.productId).filter(Boolean)));
    sel.innerHTML = '<option value="">All products</option>' + ids.map(id =>
      `<option value="${esc(id)}">${esc(productNames[id] || id)} (${allReviews.filter(r => r.productId === id).length})</option>`
    ).join('');
    sel.value = ids.includes(prev) ? prev : '';

    render();
  }catch(e){
    console.error('Admin reviews load failed:', e);
    list.innerHTML = '';
    status.textContent = 'Could not load reviews: ' + (e && e.code ? e.code + ' — ' : '') + (e && e.message ? e.message : e);
  }
}

function render(){
  const list = document.getElementById('rvAdminList');
  const status = document.getElementById('rvAdminStatus');
  const filter = document.getElementById('rvAdminFilter').value;
  const rows = filter ? allReviews.filter(r => r.productId === filter) : allReviews;

  if(!rows.length){
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;">No reviews yet.</p>';
    return;
  }
  list.innerHTML = '';
  rows.forEach(r => {
    const el = document.createElement('div');
    el.className = 'item';
    el.style.alignItems = 'flex-start';
    el.innerHTML = `
      <div class="info">
        <h4>${esc(r.name || 'Customer')} · <span style="color:var(--silver-bright);letter-spacing:1px;">${stars(r.rating)}</span></h4>
        <p>${esc(productNames[r.productId] || r.productId || 'Unknown product')} · ${esc(fmtDate(r.ms))}</p>
        <p style="margin-top:6px;color:var(--text);white-space:pre-line;word-wrap:break-word;overflow-wrap:anywhere;">${esc(r.comment || '')}</p>
      </div>
      <button class="del">Delete</button>`;
    el.querySelector('.del').addEventListener('click', async (e) => {
      if(!window.confirm('Delete this review by ' + (r.name || 'Customer') + '?')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      status.textContent = 'Deleting...';
      try{
        await deleteDoc(doc(db, 'reviews', r.id));
        allReviews = allReviews.filter(x => x.id !== r.id);
        status.textContent = 'Review deleted.';
        render();
      }catch(err){
        console.error('Admin review delete failed:', err);
        status.textContent = 'Could not delete: ' + (err && err.code ? err.code + ' — ' : '') + (err && err.message ? err.message : err)
          + (err && err.code === 'permission-denied' ? ' (your admin UID must be a document in the Firestore "admins" collection)' : '');
        btn.disabled = false;
      }
    });
    list.appendChild(el);
  });
}
