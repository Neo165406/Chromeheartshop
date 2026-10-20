// js/admin-categories.js — "Categories" tab for the admin panel.
// Create categories and sub-categories here; they are stored in the Firestore
// "categories" collection and appear in the site's menu drawer (and in the
// shop's category pills and filter). The Products tab's Category dropdown and
// Subcategory suggestions use the same list.
//
// It adds its own tab + panel to admin.html and is loaded from
// js/admin-reviews.js, so admin.html needs no change.
//
// Saving needs the logged-in admin's UID to exist in Firestore -> "admins"
// collection (firestore.rules -> isAdmin()), and the updated firestore.rules
// (with the "categories" rule) must be PUBLISHED in the Firebase console.

import { db, collection, getDocs, doc, getDoc, setDoc, deleteDoc, serverTimestamp } from './firebase-config.js';
import { DEFAULT_TREE } from './categories.js';

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function errText(e){
  return (e && e.code ? e.code + ' — ' : '') + (e && e.message ? e.message : String(e))
    + (e && e.code === 'permission-denied' ? ' (publish the updated firestore.rules in the Firebase console, and make sure your admin UID is a document in the "admins" collection)' : '');
}
// Document id for a category name: "Wallet Chains" -> "wallet-chains".
function idFor(name){
  const s = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'category';
}

let cats = [];

// ---------- inject tab + panel ----------
const tabsBar = document.querySelector('.tabs');
const dash = document.getElementById('dash');

if(tabsBar && dash && !document.getElementById('categoriesPanel')){
  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.panel = 'categoriesPanel';
  tab.textContent = 'Categories';
  // place it right after "Products" if present, else before "Settings", else at the end
  const productsTab = tabsBar.querySelector('[data-panel="productsPanel"]');
  const settingsTab = tabsBar.querySelector('[data-panel="settingsPanel"]');
  if(productsTab) tabsBar.insertBefore(tab, productsTab.nextSibling);
  else if(settingsTab) tabsBar.insertBefore(tab, settingsTab);
  else tabsBar.appendChild(tab);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'categoriesPanel';
  panel.innerHTML = `
    <div class="card-form">
      <h3>Add category</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.5;margin-bottom:14px;">Categories show in the site menu in the order below (lower number first); "New In" is always first. Tapping a category with sub-categories opens its list in the menu. Deleting a category never deletes products.</p>
      <div class="row2">
        <div class="field"><label>Category name</label><input id="catName" placeholder="e.g. Clothing"></div>
        <div class="field"><label>Order (lower shows first)</label><input id="catOrder" type="number" value="0"></div>
      </div>
      <div class="field"><label>Sub-categories (optional, separated by commas)</label><input id="catSubs" placeholder="e.g. T-shirt, Hoodie"></div>
      <button class="save-btn" id="catSaveBtn">Add category</button>
      <p class="status-msg" id="catStatus"></p>
    </div>
    <div class="list" id="catList"></div>`;
  const settingsPanel = document.getElementById('settingsPanel');
  if(settingsPanel) dash.insertBefore(panel, settingsPanel);
  else dash.appendChild(panel);

  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach(x => x.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    loadCats();
  });
  document.getElementById('catSaveBtn').addEventListener('click', addCategory);

  // Keep the Products tab's Subcategory suggestions in step with the chosen category.
  const sel = document.getElementById('pCategory');
  if(sel) sel.addEventListener('change', fillSubSuggestions);

  // Fill the Products tab's dropdown right away (reading categories is public).
  loadCats(true);
}

// ---------- Products tab: category dropdown + subcategory suggestions ----------
function categorySource(){
  return cats.length ? cats : DEFAULT_TREE.filter(c => c.name !== 'New In');
}
function fillSubSuggestions(){
  const sel = document.getElementById('pCategory');
  const dl = document.getElementById('subOptions');
  if(!sel || !dl) return;
  const cat = categorySource().find(c => c.name === sel.value);
  dl.innerHTML = (cat ? cat.subs : []).map(s => `<option value="${esc(s)}">`).join('');
}
function syncProductForm(){
  const sel = document.getElementById('pCategory');
  if(!sel) return;
  const previous = sel.value;
  const source = categorySource();
  sel.innerHTML = source.map(c => `<option>${esc(c.name)}</option>`).join('');
  if(source.some(c => c.name === previous)) sel.value = previous;
  fillSubSuggestions();
}

// ---------- data ----------
async function loadCats(silent){
  const list = document.getElementById('catList');
  const status = document.getElementById('catStatus');
  if(!silent && list) list.innerHTML = 'Loading...';
  try{
    const snap = await getDocs(collection(db, 'categories'));
    cats = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(c => typeof c.name === 'string' && c.name.trim())
      .map(c => ({
        id: c.id,
        name: c.name.trim(),
        order: Number(c.order) || 0,
        subs: Array.isArray(c.subs) ? c.subs.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : []
      }))
      .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
    syncProductForm();
    if(list) render();
  }catch(e){
    console.error('Admin categories load failed:', e);
    if(!silent && list){
      list.innerHTML = '';
      if(status) status.textContent = 'Could not load categories: ' + errText(e);
    }
  }
}

function render(){
  const list = document.getElementById('catList');
  if(!list) return;
  list.innerHTML = '';

  if(!cats.length){
    const empty = document.createElement('div');
    empty.className = 'card-form';
    empty.innerHTML = `
      <h3>No categories saved yet</h3>
      <p style="font-size:12.5px;color:var(--text-dim);line-height:1.5;margin-bottom:12px;">The site menu is showing its built-in list (Glasses, Accessories, Clothing and their sub-categories). Load that list here to edit it, or add your own above — once you save a category, the menu uses only the categories saved here.</p>
      <button class="save-btn" id="catSeedBtn">Load the default categories</button>`;
    list.appendChild(empty);
    empty.querySelector('#catSeedBtn').addEventListener('click', seedDefaults);
    return;
  }

  cats.forEach(c => {
    const el = document.createElement('div');
    el.className = 'card-form';
    el.innerHTML = `
      <h3>${esc(c.name)}</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        ${c.subs.length ? c.subs.map((s, i) => `<span style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:14px;padding:5px 6px 5px 12px;font-size:12.5px;">${esc(s)}<button type="button" class="rm-sub" data-i="${i}" aria-label="Remove ${esc(s)}" style="width:20px;height:20px;border-radius:50%;border:none;background:rgba(224,138,138,0.2);color:#e08a8a;cursor:pointer;font-size:11px;line-height:1;">✕</button></span>`).join('') : '<span style="font-size:12px;color:var(--text-dim);">No sub-categories yet.</span>'}
      </div>
      <div class="row2" style="margin-bottom:12px;">
        <div class="field" style="margin-bottom:0;"><input class="sub-in" placeholder="New sub-category"></div>
        <button class="save-btn add-sub" type="button">Add sub-category</button>
      </div>
      <div class="row2" style="margin-bottom:12px;">
        <div class="field" style="margin-bottom:0;"><label>Order</label><input class="order-in" type="number" value="${esc(c.order)}"></div>
        <div style="display:flex;align-items:flex-end;"><button class="edit save-order" type="button">Save order</button></div>
      </div>
      <button class="del" type="button">Delete category</button>
      <p class="status-msg row-status"></p>`;
    const rowStatus = el.querySelector('.row-status');

    el.querySelectorAll('.rm-sub').forEach(btn => {
      btn.addEventListener('click', () => {
        const subs = c.subs.filter((_, i) => i !== Number(btn.dataset.i));
        saveField(c, { subs }, rowStatus);
      });
    });
    el.querySelector('.add-sub').addEventListener('click', () => {
      const input = el.querySelector('.sub-in');
      const value = input.value.trim();
      if(!value){ rowStatus.textContent = 'Type a sub-category name first.'; return; }
      if(value.length > 40){ rowStatus.textContent = 'A sub-category name can be at most 40 characters.'; return; }
      if(c.subs.some(s => s.toLowerCase() === value.toLowerCase())){ rowStatus.textContent = 'That sub-category already exists here.'; return; }
      saveField(c, { subs: c.subs.concat(value) }, rowStatus);
    });
    el.querySelector('.save-order').addEventListener('click', () => {
      saveField(c, { order: Number(el.querySelector('.order-in').value) || 0 }, rowStatus);
    });
    el.querySelector('.del').addEventListener('click', async (e) => {
      if(!window.confirm('Delete the category "' + c.name + '" from the menu? Products in it are not deleted.')) return;
      const btn = e.currentTarget;
      btn.disabled = true;
      rowStatus.textContent = 'Deleting...';
      try{
        await deleteDoc(doc(db, 'categories', c.id));
        await loadCats();
      }catch(err){
        console.error('Category delete failed:', err);
        rowStatus.textContent = 'Could not delete: ' + errText(err);
        btn.disabled = false;
      }
    });
    list.appendChild(el);
  });
}

// Merge-writes a few fields of one category and redraws the list.
async function saveField(c, fields, statusEl){
  statusEl.textContent = 'Saving...';
  try{
    await setDoc(doc(db, 'categories', c.id), fields, { merge: true });
    await loadCats();
  }catch(e){
    console.error('Category save failed:', e);
    statusEl.textContent = 'Could not save: ' + errText(e);
  }
}

async function addCategory(){
  const btn = document.getElementById('catSaveBtn');
  const status = document.getElementById('catStatus');
  const name = document.getElementById('catName').value.trim();
  const order = Number(document.getElementById('catOrder').value) || 0;
  const subs = [];
  document.getElementById('catSubs').value.split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
    if(!subs.some(x => x.toLowerCase() === s.toLowerCase())) subs.push(s);
  });
  if(!name){ status.textContent = 'Category name is required.'; return; }
  if(name.length > 40){ status.textContent = 'A category name can be at most 40 characters.'; return; }
  if(name.toLowerCase() === 'new in'){ status.textContent = '"New In" is always in the menu already.'; return; }
  btn.disabled = true;
  status.textContent = 'Saving...';
  try{
    const id = idFor(name);
    const existing = await getDoc(doc(db, 'categories', id));
    if(existing.exists()){
      status.textContent = 'A category with this name already exists — add sub-categories to it below.';
    }else{
      await setDoc(doc(db, 'categories', id), { name, order, subs, createdAt: serverTimestamp() });
      status.textContent = 'Saved — it now shows in the site menu.';
      document.getElementById('catName').value = '';
      document.getElementById('catSubs').value = '';
      document.getElementById('catOrder').value = '0';
      await loadCats();
    }
  }catch(e){
    console.error('Category add failed:', e);
    status.textContent = 'Failed: ' + errText(e);
  }
  btn.disabled = false;
}

// Copies the built-in menu (everything except "New In") into Firestore so it can be edited.
async function seedDefaults(e){
  const btn = e.currentTarget;
  const status = document.getElementById('catStatus');
  btn.disabled = true;
  status.textContent = 'Loading defaults...';
  try{
    const defaults = DEFAULT_TREE.filter(c => c.name !== 'New In');
    for(let i = 0; i < defaults.length; i++){
      const c = defaults[i];
      const ref = doc(db, 'categories', idFor(c.name));
      const existing = await getDoc(ref);
      if(!existing.exists()){
        await setDoc(ref, { name: c.name, order: (i + 1) * 10, subs: c.subs, createdAt: serverTimestamp() });
      }
    }
    status.textContent = 'Default categories loaded.';
    await loadCats();
  }catch(err){
    console.error('Seeding default categories failed:', err);
    status.textContent = 'Failed: ' + errText(err);
    btn.disabled = false;
  }
}
