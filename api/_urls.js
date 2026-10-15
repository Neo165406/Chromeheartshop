// api/_urls.js — shared public-URL helpers for the serverless functions.
// (The leading underscore keeps Vercel from exposing this file as an endpoint.)
//
// A product with a valid `slug` field lives at /product/<slug>. A product that
// has no slug yet keeps the old /product.html?id=<id> URL, so nothing breaks
// while slugs are being filled in (see scripts/backfill-slugs.mjs and the
// auto-slug in admin.html). Once a product has a slug, the old URL answers with
// a 301 to the new one (see api/product-page.js).
//
// slugify() is deliberately duplicated in admin.html and scripts/backfill-slugs.mjs
// (they run in the browser / plain Node, where this CommonJS file can't be
// imported). Keep the three copies identical.

const SITE = 'https://fashion1sta.com';

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugify(name){
  const s = String(name == null ? '' : name)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || 'product';
}

function validSlug(s){
  return typeof s === 'string' && s.length <= 100 && SLUG_RE.test(s);
}

// Path (no host) of the page for this product: /product/<slug>, or the old
// id-based URL while the product has no slug.
function productPath(p){
  if(p && validSlug(p.slug)) return `/product/${p.slug}`;
  return `/product.html?id=${encodeURIComponent(p && p.id)}`;
}

// Clean public path for each category (keep in sync with CATEGORY_PATHS in
// api/shop-page.js). Categories not listed here (New In) use ?category= on /shop.
const CATEGORY_PATHS = {
  'Glasses': '/glasses',
  'Clothing': '/clothing',
  'Accessories': '/accessories'
};

function categoryPath(name){
  if(!name) return '/shop';
  return Object.prototype.hasOwnProperty.call(CATEGORY_PATHS, name)
    ? CATEGORY_PATHS[name]
    : `/shop?category=${encodeURIComponent(name)}`;
}

module.exports = { SITE, SLUG_RE, slugify, validSlug, productPath, categoryPath, CATEGORY_PATHS };
