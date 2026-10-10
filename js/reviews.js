// js/reviews.js — customer reviews under each product (product.html).
//
// Reviews live in the Firestore "reviews" collection, one document per
// customer per product (document id = "<productId>_<uid>", enforced by
// firestore.rules). Only signed-in customers can post; anyone can read.
//
// The server (api/product-page.js) normally embeds the existing reviews in
// the page, so the list shows instantly without the Firebase SDK. The SDK is
// only loaded when the reviews section scrolls near the screen (for the
// sign-in state + the form), or straight away if the server couldn't supply
// the reviews.

const STYLE_ID = 'reviewsStyle';
const PAGE_SIZE = 5;
const MIN_COMMENT = 5;
const MAX_COMMENT = 1000;
const MAX_NAME = 60;

let fbPromise = null;
function loadFb(){
  if(!fbPromise) fbPromise = import('./firebase-config.js');
  return fbPromise;
}

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function injectStyle(){
  if(document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
  .reviews{padding:6px 22px 40px;}
  .rv-summary{display:flex;align-items:center;gap:14px;margin-bottom:18px;}
  .rv-avg{font-family:'Fraunces',serif;font-size:36px;font-weight:500;color:var(--silver-bright);line-height:1;}
  .rv-stars{display:inline-flex;gap:2px;font-size:15px;line-height:1;}
  .rv-stars i{font-style:normal;color:var(--silver-deep);opacity:0.45;}
  .rv-stars i.on{color:var(--silver-bright);opacity:1;}
  .rv-count{font-size:12px;color:var(--text-dim);margin-top:5px;}
  .rv-empty{font-size:13.5px;color:var(--text-dim);}
  .rv-item{padding:16px 0;border-bottom:1px solid var(--line);}
  .rv-item-top{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px;}
  .rv-name{font-size:13px;font-weight:600;color:var(--silver-bright);}
  .rv-date{font-size:11.5px;color:var(--text-dim);flex-shrink:0;}
  .rv-text{font-size:13.5px;color:var(--text-dim);line-height:1.65;margin-top:8px;white-space:pre-line;word-wrap:break-word;overflow-wrap:anywhere;}
  .rv-more{display:block;width:100%;margin-top:16px;padding:12px 0;background:none;border:1px solid var(--line);color:var(--silver);border-radius:var(--radius);font-size:13px;font-weight:600;cursor:pointer;}
  .rv-formbox{margin-top:26px;padding:20px 18px;border:1px solid var(--line);border-radius:var(--radius);background:var(--bg-alt);}
  .rv-formbox h3{font-family:'Fraunces',serif;font-weight:500;font-size:16px;margin-bottom:14px;}
  .rv-note{font-size:13px;color:var(--text-dim);line-height:1.6;}
  .rv-note a,.rv-link{color:var(--silver-bright);text-decoration:underline;background:none;border:none;font-size:inherit;cursor:pointer;padding:0;}
  .rv-label{display:block;font-size:12px;color:var(--text-dim);margin:14px 0 6px;}
  .rv-input{width:100%;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:var(--radius);padding:12px;font-family:inherit;font-size:16px;line-height:1.5;}
  .rv-input:focus{outline:none;border-color:var(--silver);}
  textarea.rv-input{min-height:96px;resize:vertical;}
  .rv-pick{display:flex;gap:2px;margin-left:-4px;}
  .rv-pick button{background:none;border:none;font-size:30px;line-height:1;padding:2px 5px;color:var(--silver-deep);cursor:pointer;}
  .rv-pick button.on{color:var(--silver-bright);}
  .rv-submit{width:100%;margin-top:18px;}
  .rv-submit:disabled{opacity:0.5;cursor:not-allowed;}
  .rv-msg{font-size:12.5px;margin-top:12px;}
  .rv-msg.err{color:#e08a8a;}
  .rv-msg.ok{color:var(--silver-bright);}
  .rv-mini{display:inline-flex;align-items:center;gap:8px;font-size:12px;color:var(--text-dim);margin:2px 0 12px;}
  .rv-mini .rv-stars{font-size:13px;}
  `;
  document.head.appendChild(st);
}

function starsHTML(value){
  const filled = Math.round(value);
  let out = '';
  for(let i = 1; i <= 5; i++) out += `<i class="${i <= filled ? 'on' : ''}">★</i>`;
  return `<span class="rv-stars" role="img" aria-label="${esc(String(Math.round(value*10)/10))} out of 5 stars">${out}</span>`;
}

function toMs(v){
  if(v == null) return 0;
  if(typeof v === 'number') return v;
  if(typeof v.toMillis === 'function') return v.toMillis();
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}

function normalize(list){
  return (list || [])
    .map(r => ({
      id: r.id || '',
      uid: r.uid || '',
      name: String(r.name || 'Customer').slice(0, MAX_NAME),
      rating: Number(r.rating),
      comment: String(r.comment || ''),
      ms: toMs(r.createdAt != null ? r.createdAt : r.ms)
    }))
    .filter(r => Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5)
    .sort((a, b) => b.ms - a.ms);
}

function fmtDate(ms){
  if(!ms) return '';
  try{
    return new Date(ms).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });
  }catch(e){ return ''; }
}

export function mountReviews(product, root, initialReviews){
  if(!product || !product.id || !root) return;
  injectStyle();

  const previous = document.getElementById('reviews');
  if(previous) previous.remove();

  const sec = document.createElement('section');
  sec.className = 'reviews';
  sec.id = 'reviews';
  sec.innerHTML = `
    <div class="section-head"><h2 class="display">Customer Reviews</h2></div>
    <div id="rvSummary"></div>
    <div id="rvList"></div>
    <div id="rvForm"></div>`;
  const anchor = root.querySelector('section.collection');
  if(anchor && anchor.parentNode) anchor.parentNode.insertBefore(sec, anchor);
  else root.appendChild(sec);

  const elSummary = sec.querySelector('#rvSummary');
  const elList = sec.querySelector('#rvList');
  const elForm = sec.querySelector('#rvForm');

  const state = {
    reviews: Array.isArray(initialReviews) ? normalize(initialReviews) : null, // null = not loaded yet
    loadError: false,
    user: null,
    altName: '',
    authReady: false,
    authFailed: false,
    shown: PAGE_SIZE,
    pick: 0
  };

  // ---------- rating summary (+ small line under the price) ----------
  function stats(){
    const list = state.reviews || [];
    const n = list.length;
    const avg = n ? list.reduce((s, r) => s + r.rating, 0) / n : 0;
    return { n, avg };
  }

  function renderMini(){
    const old = root.querySelector('.rv-mini');
    if(old) old.remove();
    const { n, avg } = stats();
    if(!n) return;
    const price = root.querySelector('.p-price');
    if(!price) return;
    const a = document.createElement('a');
    a.className = 'rv-mini';
    a.href = '#reviews';
    a.innerHTML = `${starsHTML(avg)}<span>${(Math.round(avg * 10) / 10).toFixed(1)} · ${n} review${n === 1 ? '' : 's'}</span>`;
    price.insertAdjacentElement('afterend', a);
  }

  function renderSummary(){
    if(state.reviews === null){
      elSummary.innerHTML = `<p class="rv-empty">Loading reviews…</p>`;
      return;
    }
    const { n, avg } = stats();
    if(!n){
      elSummary.innerHTML = state.loadError
        ? `<p class="rv-empty">Reviews can't be loaded right now.</p>`
        : `<p class="rv-empty">No reviews yet — be the first to review this product.</p>`;
      return;
    }
    elSummary.innerHTML = `
      <div class="rv-summary">
        <div class="rv-avg">${(Math.round(avg * 10) / 10).toFixed(1)}</div>
        <div>${starsHTML(avg)}<div class="rv-count">${n} review${n === 1 ? '' : 's'}</div></div>
      </div>`;
  }

  function renderList(){
    const list = state.reviews || [];
    if(!list.length){ elList.innerHTML = ''; return; }
    const visible = list.slice(0, state.shown);
    elList.innerHTML = visible.map(r => `
      <div class="rv-item">
        <div class="rv-item-top"><span class="rv-name">${esc(r.name)}</span><span class="rv-date">${esc(fmtDate(r.ms))}</span></div>
        ${starsHTML(r.rating)}
        ${r.comment ? `<p class="rv-text">${esc(r.comment)}</p>` : ''}
      </div>`).join('')
      + (list.length > state.shown ? `<button type="button" class="rv-more" id="rvMore">Show more reviews</button>` : '');
    const more = elList.querySelector('#rvMore');
    if(more) more.addEventListener('click', () => { state.shown += PAGE_SIZE; renderList(); });
  }

  // ---------- the "write a review" area ----------
  function renderForm(){
    if(state.authFailed){
      elForm.innerHTML = `<div class="rv-formbox"><p class="rv-note">Reviews can't be submitted right now. Please try again later.</p></div>`;
      return;
    }
    if(!state.authReady || state.reviews === null){
      elForm.innerHTML = '';
      return;
    }
    if(!state.user){
      const next = encodeURIComponent('product.html?id=' + product.id);
      elForm.innerHTML = `<div class="rv-formbox"><h3 class="display">Write a review</h3>
        <p class="rv-note"><a href="account.html?next=${next}">Log in or create an account</a> to review this product.</p></div>`;
      return;
    }
    const mine = (state.reviews || []).find(r => r.uid === state.user.uid);
    if(mine){
      elForm.innerHTML = `<div class="rv-formbox"><p class="rv-note">Thanks — you've already reviewed this product. <button type="button" class="rv-link" id="rvDel">Delete my review</button></p><p class="rv-msg err" id="rvDelMsg" style="display:none;"></p></div>`;
      elForm.querySelector('#rvDel').addEventListener('click', deleteMine);
      return;
    }
    state.pick = 0;
    const prefill = state.user.displayName || state.altName || '';
    elForm.innerHTML = `
      <div class="rv-formbox">
        <h3 class="display">Write a review</h3>
        <span class="rv-label" style="margin-top:0;">Your rating</span>
        <div class="rv-pick" id="rvPick" role="radiogroup" aria-label="Rating">
          ${[1,2,3,4,5].map(v => `<button type="button" data-v="${v}" role="radio" aria-checked="false" aria-label="${v} star${v === 1 ? '' : 's'}">★</button>`).join('')}
        </div>
        <label class="rv-label" for="rvName">Your name</label>
        <input class="rv-input" id="rvName" type="text" maxlength="${MAX_NAME}" autocomplete="name" value="${esc(prefill)}">
        <label class="rv-label" for="rvText">Your review</label>
        <textarea class="rv-input" id="rvText" maxlength="${MAX_COMMENT}" placeholder="How was the quality, fit and finish?"></textarea>
        <button type="button" class="btn-solid rv-submit" id="rvSubmit">Submit review</button>
        <p class="rv-msg" id="rvMsg" style="display:none;"></p>
      </div>`;
    const pick = elForm.querySelector('#rvPick');
    pick.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-v]');
      if(!b) return;
      state.pick = Number(b.dataset.v);
      pick.querySelectorAll('button').forEach(x => {
        const on = Number(x.dataset.v) <= state.pick;
        x.classList.toggle('on', on);
        x.setAttribute('aria-checked', Number(x.dataset.v) === state.pick ? 'true' : 'false');
      });
    });
    elForm.querySelector('#rvSubmit').addEventListener('click', submitReview);
  }

  function formMsg(text, kind){
    const m = elForm.querySelector('#rvMsg');
    if(!m) return;
    m.className = 'rv-msg ' + (kind || '');
    m.textContent = text;
    m.style.display = text ? 'block' : 'none';
  }

  async function submitReview(){
    const btn = elForm.querySelector('#rvSubmit');
    const name = elForm.querySelector('#rvName').value.trim().slice(0, MAX_NAME);
    const comment = elForm.querySelector('#rvText').value.trim();
    if(!state.pick){ formMsg('Please choose a star rating.', 'err'); return; }
    if(!name){ formMsg('Please enter your name.', 'err'); return; }
    if(comment.length < MIN_COMMENT){ formMsg('Please write a few words about the product.', 'err'); return; }
    if(!state.user){ formMsg('Please log in first.', 'err'); return; }
    btn.disabled = true;
    formMsg('', '');
    try{
      const f = await loadFb();
      const uid = state.user.uid;
      const id = product.id + '_' + uid;
      await f.setDoc(f.doc(f.db, 'reviews', id), {
        productId: product.id,
        uid,
        name,
        rating: state.pick,
        comment,
        createdAt: f.serverTimestamp()
      });
      state.reviews = normalize([{ id, uid, name, rating: state.pick, comment, ms: Date.now() }].concat(state.reviews || []));
      state.loadError = false;
      renderAll();
    }catch(e){
      console.error('Posting review failed:', e);
      formMsg(e && e.code === 'permission-denied'
        ? "Your review couldn't be posted. Please log in again and retry."
        : 'Could not post your review. Check your connection and try again.', 'err');
      btn.disabled = false;
    }
  }

  async function deleteMine(){
    const msg = elForm.querySelector('#rvDelMsg');
    if(!state.user) return;
    if(!window.confirm('Delete your review?')) return;
    try{
      const f = await loadFb();
      await f.deleteDoc(f.doc(f.db, 'reviews', product.id + '_' + state.user.uid));
      state.reviews = (state.reviews || []).filter(r => r.uid !== state.user.uid);
      renderAll();
    }catch(e){
      console.error('Deleting review failed:', e);
      if(msg){ msg.textContent = 'Could not delete your review. Please try again.'; msg.style.display = 'block'; }
    }
  }

  function renderAll(){
    renderSummary();
    renderList();
    renderForm();
    renderMini();
  }

  // ---------- data + auth (loads the Firebase SDK) ----------
  let started = false;
  async function start(){
    if(started) return;
    started = true;
    let f;
    try{
      f = await loadFb();
    }catch(e){
      console.error('Firebase failed to load for reviews:', e);
      state.authFailed = true;
      if(state.reviews === null){ state.reviews = []; state.loadError = true; }
      renderAll();
      return;
    }
    if(state.reviews === null){
      try{
        const q = f.query(f.collection(f.db, 'reviews'), f.where('productId', '==', product.id), f.limit(100));
        const snap = await f.getDocs(q);
        state.reviews = normalize(snap.docs.map(d => ({ id: d.id, ...d.data() })));
      }catch(e){
        console.error('Loading reviews failed:', e);
        state.reviews = [];
        state.loadError = true;
      }
      renderSummary(); renderList(); renderMini();
    }
    f.onAuthStateChanged(f.auth, async (u) => {
      state.user = u || null;
      state.altName = '';
      if(u && !u.displayName){
        try{
          const s = await f.getDoc(f.doc(f.db, 'customers', u.uid));
          if(s.exists()) state.altName = s.data().name || '';
        }catch(e){ /* optional */ }
      }
      state.authReady = true;
      renderForm();
    });
  }

  renderAll();

  if(state.reviews === null || location.hash === '#reviews'){
    start();
  }else if('IntersectionObserver' in window){
    const io = new IntersectionObserver((entries) => {
      if(entries.some(en => en.isIntersecting)){ io.disconnect(); start(); }
    }, { rootMargin: '400px 0px' });
    io.observe(sec);
  }else{
    start();
  }

  if(location.hash === '#reviews'){
    setTimeout(() => { try{ sec.scrollIntoView(); }catch(e){} }, 0);
  }
}
