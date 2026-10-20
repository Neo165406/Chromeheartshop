// js/categories.js — the menu categories, shared by every page that shows them.
//
// Categories and sub-categories are managed in the admin panel (Categories tab)
// and stored in the Firestore "categories" collection. If that collection is
// empty, or can't be read (offline, rules not published yet), the site falls
// back to DEFAULT_TREE below, which is the menu the site always had.
//
// "New In" is not stored: it is always the first entry of the menu.
//
// Used by:
//   templates/shop.html  (menu drawer, category pills, filter drawer)
//   js/menu-categories.js (menu drawer on the home page)
//   js/admin-categories.js (default list for the "Load default categories" button)

import { db, collection, getDocs } from './firebase-config.js';

export const DEFAULT_TREE = [
  { name: 'New In', subs: [] },
  { name: 'Glasses', subs: ['Rimless', 'Aviators', 'Round'] },
  { name: 'Accessories', subs: ['Bandana', 'Belts', 'Bracelets', 'Chain', 'Earrings', 'Fake Piercings', 'Keychains', 'Ring Watch', 'Rings', 'Sunglasses', 'Tattoo', 'Teeth-Grillz', 'Wallet', 'Wallet Chains', 'Watches'] },
  { name: 'Clothing', subs: ['T-shirt'] }
];

// Same clean URLs the server uses (see CATEGORY_PATHS in api/shop-page.js).
const CATEGORY_PATHS = {
  'Glasses': '/glasses',
  'Clothing': '/clothing',
  'Accessories': '/accessories'
};

// Sub-categories that have their own landing page. Keep the aliases in sync
// with SCOPE_PAGES in api/shop-page.js.
const SUB_PAGES = [
  { path: '/bracelets', aliases: ['bracelets', 'bracelet'] },
  { path: '/rings', aliases: ['rings', 'ring'] },
  { path: '/bandanas', aliases: ['bandana', 'bandanas'] },
  { path: '/chrome-heart-chains', aliases: ['chain', 'chains'] }
];

export function categoryHref(name){
  const n = String(name == null ? '' : name).trim();
  if(Object.prototype.hasOwnProperty.call(CATEGORY_PATHS, n)) return CATEGORY_PATHS[n];
  return '/shop?category=' + encodeURIComponent(n);
}

// A sub-category with a landing page goes there; any other one opens its
// category filtered to that sub-category (?sub=, read by templates/shop.html).
export function subHref(catName, sub){
  const key = String(sub == null ? '' : sub).trim().toLowerCase();
  const page = SUB_PAGES.find(p => p.aliases.indexOf(key) !== -1);
  if(page) return page.path;
  const base = categoryHref(catName);
  return base + (base.indexOf('?') === -1 ? '?' : '&') + 'sub=' + encodeURIComponent(String(sub).trim());
}

// Returns the menu tree: [{ name, subs: [..] }, ...] with "New In" first.
// Never throws — on any problem it returns DEFAULT_TREE itself (the same
// object), so callers can tell "fell back" apart with a === check.
export async function loadCategoryTree(){
  try{
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Categories load timed out')), 6000));
    const snap = await Promise.race([getDocs(collection(db, 'categories')), timeout]);
    const cats = snap.docs
      .map(d => d.data())
      .filter(c => c && typeof c.name === 'string' && c.name.trim())
      .sort((a, b) => ((Number(a.order) || 0) - (Number(b.order) || 0)) || a.name.localeCompare(b.name));
    if(!cats.length) return DEFAULT_TREE;
    return [{ name: 'New In', subs: [] }].concat(cats.map(c => ({
      name: c.name.trim(),
      subs: Array.isArray(c.subs) ? c.subs.filter(s => typeof s === 'string' && s.trim()).map(s => s.trim()) : []
    })));
  }catch(e){
    console.error('Categories load failed, using the default menu:', e);
    return DEFAULT_TREE;
  }
}

// Draws the menu inside `container` (the #catTree element). A category with
// sub-categories opens/closes when tapped (and lists "All <category>" first);
// one without goes straight to its page. Names come from Firestore, so they are
// put in with textContent, never as HTML.
export function renderCategoryMenu(container, tree){
  if(!container) return;
  container.innerHTML = '';

  function closeOthers(except){
    container.querySelectorAll('.cat-row.open').forEach(r => {
      if(r === except) return;
      r.classList.remove('open');
      r.setAttribute('aria-expanded', 'false');
      const s = r.nextElementSibling;
      if(s && s.classList.contains('subs')) s.style.maxHeight = '0px';
    });
  }

  tree.forEach(cat => {
    const subList = Array.isArray(cat.subs) ? cat.subs : [];

    const row = document.createElement('div');
    row.className = 'cat-row';
    const label = document.createElement('span');
    label.className = 'name';
    label.textContent = cat.name;
    row.appendChild(label);
    container.appendChild(row);

    if(!subList.length){
      row.addEventListener('click', () => { window.location.href = categoryHref(cat.name); });
      return;
    }

    const chev = document.createElement('span');
    chev.className = 'chev';
    row.appendChild(chev);
    row.setAttribute('role', 'button');
    row.setAttribute('tabindex', '0');
    row.setAttribute('aria-expanded', 'false');

    const subs = document.createElement('div');
    subs.className = 'subs';
    function addLink(text, href, bright){
      const a = document.createElement('a');
      a.href = href;
      a.textContent = text;
      if(bright) a.style.color = 'var(--silver-bright)';
      subs.appendChild(a);
    }
    addLink('All ' + cat.name, categoryHref(cat.name), true);
    subList.forEach(s => addLink(s, subHref(cat.name, s), false));
    container.appendChild(subs);

    function toggle(){
      const open = !row.classList.contains('open');
      closeOthers(open ? row : null);
      row.classList.toggle('open', open);
      row.setAttribute('aria-expanded', String(open));
      subs.style.maxHeight = open ? subs.scrollHeight + 'px' : '0px';
    }
    row.addEventListener('click', toggle);
    row.addEventListener('keydown', e => {
      if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); }
    });
  });
}
