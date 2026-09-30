// js/search.js
// Shared product search for the menu drawer on every page that has a
// ".search-bar" (index.html, shop.html). It wires itself up automatically:
// no per-page code is needed, and it is loaded through js/cart.js like footer.js.
//
// - Live results while typing (debounced) and on Enter / the keyboard's search key
// - Matches product name, category, subcategory, description and tags
// - Forgiving: case-insensitive, ignores punctuation, plural/singular (bracelet = bracelets),
//   multi-word queries, "any word" fallback, and small typos (braclet -> bracelet)
// - Products come straight from Firestore, so new/edited/removed products show up instantly

import { db, collection, getDocs } from './firebase-config.js';

const MAX_RESULTS = 40;

/* ---------- text helpers ---------- */
const norm = (s) => String(s == null ? '' : s)
  .toLowerCase()
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
  .trim();

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function tokenize(q){
  return norm(q).split(' ').filter(Boolean).map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t));
}

/* ---------- the matcher (exported so other pages can reuse it) ---------- */
export function searchProducts(list, q){
  const base = tokenize(q);
  if(!base.length) return [];
  const docs = list.filter((p) => p && p.name).map((p) => ({
    p,
    name: norm(p.name),
    cat: norm((p.category || '') + ' ' + (p.subcategory || '')),
    rest: norm((p.description || '') + ' ' + (Array.isArray(p.tags) ? p.tags.join(' ') : (p.tags || '')))
  }));
  const rank = (tokens, needAll) => {
    const out = [];
    docs.forEach((d) => {
      let score = 0, hit = 0;
      tokens.forEach((t) => {
        let s = 0;
        if(d.name.includes(t)) s = new RegExp('(^| )' + escRe(t)).test(d.name) ? 5 : 3;
        else if(d.cat.includes(t)) s = 2;
        else if(d.rest.includes(t)) s = 1;
        if(s){ hit++; score += s; }
      });
      if(needAll ? hit === tokens.length : hit > 0) out.push({ p: d.p, score, hit });
    });
    return out.sort((a, b) => (b.hit - a.hit) || (b.score - a.score)).map((x) => x.p);
  };
  let res = rank(base, true);                       // every word matches
  if(!res.length) res = rank(base, false);          // at least one word matches
  if(!res.length) res = rank(base.map((t) => (t.length >= 5 ? t.slice(0, 4) : t)), false); // typo tolerance
  return res;
}

/* ---------- product loading (cached; retries after a failure) ---------- */
let cache = null;
let pending = null;
function loadProducts(){
  if(cache) return Promise.resolve(cache);
  if(!pending){
    pending = Promise.race([
      getDocs(collection(db, 'products')).then((snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Products load timed out')), 10000))
    ]).then((items) => { cache = items; pending = null; return items; })
      .catch((e) => { pending = null; throw e; });
  }
  return pending;
}

/* ---------- styles (self-contained so every page gets them) ---------- */
function injectStyles(){
  if(document.getElementById('ss-styles')) return;
  const st = document.createElement('style');
  st.id = 'ss-styles';
  st.textContent = `
    .search-bar{position:relative;}
    .search-bar svg{cursor:pointer;}
    .search-bar input{min-width:0;}
    .ss-x{flex-shrink:0;background:none;border:none;color:var(--text-dim);font-size:14px;cursor:pointer;padding:0 2px;line-height:1;}
    .ss-wrap{margin:-12px 0 24px;}
    .ss-count{font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-dim);margin-bottom:6px;}
    .ss-item{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);}
    .ss-thumb{width:52px;height:52px;flex:0 0 52px;border-radius:6px;background:var(--card);overflow:hidden;display:flex;align-items:center;justify-content:center;}
    .ss-thumb img{width:100%;height:100%;object-fit:contain;}
    .ss-info{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px;}
    .ss-name{font-size:13.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    .ss-meta{font-size:12px;color:var(--text-dim);}
    .ss-empty{font-size:13px;color:var(--text-dim);padding:14px 0;line-height:1.6;}
    .ss-retry{background:none;border:1px solid var(--line);color:var(--silver-bright);border-radius:14px;padding:4px 12px;font-size:12px;cursor:pointer;margin-left:6px;}
    nav.drawer.searching .cat-label,nav.drawer.searching .cat-tree{display:none;}
  `;
  document.head.appendChild(st);
}

/* ---------- wiring ---------- */
function wire(bar){
  const input = bar.querySelector('input');
  if(!input || bar.dataset.ssWired) return;
  bar.dataset.ssWired = '1';
  const drawer = bar.closest('nav');

  input.type = 'text';
  input.name = 'q';
  input.setAttribute('enterkeyhint', 'search');
  input.setAttribute('inputmode', 'search');
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-label', 'Search products');

  // A real <form> makes the phone keyboard's Enter / search key submit reliably.
  const form = document.createElement('form');
  form.setAttribute('role', 'search');
  form.setAttribute('action', '#');
  form.noValidate = true;
  form.style.display = 'contents';
  bar.parentNode.insertBefore(form, bar);
  form.appendChild(bar);

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.className = 'ss-x';
  clearBtn.setAttribute('aria-label', 'Clear search');
  clearBtn.textContent = '\u2715';
  clearBtn.hidden = true;
  bar.appendChild(clearBtn);

  const out = document.createElement('div');
  out.className = 'ss-wrap';
  out.setAttribute('aria-live', 'polite');
  out.hidden = true;
  form.after(out);

  let seq = 0, timer = null;

  function reset(){
    out.hidden = true;
    out.innerHTML = '';
    if(drawer) drawer.classList.remove('searching');
  }

  async function run(){
    const q = input.value.trim();
    clearBtn.hidden = !input.value;
    if(!q){ seq++; reset(); return; }
    const mine = ++seq;
    out.hidden = false;
    if(!cache) out.innerHTML = '<p class="ss-empty">Searching\u2026</p>';
    let list;
    try{
      list = await loadProducts();
    }catch(e){
      if(mine !== seq) return;
      console.error('Search: products failed to load', e);
      if(drawer) drawer.classList.remove('searching');
      out.innerHTML = '<p class="ss-empty">Couldn\u2019t load products.<button type="button" class="ss-retry">Try again</button></p>';
      const retry = out.querySelector('.ss-retry');
      if(retry) retry.addEventListener('click', run);
      return;
    }
    if(mine !== seq) return; // a newer keystroke already took over
    const results = searchProducts(list, q);
    if(!results.length){
      if(drawer) drawer.classList.remove('searching');
      out.innerHTML = `<p class="ss-empty">No products found for \u201c${esc(q)}\u201d. Try another word, like <b>ring</b>, <b>chain</b> or <b>glasses</b>.</p>`;
      return;
    }
    if(drawer) drawer.classList.add('searching');
    const shown = results.slice(0, MAX_RESULTS);
    const count = results.length === 1 ? '1 result' : `${results.length} results`;
    out.innerHTML =
      `<div class="ss-count">${count} for \u201c${esc(q)}\u201d${results.length > shown.length ? ` \u00b7 showing first ${shown.length}` : ''}</div>` +
      shown.map((p) => {
        const price = p.price != null ? `BDT ${esc(p.price)}` : '';
        const oos = p.stock === 0 ? `${price ? ' \u00b7 ' : ''}Out of stock` : '';
        return `<a class="ss-item" href="product.html?id=${encodeURIComponent(p.id)}">` +
          `<span class="ss-thumb">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="" loading="lazy">` : ''}</span>` +
          `<span class="ss-info"><span class="ss-name">${esc(p.name)}</span><span class="ss-meta">${price}${oos}</span></span></a>`;
      }).join('');
  }

  input.addEventListener('focus', () => { loadProducts().catch(() => {}); });
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    clearTimeout(timer);
    timer = setTimeout(run, 150);
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    clearTimeout(timer);
    run();
    input.blur(); // close the keyboard so the results are visible
  });
  const icon = bar.querySelector('svg');
  if(icon) icon.addEventListener('click', () => { clearTimeout(timer); run(); input.focus(); });
  clearBtn.addEventListener('click', () => { input.value = ''; run(); input.focus(); });
}

function init(){
  injectStyles();
  document.querySelectorAll('.search-bar').forEach(wire);
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
