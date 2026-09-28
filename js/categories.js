// js/categories.js
// Shared category helpers for the storefront (index.html, shop.html) and admin.
//
// Categories live in the Firestore "categories" collection, one document per
// category:  { name: "Clothing", subs: ["T-shirt"], order: 30 }
// They are managed from the admin dashboard (Categories tab).
//
// If the collection is empty (or can't be read yet, e.g. the updated
// firestore.rules aren't deployed) the built-in DEFAULT_CATEGORIES below are
// used, so the site never ends up with an empty menu.

import { db, collection, getDocs } from './firebase-config.js';

export const DEFAULT_CATEGORIES = [
  { name: 'Glasses', subs: ['Rimless', 'Aviators', 'Round'] },
  { name: 'Accessories', subs: ['Bandana', 'Belts', 'Bracelets', 'Chain-Necklaces', 'Earrings', 'Fake Piercings', 'Keychains', 'Ring Watch', 'Rings', 'Sunglasses', 'Tattoo', 'Teeth-Grillz', 'Wallet', 'Wallet Chains', 'Watches'] },
  { name: 'Clothing', subs: ['T-shirt'] }
];

export function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Returns [{ id, name, subs, order }] sorted by order. `id` is null for built-in defaults.
export async function loadCategories(){
  try{
    const fetchPromise = getDocs(collection(db, 'categories'));
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Categories load timed out')), 8000));
    const snap = await Promise.race([fetchPromise, timeout]);
    if(!snap.empty){
      return snap.docs
        .map(d => {
          const c = d.data();
          return {
            id: d.id,
            name: String(c.name || '').trim(),
            subs: Array.isArray(c.subs) ? c.subs.map(s => String(s).trim()).filter(Boolean) : [],
            order: Number(c.order) || 0
          };
        })
        .filter(c => c.name)
        .sort((a, b) => (a.order - b.order) || a.name.localeCompare(b.name));
    }
  }catch(e){
    console.error('Categories load failed, using built-in defaults:', e);
  }
  return DEFAULT_CATEGORIES.map((c, i) => ({ id: null, name: c.name, subs: [...c.subs], order: (i + 1) * 10 }));
}

// Fills the slide-out menu (.cat-tree). "New In" is built in and always first.
// Rows with subcategories expand; rows without go straight to the shop page.
export function renderCategoryTree(el, cats){
  if(!el) return;
  const tree = [{ name: 'New In', subs: [] }, ...cats];
  el.innerHTML = '';
  tree.forEach(cat => {
    const href = `shop.html?category=${encodeURIComponent(cat.name)}`;
    const row = document.createElement('div');
    row.className = 'cat-row';
    row.style.cursor = 'pointer';
    row.innerHTML = `<span class="name">${esc(cat.name)}</span>${cat.subs.length ? '<span class="chev"></span>' : ''}`;
    el.appendChild(row);

    const subs = document.createElement('div');
    subs.className = 'subs';
    if(cat.subs.length){
      subs.innerHTML = `<a href="${href}">All ${esc(cat.name)}</a>`
        + cat.subs.map(s => `<a href="${href}&sub=${encodeURIComponent(s)}">${esc(s)}</a>`).join('');
    }
    el.appendChild(subs);

    row.addEventListener('click', () => {
      if(cat.subs.length){
        const open = row.classList.toggle('open');
        subs.style.maxHeight = open ? subs.scrollHeight + 'px' : '';
      } else {
        window.location.href = href;
      }
    });
  });
}
