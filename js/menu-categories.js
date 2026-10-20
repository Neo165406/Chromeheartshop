// js/menu-categories.js — puts the working, admin-managed category menu into the
// home page's menu drawer. (The shop pages draw their own menu from
// templates/shop.html; the home page just loads this file, added by
// api/home-page.js.)
//
// It shows the default menu straight away, then swaps in the categories from
// Firestore once they arrive (nothing changes if they can't be read).

import { DEFAULT_TREE, loadCategoryTree, renderCategoryMenu } from './categories.js';

const el = document.getElementById('catTree');
if(el){
  renderCategoryMenu(el, DEFAULT_TREE);
  loadCategoryTree().then(tree => {
    if(tree !== DEFAULT_TREE) renderCategoryMenu(el, tree);
  });
}
