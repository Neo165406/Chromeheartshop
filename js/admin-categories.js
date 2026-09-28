// js/admin-categories.js
// "Categories" tab of the admin dashboard. Lives in its own module (like
// admin-reels.js) so it can never break the rest of the admin.
//
// Also keeps the Product form's Category dropdown and Subcategory suggestions
// in sync with the categories saved here.

import { db, collection, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, auth, onAuthStateChanged } from './firebase-config.js';
import { DEFAULT_CATEGORIES, loadCategories, esc } from './categories.js';

const $ = (id) => document.getElementById(id);
let cats = [];

// Shows the exact Firebase error code + message (e.g. "permission-denied: Missing or insufficient permissions.")
function errText(e){
  const code = e && e.code ? e.code + ': ' : '';
  const msg = e && e.message ? e.message : String(e);
  const hint = e && e.code === 'permission-denied'
    ? ' — deploy the updated firestore.rules (it adds the "categories" collection) and make sure you are signed in as admin.'
    : '';
  return code + msg + hint;
}

function usingDefaults(){
  return !cats.some((c) => c.id);
}

// ---------- Product form sync ----------
function updateSubOptions(){
  const sel = $('pCategory');
  const dl = $('subOptions');
  if(!sel || !dl) return;
  const c = cats.find((x) => x.name === sel.value);
  dl.innerHTML = (c ? c.subs : []).map((s) => `<option value="${esc(s)}">`).join('');
}

function fillProductCategorySelect(){
  const sel = $('pCategory');
  if(!sel) return;
  const keep = sel.value;
  sel.innerHTML = cats.map((c) => `<option>${esc(c.name)}</option>`).join('');
  if(keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
  updateSubOptions();
}

// An older product may use a category that's no longer in the list — keep it selectable when editing.
function ensureCategoryOption(name){
  const sel = $('pCategory');
  if(!sel || !name) return;
  if(![...sel.options].some((o) => o.value === name)){
    const opt = document.createElement('option');
    opt.textContent = name;
    sel.appendChild(opt);
  }
}

let hooked = false;
function hookProductForm(){
  if(hooked) return;
  const sel = $('pCategory');
  if(sel) sel.addEventListener('change', updateSubOptions);
  if(typeof window.editProduct === 'function' && typeof window.cancelEditProduct === 'function'){
    hooked = true;
    const origEdit = window.editProduct;
    window.editProduct = function(id, p){
      ensureCategoryOption(p && p.category);
      origEdit(id, p);
      updateSubOptions();
    };
    const origCancel = window.cancelEditProduct;
    window.cancelEditProduct = function(){
      origCancel();
      const s = $('pCategory');
      if(s) s.selectedIndex = 0;
      updateSubOptions();
    };
  }
}

// ---------- Categories tab ----------
function setStatus(msg){
  const el = $('catStatus');
  if(el) el.textContent = msg || '';
}

async function reload(){
  cats = await loadCategories();
  renderList();
  fillProductCategorySelect();
  hookProductForm();
}

async function seedDefaults(){
  for(let i = 0; i < DEFAULT_CATEGORIES.length; i++){
    const c = DEFAULT_CATEGORIES[i];
    await addDoc(collection(db, 'categories'), {
      name: c.name,
      subs: [...c.subs],
      order: (i + 1) * 10,
      createdAt: serverTimestamp()
    });
  }
}

function renderList(){
  const list = $('catList');
  if(!list) return;
  list.innerHTML = '';

  if(usingDefaults()){
    const box = document.createElement('div');
    box.className = 'card-form';
    box.innerHTML = `
      <h3>Built-in categories in use</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.5;margin-bottom:12px;">The site is showing the built-in list (${cats.map((c) => esc(c.name)).join(', ')}). Save them to the database to edit them here — adding a category below does this automatically.</p>
      <button class="save-btn" id="catSeedBtn">Save built-in categories to database</button>`;
    list.appendChild(box);
    box.querySelector('#catSeedBtn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      setStatus('Saving...');
      try{
        await seedDefaults();
        setStatus('Saved.');
        await reload();
      }catch(err){
        console.error('Seeding categories failed:', err);
        setStatus('Failed: ' + errText(err));
        btn.disabled = false;
      }
    });
    return;
  }

  cats.forEach((c) => {
    const box = document.createElement('div');
    box.className = 'card-form';
    const chips = c.subs.length
      ? c.subs.map((s, i) => `<span class="chip">${esc(s)}<button type="button" class="chip-rm" data-i="${i}" aria-label="Remove ${esc(s)}">✕</button></span>`).join('')
      : '<span style="font-size:12px;color:var(--text-dim);">No subcategories yet.</span>';
    box.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
        <h3 style="margin:0;flex:1;min-width:0;">${esc(c.name)}</h3>
        <input type="number" class="stock-in cat-order" style="width:64px;" value="${c.order}" title="Order (lower shows first)">
        <button type="button" class="edit cat-order-btn">Set order</button>
        <button type="button" class="del cat-del">Delete</button>
      </div>
      <div style="margin-bottom:10px;">${chips}</div>
      <div style="display:flex;gap:8px;">
        <input class="cat-sub-input" placeholder="New subcategory, e.g. Hoodie" style="flex:1;min-width:0;padding:10px 12px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:var(--radius);font-size:13.5px;">
        <button type="button" class="save-btn cat-sub-add">Add</button>
      </div>`;
    list.appendChild(box);

    const run = async (fn, btn) => {
      if(btn) btn.disabled = true;
      setStatus('Saving...');
      try{
        await fn();
        setStatus('Saved.');
        await reload();
      }catch(err){
        console.error('Category update failed:', err);
        setStatus('Failed: ' + errText(err));
        if(btn) btn.disabled = false;
      }
    };

    box.querySelector('.cat-sub-add').addEventListener('click', (e) => {
      const input = box.querySelector('.cat-sub-input');
      const name = input.value.trim();
      if(!name){ setStatus('Type a subcategory name first.'); return; }
      if(c.subs.some((s) => s.toLowerCase() === name.toLowerCase())){ setStatus(`"${name}" already exists in ${c.name}.`); return; }
      run(() => updateDoc(doc(db, 'categories', c.id), { subs: [...c.subs, name] }), e.currentTarget);
    });
    box.querySelector('.cat-sub-input').addEventListener('keydown', (e) => {
      if(e.key === 'Enter'){ e.preventDefault(); box.querySelector('.cat-sub-add').click(); }
    });
    box.querySelectorAll('.chip-rm').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.dataset.i);
        run(() => updateDoc(doc(db, 'categories', c.id), { subs: c.subs.filter((_, j) => j !== i) }), btn);
      });
    });
    box.querySelector('.cat-order-btn').addEventListener('click', (e) => {
      const order = Number(box.querySelector('.cat-order').value) || 0;
      run(() => updateDoc(doc(db, 'categories', c.id), { order }), e.currentTarget);
    });
    box.querySelector('.cat-del').addEventListener('click', (e) => {
      if(!confirm(`Delete "${c.name}"? Products already in it keep their category name, but it will disappear from the menu until you add it again.`)) return;
      run(() => deleteDoc(doc(db, 'categories', c.id)), e.currentTarget);
    });
  });
}

async function addCategory(){
  const btn = $('catSaveBtn');
  const name = $('catName').value.trim();
  if(!name){ setStatus('Category name is required.'); return; }
  if(name.toLowerCase() === 'new in'){ setStatus('"New In" is built in — pick another name.'); return; }
  if(cats.some((c) => c.name.toLowerCase() === name.toLowerCase())){ setStatus(`"${name}" already exists.`); return; }
  btn.disabled = true;
  setStatus('Saving...');
  try{
    // First real category would otherwise replace the built-in list — save that list first.
    if(usingDefaults()){
      await seedDefaults();
      cats = await loadCategories();
    }
    const orderRaw = $('catOrder').value;
    const order = orderRaw === '' ? (Math.max(0, ...cats.map((c) => c.order)) + 10) : Number(orderRaw);
    await addDoc(collection(db, 'categories'), { name, subs: [], order, createdAt: serverTimestamp() });
    $('catName').value = '';
    $('catOrder').value = '';
    setStatus('Saved. Add its subcategories below.');
    await reload();
  }catch(e){
    console.error('Category save failed:', e);
    setStatus('Failed: ' + errText(e));
  }
  btn.disabled = false;
}

// ---------- Wiring ----------
const saveBtn = $('catSaveBtn');
if(saveBtn) saveBtn.addEventListener('click', addCategory);
const catName = $('catName');
if(catName) catName.addEventListener('keydown', (e) => { if(e.key === 'Enter'){ e.preventDefault(); addCategory(); } });

const tab = document.querySelector('.tab[data-panel="categoriesPanel"]');
if(tab) tab.addEventListener('click', reload);

onAuthStateChanged(auth, (user) => {
  if(user) reload();
});
