// api/product-page.js — Server-renders the product page so it arrives
// with the real product already visible (name, price, image, description)
// instead of the blank "Loading..." shell that only filled in once
// client-side JS finished a chain of Firestore round trips.
//
// The static template lives at templates/product.html (not at the public
// path product.html) so this function is what actually serves the product
// URLs, with no static-file-vs-rewrite conflict. It is reached two ways
// (vercel.json): /product/<slug> (the canonical URL, ?slug= below) and the
// old /product.html?id=<id>. A product that has a slug is only ever served at
// /product/<slug>; the old URL answers with a 301 to it. A product without a
// slug keeps its id-based URL until one is added.
//
// Reads Firestore's public REST API directly (same public web key already used
// client-side — firestore.rules already allows public read on /products, same
// access level the storefront pages themselves have).

const fs = require('fs');
const path = require('path');
const { productPath, categoryPath, validSlug } = require('./_urls');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

// Delivery terms for the Product schema's offers.shippingDetails. These must
// match shipping.html exactly (charges, zones, delivery times); update both
// together. Orders are confirmed the same business day (after 8 PM / Fridays /
// holidays: the next one), so handling is 0-1 days.
const OUTSIDE_DHAKA_REGIONS = ['Chattogram', 'Barishal', 'Khulna', 'Rajshahi', 'Rangpur', 'Sylhet', 'Mymensingh'];
function shippingOption(rate, regions, minDays, maxDays){
  return {
    "@type": "OfferShippingDetails",
    "shippingRate": { "@type": "MonetaryAmount", "value": rate, "currency": "BDT" },
    "shippingDestination": regions.map(r => ({ "@type": "DefinedRegion", "addressCountry": "BD", "addressRegion": r })),
    "deliveryTime": {
      "@type": "ShippingDeliveryTime",
      "handlingTime": { "@type": "QuantitativeValue", "minValue": 0, "maxValue": 1, "unitCode": "DAY" },
      "transitTime": { "@type": "QuantitativeValue", "minValue": minDays, "maxValue": maxDays, "unitCode": "DAY" }
    }
  };
}
const SHIPPING_DETAILS = [
  shippingOption(70, ['Dhaka'], 1, 2),
  shippingOption(130, OUTSIDE_DHAKA_REGIONS, 2, 5)
];

// Hard time limits on the Firestore calls so a slow database can never hold
// the whole page hostage. The product itself gets a generous limit (if it
// times out we fall back to the client-side loader). "Similar products" is
// only a nice-to-have, so it gets a short one — on timeout the page ships
// without it and the browser fills it in afterwards.
const PRODUCT_TIMEOUT_MS = 4000;
const SIMILAR_TIMEOUT_MS = 1500;
const REVIEWS_TIMEOUT_MS = 1500;

// Search-engine crawlers. If a /product/<slug> page can't be looked up at all,
// they get a 503 (try again later) instead of a thin page whose canonical
// would be wrong — same policy as api/home-page.js.
const CRAWLER_UA = /googlebot|google-inspectiontool|googleother|adsbot-google|bingbot|duckduckbot|yandexbot|baiduspider/i;

// ---------- Firestore REST "fields" -> plain JS value ----------
function fsValue(v){
  if(v == null) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return Number(v.doubleValue);
  if('booleanValue' in v) return v.booleanValue;
  if('timestampValue' in v) return v.timestampValue;
  if('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
  if('mapValue' in v) return fsFields(v.mapValue.fields || {});
  return null;
}
function fsFields(fields){
  const out = {};
  for(const k in fields) out[k] = fsValue(fields[k]);
  return out;
}

async function fetchProduct(id){
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(PRODUCT_TIMEOUT_MS) });
  if(r.status === 404) return null;
  if(!r.ok) throw new Error('Firestore product fetch failed: ' + r.status);
  const doc = await r.json();
  return { id, ...fsFields(doc.fields || {}) };
}

// Looks a product up by its `slug` field. Returns null when no product has it,
// throws when Firestore can't be reached (so the caller can tell "no such
// product" from "couldn't check").
async function fetchProductBySlug(slug){
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'products' }],
      where: { fieldFilter: { field: { fieldPath: 'slug' }, op: 'EQUAL', value: { stringValue: slug } } },
      limit: 1
    }
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(PRODUCT_TIMEOUT_MS)
  });
  if(!r.ok) throw new Error('Firestore product-by-slug query failed: ' + r.status);
  const rows = await r.json();
  const row = rows.find(x => x && x.document);
  if(row) return { id: row.document.name.split('/').pop(), ...fsFields(row.document.fields || {}) };

  // Recovery path for a stale/mismatched slug field: only when the exact
  // slug query has no result, scan the public product collection and match the
  // requested slug against the product name's normalized slug. Require one
  // unique match so this can never select an arbitrary product.
  const listUrl = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products`);
  listUrl.searchParams.set('pageSize', '300');
  listUrl.searchParams.set('key', FIREBASE_API_KEY);
  const listResponse = await fetch(listUrl, { signal: AbortSignal.timeout(PRODUCT_TIMEOUT_MS) });
  if(!listResponse.ok) throw new Error('Firestore product fallback lookup failed: ' + listResponse.status);
  const listBody = await listResponse.json();
  const slugifyName = value => String(value || '').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');
  const matches = (listBody.documents || []).map(doc => ({
    id: doc.name.split('/').pop(),
    ...fsFields(doc.fields || {})
  })).filter(p => slugifyName(p.name) === slug);
  return matches.length === 1 ? matches[0] : null;
}

async function fetchSimilar(category, excludeId){
  if(!category) return [];
  try{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'products' }],
        where: { fieldFilter: { field: { fieldPath: 'category' }, op: 'EQUAL', value: { stringValue: category } } },
        limit: 6
      }
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SIMILAR_TIMEOUT_MS)
    });
    if(!r.ok) return [];
    const rows = await r.json();
    return rows
      .filter(row => row.document)
      .map(row => ({ id: row.document.name.split('/').pop(), ...fsFields(row.document.fields || {}) }))
      .filter(p => p.id !== excludeId && p.stock !== 0) // hide out-of-stock
      .slice(0, 4);
  }catch(e){
    console.error('SSR similar-products fetch failed:', e);
    return [];
  }
}

// Name + price of every product in the same category (id, name, price only).
// Used to spot products that share the same name, so each one still gets a
// unique <title> and meta description. Returns [] on failure/timeout, in which
// case no differentiator is added (the page itself is never blocked).
async function fetchCategoryPeers(category){
  if(!category) return [];
  try{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'products' }],
        select: { fields: [{ fieldPath: 'name' }, { fieldPath: 'price' }] },
        where: { fieldFilter: { field: { fieldPath: 'category' }, op: 'EQUAL', value: { stringValue: category } } },
        limit: 100
      }
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SIMILAR_TIMEOUT_MS)
    });
    if(!r.ok) return [];
    const rows = await r.json();
    return rows
      .filter(row => row.document)
      .map(row => {
        const d = fsFields(row.document.fields || {});
        return { id: row.document.name.split('/').pop(), name: d.name, price: d.price };
      });
  }catch(e){
    console.error('SSR category-peers fetch failed:', e);
    return [];
  }
}

// Real customer reviews for this product (Firestore "reviews" collection,
// written by js/reviews.js). Returns an array (possibly empty), or null if the
// query failed/timed out — in that case the browser loads them itself and no
// review markup is put in the schema (we never guess).
async function fetchReviews(productId){
  try{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${FIREBASE_API_KEY}`;
    const body = {
      structuredQuery: {
        from: [{ collectionId: 'reviews' }],
        where: { fieldFilter: { field: { fieldPath: 'productId' }, op: 'EQUAL', value: { stringValue: productId } } },
        limit: 100
      }
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REVIEWS_TIMEOUT_MS)
    });
    if(!r.ok) return null;
    const rows = await r.json();
    return rows
      .filter(row => row.document)
      .map(row => {
        const d = fsFields(row.document.fields || {});
        return {
          id: row.document.name.split('/').pop(),
          uid: String(d.uid || ''),
          name: String(d.name || 'Customer').slice(0, 60),
          rating: Number(d.rating),
          comment: String(d.comment || '').slice(0, 1000),
          createdAt: d.createdAt || null
        };
      })
      .filter(rv => Number.isInteger(rv.rating) && rv.rating >= 1 && rv.rating <= 5)
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
  }catch(e){
    console.error('SSR reviews fetch failed:', e);
    return null;
  }
}

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- Sub-category landing pages (/bracelets, /bandanas) ----------
// A product whose `subcategory` matches gets an extra breadcrumb step linking
// to its landing page (keep in sync with SCOPE_PAGES in api/shop-page.js).
// The visible breadcrumb is drawn by the template's client script after
// hydration, so withSubcategoryCrumb() below patches that one line too.
const SUBCATEGORY_PAGES = {
  bracelets: { path: '/bracelets', label: 'Bracelets' },
  bracelet: { path: '/bracelets', label: 'Bracelets' },
  bandana: { path: '/bandanas', label: 'Bandanas' },
  bandanas: { path: '/bandanas', label: 'Bandanas' }
};
function subcategoryPage(product){
  const key = String((product && product.subcategory) || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUBCATEGORY_PAGES, key) ? SUBCATEGORY_PAGES[key] : null;
}
function crumbSub(product){
  const sp = subcategoryPage(product);
  return sp ? ` / <a href="${sp.path}">${esc(sp.label)}</a>` : '';
}
function breadcrumbItems(product, url){
  const items = [
    { name: 'Shop', item: `${SITE}/shop` },
    { name: product.category || 'Products', item: `${SITE}${categoryPath(product.category)}` }
  ];
  const sp = subcategoryPage(product);
  if(sp) items.push({ name: sp.label, item: `${SITE}${sp.path}` });
  items.push({ name: product.name, item: url });
  return items.map((it, i) => ({ "@type": "ListItem", "position": i + 1, "name": it.name, "item": it.item }));
}

// The template's renderProduct() rebuilds the breadcrumb in the browser as
// "Shop / <category>". For every product page this adds the optional
// sub-category step there (empty for products without a matching
// subcategory, so other products render exactly as before). One exact anchor;
// if the template changes and it no longer matches, the patch is skipped and
// the server-rendered links and structured data still carry the category link.
const CRUMB_ANCHOR = "\">${product.category||''}</a></div>";
function withSubcategoryCrumb(html){
  if(html.indexOf(CRUMB_ANCHOR) === -1){
    console.error('product-page: breadcrumb anchor not found in template, client-side sub-category crumb skipped');
    return html;
  }
  html = html.replace(CRUMB_ANCHOR, () => "\">${product.category||''}</a>${window.__subcatCrumb ? window.__subcatCrumb(product) : ''}</div>");
  const script = `<script>window.__SUBCAT_PAGES=${JSON.stringify(SUBCATEGORY_PAGES)};`
    + `window.__subcatCrumb=function(p){var k=String(p&&p.subcategory||'').trim().toLowerCase();`
    + `if(!Object.prototype.hasOwnProperty.call(window.__SUBCAT_PAGES,k))return '';`
    + `var e=window.__SUBCAT_PAGES[k];return ' / <a href="'+e.path+'">'+e.label+'</a>';};</script>\n`;
  return html.replace('<script type="module">', () => script + '<script type="module">');
}

// ---------- SEO: keywords / title / description ----------
// Brand keywords go on every product page (this is what makes searches like
// "fashionista clothing" land on the site). Category + product-name keywords
// are added on top, so every product gets its own relevant Bangladesh terms.
const BRAND_KEYWORDS = [
  'fashionista',
  'fashionista bd',
  'fashionista bangladesh',
  'fashionista clothing',
  'fashion1sta',
  'online fashion store bangladesh',
  'cash on delivery bangladesh'
];

// Third-party brand names we must never target in keywords (trademark risk).
// Any generated keyword matching this is dropped, including ones that come
// from a product name typed in the admin panel.
const BLOCKED_KEYWORD_RE = /chrome\s*-?\s*hearts?/i;

// Matched against "<category> <product name>" (lowercase).
const CATEGORY_KEYWORDS = [
  { match: /glass|eyewear/, words: [
    'glasses for men', "men's glasses bangladesh", "men's glasses bd",
    'sunglasses for men', "men's sunglasses bd", 'fashion glasses bangladesh',
    'eyewear for men', 'sunglasses price in bangladesh', 'sunglasses bangladesh',
    'gothic sunglasses bangladesh', 'rimless glasses bd', 'aviator sunglasses bd',
    'round sunglasses bd', 'gothic accessories bd'
  ]},
  { match: /cloth|t-?shirt|\btee\b|shirt|hoodie|jersey/, words: [
    'clothing', 'fashionista clothing', "men's clothing bd", "men's t-shirt bangladesh",
    'gothic t-shirt bd', 'gothic clothing bangladesh', 'online clothing store bangladesh',
    't-shirt price in bangladesh'
  ]},
  { match: /chain|necklace|pendant/, words: [
    'necklace for men', "men's necklace bangladesh", "men's necklace bd",
    'chain for men', "men's chain necklace bd", 'chain necklace bangladesh',
    'chain necklace bd', 'gothic jewelry bangladesh', 'silver chain price in bangladesh'
  ]},
  { match: /bracelet|bangle/, words: [
    'bracelet for men', "men's bracelet bangladesh", "men's bracelet bd",
    'bracelets for men', 'silver bracelet bd', 'silver bracelet men bd',
    'gothic bracelet bangladesh', 'gothic jewelry bangladesh', 'bracelet price in bangladesh'
  ]},
  { match: /grill|grillz|teeth/, words: [
    'teeth grillz bangladesh', 'teeth grillz bd', 'grillz price in bangladesh'
  ]},
  { match: /bandana/, words: [
    'bandana for men', "men's bandana bangladesh", "men's bandana bd",
    'bandanas bangladesh', 'bandana bangladesh', 'bandana bd',
    'bandana price in bangladesh', 'bandana price in bd', 'bandana bd price',
    'printed bandana bangladesh', 'streetwear bandana bd', 'gothic bandana bangladesh'
  ]},
  { match: /\bring\b|\brings\b/, words: [
    'rings for men', "men's rings bangladesh", "men's rings bd",
    'men ring price in bangladesh', 'fashion rings for men'
  ]},
  { match: /watch/, words: [
    "men's watches bangladesh", 'watch price in bangladesh', 'watch bd'
  ]}
];

// Extra keywords picked up from words inside the product name.
const NAME_KEYWORDS = [
  { match: /rimless/, words: ['rimless sunglasses price in bangladesh', 'rimless glasses bd'] },
  { match: /aviator/, words: ['aviator sunglasses bd', 'aviator sunglasses price in bangladesh'] },
  { match: /\bround\b/, words: ['round sunglasses bd'] },
  { match: /y2k|retro|star/, words: ['retro y2k sunglasses bd', 'y2k accessories bangladesh'] },
  { match: /gold/, words: ['gold sunglasses bangladesh'] },
  { match: /silver/, words: ['silver accessories shop bd'] },
  { match: /black/, words: ['black sunglasses bd'] },
  { match: /cross/, words: ['gothic cross accessories bangladesh', 'silver cross bracelet bd'] },
  { match: /printed|print/, words: ['printed fashion accessories bangladesh'] },
  { match: /raglan|long sleeve/, words: ['raglan t-shirt bd', 'long sleeve t-shirt bangladesh'] }
];

function buildKeywords(product){
  const name = String(product.name || '').trim();
  const lowerName = name.toLowerCase();
  const hay = `${product.category || ''} ${name}`.toLowerCase();
  const list = [];
  if(name){
    list.push(lowerName, `${lowerName} price in bangladesh`, `${lowerName} bd`);
  }
  CATEGORY_KEYWORDS.forEach(c => { if(c.match.test(hay)) list.push(...c.words); });
  NAME_KEYWORDS.forEach(c => { if(c.match.test(hay)) list.push(...c.words); });
  list.push(...BRAND_KEYWORDS);
  // de-duplicate (case-insensitive), keep order, drop blocked third-party
  // brand terms, cap at 30
  const seen = new Set();
  const out = [];
  for(const k of list){
    if(BLOCKED_KEYWORD_RE.test(k)) continue;
    const key = k.toLowerCase();
    if(!seen.has(key)){ seen.add(key); out.push(k); }
  }
  return out.slice(0, 30);
}

// ---------- SEO: clean titles / meta descriptions / on-page copy ----------

// Decorative symbols typed into product descriptions (stars, bullets, emoji).
// In the meta description they become separators instead of showing up raw
// ("★As a headband ★ On your waist ...").
const DECOR_CODES = [0x2605, 0x2606, 0x2726, 0x2727, 0x2728, 0x2022, 0x25CF, 0x25AA, 0x25C6, 0x25C7, 0x27A4, 0x279C, 0x2714, 0x2713, 0x2B50, 0xFE0F];
const DECOR_RE = new RegExp('\\s*(?:[' + DECOR_CODES.map(c => String.fromCharCode(c)).join('') + ']|[\\u{1F300}-\\u{1FAFF}])+\\s*', 'gu');
const SEG = '\u0001';

// Words a cut-off sentence must not end on ("... with a.").
const DANGLING = new Set(['a','an','the','with','and','or','of','for','to','in','on','at','by','from','that','your','our','as','is','are','it','its','this','these','those']);

function normName(n){
  return String(n == null ? '' : n).toLowerCase().replace(/\s+/g, ' ').trim();
}

// "chrome heart bracelet" -> "Chrome Heart Bracelet" (title/meta only; the
// on-page <h1> keeps the name exactly as typed in the admin panel).
function titleCaseName(name){
  return String(name == null ? '' : name).trim().split(/\s+/).filter(Boolean).map(w => {
    if(/^y2k$/i.test(w)) return 'Y2K';
    if(/[A-Z]/.test(w.slice(1))) return w;           // keep mixed/upper case such as UV400
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

// Turns the owner-typed description into one clean sentence-style string:
// decorative symbols become separators, stray spaces before punctuation go,
// and a SHOUTING lead ("RAGLAN LONG SLEEVE A timeless...") is sentence-cased.
function cleanDescription(raw){
  if(!raw) return '';
  const segs = String(raw).replace(DECOR_RE, SEG).replace(/\s+/g, ' ').split(SEG)
    .map(s => s.trim()).filter(Boolean);
  if(!segs.length) return '';
  let out = segs[0];
  if(segs.length > 1){
    const rest = segs.slice(1)
      .map(s => s.replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase()).replace(/[\s,;]+$/, ''))
      .join(', ');
    out += (/[—–:-]$/.test(out) ? ' ' : ' — ') + rest;
  }
  out = out.replace(/^((?:[A-Z]{2,}\s+){1,5})(?![A-Z]{2,}\b)(?=[A-Za-z])/, m => `${titleCaseName(m.trim().toLowerCase())} — `);
  return out.replace(/\s+([,.;:!?])/g, '$1').replace(/\s+/g, ' ').trim();
}

// Shortens text to at most `room` characters at a sentence end when possible,
// otherwise at a word boundary, never leaving a dangling "with a" / "and the".
function cutAtBoundary(text, room){
  if(room <= 0) return '';
  if(text.length <= room) return text;
  const head = text.slice(0, room);
  const sentEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));
  if(sentEnd >= 35) return head.slice(0, sentEnd + 1);
  // No sentence end in range: cut at the last clause break (comma, dash, semicolon)
  // so the text still reads as a complete thought; the caller adds the period.
  const clauseEnd = Math.max(head.lastIndexOf(', '), head.lastIndexOf(' — '), head.lastIndexOf('—'), head.lastIndexOf('; '));
  if(clauseEnd >= 45) return head.slice(0, clauseEnd).replace(/[\s,;:\-—–]+$/, '');
  const limit = room - 1;                              // leave space for the ellipsis
  let cut = text.slice(0, limit);
  if(text.charAt(limit) !== ' '){
    const sp = cut.lastIndexOf(' ');
    if(sp > 40) cut = cut.slice(0, sp);
  }
  const words = cut.replace(/[\s,;:\-—–]+$/, '').split(' ');
  while(words.length > 6 && DANGLING.has(words[words.length - 1].toLowerCase().replace(/[^a-z]/g, ''))) words.pop();
  return words.join(' ').replace(/[\s,;:\-—–]+$/, '') + '…';
}

// Products in the same category that share this product's name (e.g. two
// "Chrome heart bracelet" listings) get a differentiator so their <title> and
// meta description are not identical: the price when the prices differ,
// otherwise "Style n" (stable, ordered by product id).
function variantSuffix(product, peers){
  const me = normName(product.name);
  const group = (Array.isArray(peers) ? peers : []).filter(p => normName(p.name) === me);
  if(!group.some(p => p.id === product.id)) group.push({ id: product.id, name: product.name, price: product.price });
  if(group.length < 2) return '';
  const prices = group.map(p => Number(p.price));
  if(new Set(prices).size === prices.length) return ` (BDT ${product.price})`;
  const ids = group.map(p => p.id).sort();
  return ` — Style ${ids.indexOf(product.id) + 1}`;
}

function buildTitle(label){
  const standardSuffix = ' Price in BD | FASHIONISTA';
  const bdSuffix = ' Price in BD | FASHIONISTA Bangladesh';
  const extendedSuffix = ' Price in BD | FASHIONISTA Bangladesh Online';
  const labelLength = String(label || 'Product').trim().length;
  let suffix = standardSuffix;
  if(labelLength + standardSuffix.length < 50){
    if(labelLength + bdSuffix.length >= 50 && labelLength + bdSuffix.length <= 60) suffix = bdSuffix;
    else if(labelLength + extendedSuffix.length <= 60) suffix = extendedSuffix;
  }
  const full = `${label}${suffix}`;
  if(full.length >= 50 && full.length <= 60) return full;

  // Keep the product name and store brand within the 50–60 character target.
  // Long names are shortened at a word boundary while preserving the price phrase.
  if(full.length < 50) return full;

  const maxLabelLength = 60 - suffix.length;
  let shortLabel = String(label || 'Product').trim();
  if(shortLabel.length > maxLabelLength){
    const head = shortLabel.slice(0, maxLabelLength - 1);
    const boundary = head.lastIndexOf(' ');
    const cut = boundary > 0 ? head.slice(0, boundary) : head;
    shortLabel = cut.replace(/[\s,;:—–-]+$/, '') + '…';
  }
  return `${shortLabel}${suffix}`;
}

// Meta description, at most 160 characters: "<name> — BDT <price>: <cleaned
// description> Price in Bangladesh — cash on delivery." The name and price
// lead, so products that share the same stored description (the bandana
// colours, say) still differ, and the price shows up in search snippets.
function buildDescription(product, label){
  const suffix = ' in Bangladesh at FASHIONISTA — cash on delivery in Dhaka and nationwide.';
  const cleaned = cleanDescription(product.description);
  if(!cleaned){
    const cat = product.category ? `${product.category} from FASHIONISTA` : 'from FASHIONISTA';
    const fallback = `${label} price in BD — BDT ${product.price}. ${cat}, cash on delivery in Dhaka and nationwide.`;
    return fallback.length <= 160 ? fallback : cutAtBoundary(fallback, 160);
  }
  // Lead with the product name unless the description already opens with it
  // (at least 3 of every 4 name words in its first 80 characters). Products
  // that carry a differentiator always lead with their full label.
  const baseName = label.replace(/ \(BDT \d+\)$| — Style \d+$/, '');
  const variant = baseName !== label;
  const nameWords = normName(baseName).split(' ').filter(Boolean);
  const opening = cleaned.slice(0, 80).toLowerCase();
  const hits = nameWords.filter(w => opening.includes(w)).length;
  const alreadyNamed = nameWords.length > 0 && hits / nameWords.length >= 0.75;
  // The BDT price goes into the lead for every product (a differentiator
  // label already carries its own price, so it is not repeated).
  const hasPrice = !variant && product.price != null && product.price !== '';
  const priceTxt = hasPrice ? ` — BDT ${product.price}` : '';
  const lead = (alreadyNamed && !variant && !hasPrice) ? '' : `${label}${priceTxt}: `;
  const room = 160 - lead.length - suffix.length - 1;   // -1: possible closing period
  const body = cutAtBoundary(cleaned, room);
  const tail = /[.!?…]$/.test(body) ? '' : '.';
  const result = `${lead}${body}${tail}${suffix}`;
  // Extremely long product names can otherwise make the generated meta
  // description exceed the intended 160-character limit.
  return result.length <= 160 ? result : cutAtBoundary(result, 160);
}

// Verified-catalog copy overrides for products flagged by the 2026-11-02
// read-only audit. These are page-rendering overrides only; Firestore is not
// modified. Copy sticks to the product name/category and avoids unverified
// claims about materials, dimensions, lens specs or construction.
const PRODUCT_DESCRIPTION_OVERRIDES = {
  'retro-double-sided-skull-cross': 'A double-sided skull cross accessory for gothic and alternative streetwear styling. The cross motif gives this piece a bold focal point; view the product photos to check the exact front and reverse design before ordering.',
  'chrome-heart-bracelet': 'Add a defined accessory detail to everyday streetwear with this bracelet. Its statement look pairs naturally with casual layers; use the product photos to inspect the exact design and choose it to complement your existing accessories.',
  'chrome-heart-black-silver': 'Black-and-silver glasses for a sharp Y2K-inspired or alternative streetwear look. Compare the frame appearance in the product photos and check the current BDT price and availability before placing an order.',
  'green-bandana': 'A green bandana brings a fresh colour accent to casual and streetwear outfits. Wear it as a headband, neck accessory or waist detail, or style it with a bag; check the photos for the exact print and colour appearance.',
  'chrome-heart-black-gold': 'Black-and-gold statement glasses that add contrast to Y2K, retro and streetwear outfits. Review the product photos for the frame design and check the current BDT price and stock status before ordering.',
  'spider-pendant': 'A spider pendant for gothic-inspired outfits and alternative accessory styling. Let the pendant stand out on its own or pair it with other pieces; check the product photos for the exact design before ordering.',
  'chrome-heart-bracelet-2': 'This bracelet offers another statement accessory option for building a layered streetwear look. Pair it with a watch or wear it on its own, and refer to the product photos to confirm the design of this listing.',
  'pink-bandana': 'A pink bandana adds a brighter colour accent to everyday outfits and streetwear looks. Style it as a headband, neck scarf or waist accessory, or attach it to a bag; use the product photos to check the exact print and shade.'
};

function applyProductDescriptionOverride(product){
  const slug = String(product && product.slug || '').toLowerCase();
  const description = PRODUCT_DESCRIPTION_OVERRIDES[slug];
  return description ? { ...product, description } : product;
}

// Product-aware on-page copy. Keep claims limited to visible product data;
// never infer frame, fabric, metal, fit or other specifications from a name.
function categoryBlurb(product){
  const hay = `${product.category || ''} ${product.name || ''}`.toLowerCase();
  const name = esc(titleCaseName(product.name) || 'This style');
  if(String(product.slug || '').toLowerCase() === 'red-bandana') return 'A red bandana adds a bold colour accent to streetwear outfits. Style it as a headband, neck scarf, wrist accent or accessory on a bag, and check the product photos for the exact design.';
  if(String(product.slug || '').toLowerCase() === 'chrome-heart-black-gold') return 'Black-and-gold statement glasses for Y2K, retro and streetwear outfits. Check the product photos and current BDT price before ordering.';
  if(String(product.slug || '').toLowerCase() === 'chrome-heart-rimless-gold') return 'Gold-tone rimless glasses for Y2K and streetwear looks. Review the product photos to confirm the exact frame appearance, then check the current BDT price and availability.';
  if(/bandana/.test(hay)) return `${name} is a bandana option for men and anyone looking to add a print or colour accent to a streetwear look. Review the photos to check the exact pattern, then explore ways to style it as a headband, neck scarf or bag accessory.`;
  if(product && product.id === 'hRTjTVeGAcjWuwFAMwcs') return 'These silver rimless glasses bring a minimalist eyewear look to Y2K outfits and everyday streetwear. Review the product photos and current BDT price before ordering.';
  if(/glass|eyewear/.test(hay)) return `${name} is part of FASHIONISTA's men's glasses and sunglasses collection for Y2K, retro and streetwear-inspired outfits. Compare the product photos to check the frame's visible shape and colour, and review the listed price and availability before ordering.`;
  if(/cloth|t-?shirt|\btee\b|shirt|hoodie|jersey/.test(hay)) return `${name} is part of FASHIONISTA's streetwear clothing range. Check the size options and product photos on this page before ordering; use the listed product details rather than assuming fabric or fit.`;
  if(/bracelet|bangle/.test(hay)) return `${name} is a men's bracelet option for a standalone or layered streetwear look. Check the product photos for its exact design and compare the listed price before pairing it with a watch or other accessories.`;
  if(/\brings?\b/.test(hay)) return `${name} is part of FASHIONISTA's men's fashion ring range for gothic and streetwear outfits. Review the product photos and listed details to check the exact design and any sizing information before ordering.`;
  if(/chain|necklace|pendant/.test(hay)) return `${name} is part of FASHIONISTA's men's chain necklace and pendant range for gothic and streetwear outfits. Review the product photos and listed details to check the exact design before styling it with other pieces.`;
  if(/grill/.test(hay)) return `${name} is part of FASHIONISTA's accessories range for alternative streetwear outfits. Review the product photos and listed details to check the exact design before ordering.`;
  return `${name} is available from FASHIONISTA. Review the product photos, listed details and current BDT price to check that this style is right for you.`;
}

const PRODUCT_CONTENT_OVERRIDES = {
  'retro-double-sided-skull-cross': {
    title: 'Retro Double-Sided Skull Cross | FASHIONISTA',
    description: 'Explore the Retro Double-Sided Skull Cross at FASHIONISTA. View the front-and-back design in the product photos, check the current BDT price and availability, and order with cash on delivery across Bangladesh.',
    h2: 'Retro Double-Sided Skull Cross Design',
    body: 'The Retro Double-Sided Skull Cross features a skull-and-cross design made to be viewed from both sides. Check the product gallery to inspect the details and confirm the current price and stock before ordering.',
    faq: 'What is the price of the Retro Double-Sided Skull Cross in Bangladesh?'
  },
  'spider-pendant': {
    title: 'Spider Pendant Price in Bangladesh | FASHIONISTA',
    description: 'Shop the Spider Pendant at FASHIONISTA in Bangladesh. Inspect the product photos for the exact pendant design, check the current BDT price and availability, and order with cash on delivery.',
    h2: 'Spider Pendant Design',
    body: 'The Spider Pendant adds a spider-inspired detail to gothic and alternative outfits. Review the gallery for the exact pendant design and check the listing details to confirm what is included before ordering.',
    faq: 'What is the current Spider Pendant price in Bangladesh?'
  },
  'chrome-heart-bracelet': {
    title: 'Men’s Bracelet Price in Bangladesh | FASHIONISTA',
    description: 'Shop men’s bracelets at FASHIONISTA in Bangladesh. View this gothic-inspired streetwear design, check the current BDT price and stock, and order with cash on delivery nationwide.',
    h2: 'Men’s Bracelet Price in Bangladesh',
    body: 'Explore this men’s bracelet in FASHIONISTA’s streetwear accessories collection. Review the product photos for its exact design and finish, then check the current bracelet price in Bangladesh and stock status before ordering.',
    faq: 'Where can I buy men’s bracelets in Bangladesh?'
  },
  'chrome-heart-bracelet-2': {
    title: 'Streetwear Bracelet Design & Price in Bangladesh | FASHIONISTA',
    description: 'Explore another men’s streetwear bracelet design at FASHIONISTA. Compare its product photos, current BDT price and availability, with cash on delivery across Bangladesh.',
    h2: 'Streetwear Bracelet Design',
    body: 'This bracelet is a separate design in FASHIONISTA’s accessories collection. Review its product gallery and compare the current BDT price and stock with other men’s bracelet styles before ordering.',
    faq: 'How much does this streetwear bracelet cost in Bangladesh?'
  },
  'chrome-heart-black-silver': {
    title: 'Black and Silver Glasses Price in Bangladesh | FASHIONISTA',
    description: 'Shop black-and-silver glasses at FASHIONISTA in Bangladesh. Check the frame photos, current BDT price and availability, with cash on delivery nationwide.',
    h2: 'Black and Silver Glasses',
    body: 'These black-and-silver glasses bring a contrasting look to retro and streetwear outfits. Review the gallery to inspect the frame shape and details, then check the current BDT price and availability before ordering.',
    faq: 'What is the price of black-and-silver glasses in Bangladesh?'
  },
  'green-bandana': {
    title: 'Green Bandana Price in Bangladesh | FASHIONISTA',
    description: 'Shop a green bandana at FASHIONISTA in Bangladesh. View the product photos, check the current BDT price and stock, and order with cash on delivery nationwide.',
    h2: 'Green Bandana Styling',
    body: 'A green bandana adds a colour accent to casual and streetwear outfits. Try styling it as a headband, neck scarf or accessory on a bag, and check the photos for the exact shade and pattern.',
    faq: 'What is the current green bandana price in Bangladesh?'
  },
  'pink-bandana': {
    title: 'Pink Bandana Price in Bangladesh | FASHIONISTA',
    description: 'Shop a pink bandana at FASHIONISTA in Bangladesh. Compare its photos and current BDT price, check availability, and order with cash on delivery nationwide.',
    h2: 'Pink Bandana Styling',
    body: 'A pink bandana adds a softer colour accent to everyday and streetwear outfits. Style it as a headband, neck scarf or bag accessory, and use the product photos to check the exact shade and pattern.',
    faq: 'What is the current pink bandana price in Bangladesh?'
  },
  'chrome-heart-black-gold': {
    title: 'Black and Gold Glasses Price in Bangladesh | FASHIONISTA',
    description: 'Shop black-and-gold glasses at FASHIONISTA in Bangladesh. Check the frame photos, current BDT price and availability, with cash on delivery nationwide.',
    h2: 'Black and Gold Glasses Price in Bangladesh',
    body: 'This black-and-gold eyewear style adds a bold colour contrast to retro and streetwear outfits. Review the product gallery for the exact frame shape and details, then check the current BDT price and availability before ordering.',
    faq: 'Where can I buy black-and-gold glasses in Bangladesh?'
  },

  'chrome-heart-rimless-gold': {
    title: 'Gold Rimless Glasses Price in Bangladesh | FASHIONISTA',
    description: 'Shop gold-tone rimless glasses at FASHIONISTA in Bangladesh. Inspect the frame photos, check the current BDT price and stock, and order with cash on delivery nationwide.',
    h2: 'Gold Rimless Glasses',
    body: 'These gold-tone rimless glasses offer a minimal frame look for everyday and smart-casual outfits. Review the product gallery for the exact shape and finish, then check the current price and availability before ordering.',
    faq: 'What is the price of gold rimless glasses in Bangladesh?'
  },
  'chrome-heart-rimless-silver': {
    title: 'Silver Rimless Glasses Price in Bangladesh | FASHIONISTA',
    description: 'Explore silver-tone rimless glasses at FASHIONISTA in Bangladesh. Check the frame photos, current BDT price and availability, with cash on delivery nationwide.',
    h2: 'Silver Rimless Glasses',
    body: 'These silver-tone rimless glasses provide a clean, minimal look. Use the product gallery to inspect the frame shape and details, then check the current BDT price and stock before ordering.',
    faq: 'Where can I buy silver rimless glasses in Bangladesh?'
  },
  'retro-y2k-star-glass': {
    title: 'Y2K Star Sunglasses Price in Bangladesh | FASHIONISTA',
    description: 'Shop Y2K star sunglasses at FASHIONISTA in Bangladesh. View the frame photos, check the current BDT price and stock, and order with cash on delivery nationwide.',
    h2: 'Y2K Star Sunglasses',
    body: 'These star-shaped sunglasses bring a playful Y2K-inspired look to retro and streetwear outfits. Check the product gallery for the exact frame shape and finish, then review the current BDT price and availability before ordering.',
    faq: 'What is the price of Y2K star sunglasses in Bangladesh?'
  },
};


// Product-specific search snippets for all 22 live catalogue products.
const PRODUCT_META_OVERRIDES = {
  "retro-double-sided-skull-cross": {
    "title": "Retro Skull Cross Accessory Price in BD | FASHIONISTA",
    "description": "Shop the Retro Double-Sided Skull Cross at FASHIONISTA. View both sides, current BDT {price} and stock. Cash on delivery across Bangladesh."
  },
  "red-bandana": {
    "title": "Red Bandana Price in Bangladesh | Y2K Style | FASHIONISTA",
    "description": "Shop the red bandana at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, and order with cash on delivery nationwide."
  },
  "chrome-heart-bracelet": {
    "title": "Men’s Bracelet Price in Bangladesh | FASHIONISTA",
    "description": "Shop this men’s bracelet at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-rimless-gold": {
    "title": "Gold Rimless Glasses Price in Bangladesh | FASHIONISTA",
    "description": "Shop gold-tone rimless glasses in Bangladesh at FASHIONISTA. Check frame photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-black-silver": {
    "title": "Black and Silver Glasses Price in Bangladesh | FASHIONISTA",
    "description": "Shop black-and-silver glasses in Bangladesh at FASHIONISTA. View frame photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-hearts-raised-cross-dog-tag": {
    "title": "Chrome Hearts Raised Cross Dog Tag Price in BD | FASHIONISTA",
    "description": "Shop the Chrome Hearts Raised Cross Dog Tag at FASHIONISTA. Check photos, current BDT {price} and stock, with cash on delivery in Bangladesh."
  },
  "green-bandana": {
    "title": "Green Bandana Price in Bangladesh | Y2K Style | FASHIONISTA",
    "description": "Shop the green bandana at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-black-gold": {
    "title": "Black and Gold Glasses Price in Bangladesh | FASHIONISTA",
    "description": "Shop black-and-gold glasses at FASHIONISTA. Check frame photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-chain": {
    "title": "Chrome Heart Chain Necklace Price in BD | FASHIONISTA",
    "description": "Shop the Chrome Heart chain at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-fire-heart-chain": {
    "title": "Chrome Fire Heart Chain Price in Bangladesh | FASHIONISTA",
    "description": "Shop the Chrome Fire Heart Chain at FASHIONISTA in Bangladesh. Check photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "vintage-dark-cross-hollow-out-necklace": {
    "title": "Vintage Dark Cross Necklace Price in BD | FASHIONISTA",
    "description": "Shop the Vintage Dark Cross Hollow-Out Necklace at FASHIONISTA. Check photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-double-heart-chain": {
    "title": "Chrome Double Heart Chain Price in Bangladesh | FASHIONISTA",
    "description": "Shop the Chrome Double Heart Chain at FASHIONISTA. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "spider-pendant": {
    "title": "Spider Pendant Price in Bangladesh Online | FASHIONISTA",
    "description": "Shop the Spider Pendant at FASHIONISTA in Bangladesh. Check photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-bracelet-2": {
    "title": "Streetwear Bracelet Design Price in Bangladesh | FASHIONISTA",
    "description": "Explore this men’s streetwear bracelet at FASHIONISTA. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-rimless-silver": {
    "title": "Silver Rimless Glasses Price in Bangladesh | FASHIONISTA",
    "description": "Shop silver-tone rimless glasses in Bangladesh at FASHIONISTA. Check frame photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "pink-bandana": {
    "title": "Pink Bandana Price in Bangladesh | Y2K Style | FASHIONISTA",
    "description": "Shop the pink bandana at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "y2k-star-necklace": {
    "title": "Y2K Star Necklace Price in Bangladesh | FASHIONISTA",
    "description": "Shop the Y2K Star Necklace at FASHIONISTA in Bangladesh. Check photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "retro-y2k-star-glass": {
    "title": "Y2K Star Sunglasses Price in Bangladesh | FASHIONISTA",
    "description": "Shop Y2K star sunglasses in Bangladesh at FASHIONISTA. Check frame photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "sun-moon-couple-set": {
    "title": "Sun Moon Couple Set Price in Bangladesh | FASHIONISTA",
    "description": "Shop the Sun Moon Couple Set at FASHIONISTA in Bangladesh. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "chrome-heart-bracelet-3": {
    "title": "Men’s Bracelet Design 3 Price in Bangladesh | FASHIONISTA",
    "description": "View this men’s bracelet design at FASHIONISTA. Check product photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "raglan-long-sleeve-t-shirt": {
    "title": "Raglan Long Sleeve T-Shirt Price in Bangladesh | FASHIONISTA",
    "description": "Shop the Raglan Long Sleeve T-Shirt at FASHIONISTA in Bangladesh. Check sizes, photos, current BDT {price} and stock, with cash on delivery nationwide."
  },
  "gothic-fleur-de-lis-cross-pendant": {
    "title": "Gothic Fleur-de-Lis Cross Pendant Price in BD | FASHIONISTA",
    "description": "Shop the Gothic Fleur-de-Lis Cross Pendant at FASHIONISTA. Check photos, current BDT {price} and stock, with cash on delivery across Bangladesh."
  }
};

// Server-rendered "About this product" block. It is injected OUTSIDE
// #productRoot on purpose: the client-side hydration replaces everything inside
// #productRoot, which would remove this text again and leave the page thin.
function renderInfoSection(product){
  const name = esc(titleCaseName(product.name) || 'This product');
  const price = Number(product.price);
  const hasPrice = Number.isFinite(price);
  const catRaw = String(product.category || '').trim().toLowerCase();
  const cat = /^new/.test(catRaw) ? '' : catRaw;         // "New In" is a shelf, not a product type
  const sizes = getSizes(product);
  const outOfStock = product.stock === 0;
  const was = Number(product.was);
  const discount = hasPrice && was > price ? Math.round((1 - price / was) * 100) : 0;
  const subPage = subcategoryPage(product);
  const isBlackGoldGlasses = String(product.slug || '').toLowerCase() === 'chrome-heart-black-gold';
  const isChromeHeartRimlessGold = String(product.slug || '').toLowerCase() === 'chrome-heart-rimless-gold';
  const isRaglanLongSleeveTShirt = String(product.slug || '').toLowerCase() === 'raglan-long-sleeve-t-shirt';
  const isRedBandana = String(product.slug || '').toLowerCase() === 'red-bandana';
  const isY2kStarGlasses = String(product.slug || '').toLowerCase() === 'retro-y2k-star-glass';
  const productContentOverride = PRODUCT_CONTENT_OVERRIDES[String(product.slug || '').toLowerCase()] || null;
  const productCategoryUrl = categoryPath(product.category);

  const intro = [
    `${name} ${cat ? `is part of our ${esc(cat)} collection at FASHIONISTA` : 'is available at FASHIONISTA'}`,
    hasPrice ? ` and costs BDT ${price}${discount > 0 ? `, ${discount}% off the original BDT ${was}` : ''}` : '',
    '. We deliver across Bangladesh with cash on delivery, so you pay when the parcel reaches you.',
    outOfStock ? ' This item is currently out of stock; message us on WhatsApp to ask when it will be back.' : '',
    sizes.length ? ` Available sizes: ${sizes.map(esc).join(', ')}.` : ''
  ].join('');

  return `
<section class="seo-info" aria-labelledby="seoInfoHead">
  <h2 id="seoInfoHead" class="display">${productContentOverride ? productContentOverride.h2 : isChromeHeartRimlessGold ? 'Chrome Heart Rimless Glasses Price in Bangladesh' : isBlackGoldGlasses ? 'Chrome Heart Glasses Price in Bangladesh' : isRaglanLongSleeveTShirt ? 'Raglan Long Sleeve T-Shirt Price in Bangladesh' : isRedBandana ? 'Red Bandana Price in Bangladesh' : `About ${name}`}</h2>
  <p>${intro}</p>
  <p>${isRaglanLongSleeveTShirt ? 'A long sleeve raglan T-shirt is an easy streetwear layer for casual everyday outfits. Check the product photos, available sizes and current price before ordering; fabric and fit details should be confirmed from the listed product information.' : esc(productContentOverride ? productContentOverride.body : categoryBlurb(product))}</p>
  ${isChromeHeartRimlessGold ? `<p>Looking for Chrome Heart rimless glasses in Bangladesh? This gold-tone rimless style is listed at BDT ${hasPrice ? price : 'the price shown above'} at FASHIONISTA. If you are comparing Chrome Hearts rimless glasses prices, use the gallery to inspect the frame and check the live stock status before ordering.</p><p>Browse more styles in our <a href="${esc(productCategoryUrl)}">glasses collection</a> or check <a href="/shipping">delivery charges and timelines</a>.</p>` : ''}
  ${isBlackGoldGlasses ? `<p>Looking for Chrome Heart-style glasses in Bangladesh? The current listed price for this black-and-gold pair at FASHIONISTA is BDT ${hasPrice ? price : 'shown above'}. Review the product photos and availability on this page before ordering; we do not list frame or lens specifications unless they are confirmed in the product details.</p><p>Explore more eyewear in our <a href="${esc(productCategoryUrl)}">glasses collection</a>, or check <a href="/shipping">delivery charges and timelines</a> for your location.</p>` : ''}
  ${isRaglanLongSleeveTShirt ? `<p>Looking for a raglan long sleeve T-shirt in Bangladesh? The current listed price at FASHIONISTA is BDT ${hasPrice ? price : 'shown above'}. Check the available size options and product photos before placing your order. Browse more styles in our <a href="${esc(productCategoryUrl)}">clothing collection</a> or review <a href="/shipping">delivery charges and timelines</a>.</p>` : ''}
  ${isRedBandana ? `<p>Looking for a red bandana in Bangladesh? Check the current BDT price, availability and product photos above before ordering. A red bandana can add a strong colour accent to a streetwear outfit; try it as a headband, neck scarf or wrist accessory. Browse the <a href="/bandanas">bandana collection</a>, explore <a href="/accessories">Fashionista accessories</a>, and review <a href="/shipping">delivery charges and timelines</a>.</p>` : ''}
  ${isY2kStarGlasses ? `<p>Looking for Y2K star glasses in Bangladesh? This pair is listed at BDT ${hasPrice ? price : 'the price shown above'} at FASHIONISTA. Use the product gallery to inspect the frame shape and details, and check current stock before ordering. Browse more <a href="/glasses">Y2K glasses and sunglasses</a> or review <a href="/shipping">delivery charges and timelines</a>.</p>` : ''}
  ${subPage ? `<p>Browse all <a href="${subPage.path}">${esc(subPage.label.toLowerCase())}</a> at FASHIONISTA.</p>` : ''}
  <h3>${productContentOverride ? productContentOverride.faq : isChromeHeartRimlessGold ? 'What is the price of Chrome Heart rimless glasses in Bangladesh?' : isBlackGoldGlasses ? 'What is the price of Chrome Heart glasses in Bangladesh?' : isRaglanLongSleeveTShirt ? 'What is the price of a raglan long sleeve T-shirt in Bangladesh?' : isRedBandana ? 'Where can I buy a red bandana in Bangladesh?' : isY2kStarGlasses ? 'Where can I buy Y2K star glasses in Bangladesh?' : `What is the price of ${name} in Bangladesh?`}</h3>
  <p>${hasPrice ? `${isChromeHeartRimlessGold ? 'Chrome Heart-style rimless glasses' : isBlackGoldGlasses ? 'Chrome Heart-style glasses' : isRaglanLongSleeveTShirt ? 'Raglan long sleeve T-shirt' : isRedBandana ? 'The red bandana' : isY2kStarGlasses ? 'Y2K star glasses' : name} costs BDT ${price} at FASHIONISTA. ` : ''}${isRedBandana ? 'Order online from FASHIONISTA and pay cash on delivery across Bangladesh. Check the product photos and stock status before placing your order. ' : isY2kStarGlasses ? 'Check the gallery and availability before placing your order. ' : ''}Delivery charges depend on where you live; see our <a href="/shipping">shipping info</a> for charges, timelines and how order confirmation works.</p>
  <h3>Can I pay cash on delivery?</h3>
  <p>Yes. We offer cash on delivery nationwide across Bangladesh, so there is nothing to pay online.</p>
  <h3>What if the item is damaged or the wrong size?</h3>
  <p>Inspect your parcel in front of the delivery person and report any damaged, incorrect or wrong-size item on the spot, or within 7 days of delivery. Full details are in our <a href="/return-policy">return and exchange policy</a>.</p>
  <h3>Have a question before you order?</h3>
  <p>Message us on WhatsApp or visit our <a href="/contact">contact page</a>. We usually reply within a few hours.</p>
</section>`;
}

const SEO_INFO_CSS = `<style>
  .seo-info{padding:6px 22px 40px;max-width:760px;}
  .seo-info h2{font-family:'Fraunces',serif;font-weight:500;font-size:19px;margin-bottom:14px;padding-bottom:13px;border-bottom:1px solid var(--line);}
  .seo-info h3{font-size:14px;font-weight:600;color:var(--silver-bright);margin:18px 0 6px;}
  .seo-info p{font-size:13.5px;color:var(--text-dim);line-height:1.7;margin-bottom:10px;}
  .seo-info a{color:var(--silver-bright);text-decoration:underline;text-underline-offset:2px;}
</style>`;

const DEFAULT_CLOTHING_SIZES = ['M','L','XL'];
function getSizes(product){
  if(Array.isArray(product.sizes) && product.sizes.length) return product.sizes;
  if(String(product.category||'').trim().toLowerCase() === 'clothing') return DEFAULT_CLOTHING_SIZES;
  return [];
}

// Mirrors the client's renderProduct() markup closely enough that
// hydration (which replaces this with the exact same function, client-
// side) causes no visible jump — the only difference is this version has
// no event listeners wired yet, which happens within a tick of hydration.
function renderSnapshot(product, similar){
  const outOfStock = product.stock === 0;
  const sizes = getSizes(product);
  const discount = product.was ? Math.round((1 - product.price/product.was) * 100) : 0;
  const soldText = product.sold ? `${product.sold >= 1000 ? (product.sold/1000).toFixed(1).replace('.0','')+'k' : product.sold} sold` : '';
  // Keep the visible gallery in the same image order used by Product schema,
  // the image sitemap and /product-image/:id. The primary imageUrl always comes
  // first, followed by unique additional images.
  const images = [];
  if(typeof product.imageUrl === 'string' && /^https?:\/\//i.test(product.imageUrl)) images.push(product.imageUrl);
  if(Array.isArray(product.images)) {
    product.images.forEach(src => {
      if(typeof src === 'string' && /^https?:\/\//i.test(src) && !images.includes(src)) images.push(src);
    });
  }
  const imageSrc = i => `${SITE}/product-image/${encodeURIComponent(product.id)}.jpg${i ? `?n=${i}` : ''}`;
  const media = images.length
    ? `<img id="mainProductImg" src="${esc(imageSrc(0))}" alt="${esc(product.name)} - ${esc(String(product.category || "accessories").toLowerCase())} | FASHIONISTA" fetchpriority="high" style="${outOfStock?'opacity:0.4;':''}">`
    : '';
  const thumbs = images.length > 1
    ? `<div class="p-thumbs" id="pThumbs">${images.map((img,i)=>`<img src="${esc(imageSrc(i))}" alt="${esc(product.name)} - ${esc(String(product.category || "accessories").toLowerCase())} photo ${i+1} | FASHIONISTA" class="${i===0?'active':''}" data-i="${i}" loading="lazy" decoding="async">`).join('')}</div>`
    : '';

  const actions = outOfStock
    ? `<div class="p-actions"><button class="btn-outline" disabled style="opacity:0.5;cursor:not-allowed;flex:1;">Currently Out of Stock</button></div>`
    : `${sizes.length ? `
      <div class="size-row" id="sizeRow">
        <span class="label">Size <b id="sizeVal"></b></span>
        <div class="size-options" id="sizeOptions">
          ${sizes.map(s=>`<button type="button" class="size-btn" data-size="${esc(s)}">${esc(s)}</button>`).join('')}
        </div>
        <p class="size-err">Please select a size.</p>
      </div>` : ''}
      <div class="qty-row">
        <span class="label">Quantity</span>
        <div class="qty-control">
          <button id="qtyDec">−</button>
          <span id="qtyVal">1</span>
          <button id="qtyInc">+</button>
        </div>
      </div>
      <div class="p-actions">
        <button class="btn-outline" id="addCartBtn">Add to Cart</button>
        <button class="btn-solid" id="buyNowBtn">Buy Now</button>
      </div>`;

  const similarCards = similar.map(p=>{
    const similarImage = p.imageUrl
      ? (p.id ? `${SITE}/product-image/${encodeURIComponent(p.id)}.jpg` : p.imageUrl)
      : '';
    const m = similarImage
      ? `<img src="${esc(similarImage)}" alt="${esc(p.name)} - ${esc(String(p.category || 'accessories').toLowerCase())} | FASHIONISTA" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;">`
      : '';
    return `<div class="card"><a href="${esc(productPath(p))}" class="card-link"><div class="frame">${m}</div><h3>${esc(p.name)}</h3></a><div class="price"><span class="now">BDT ${p.price}</span>${p.was?`<span class="was">BDT ${p.was}</span>`:''}</div></div>`;
  }).join('');

  return `
    <div class="breadcrumb"><a href="/shop">Shop</a> / <a href="${esc(categoryPath(product.category))}">${esc(product.category||'')}</a>${crumbSub(product)}</div>
    <div class="p-frame" id="pFrame">
      ${discount>0 && !outOfStock ? `<span class="discount-badge">-${discount}% OFF</span>` : ''}
      ${outOfStock ? `<span class="discount-badge" style="background:var(--text-dim);">Out of Stock</span>` : ''}
      ${media}
    </div>
    ${thumbs}
    <div class="p-info">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
        <h1 class="display">${esc(titleCaseName(product.name))} Price in BD</h1>
        <button id="favBtn" aria-label="Save" style="flex-shrink:0;width:38px;height:38px;border-radius:50%;border:1px solid var(--line);background:none;color:var(--silver);display:flex;align-items:center;justify-content:center;cursor:pointer;">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" style="width:17px;height:17px;"><path d="M12 20s-8-5-8-11a5 5 0 0 1 9-3 5 5 0 0 1 9 3c0 6-8 11-8 11z"/></svg>
        </button>
      </div>
      <div class="p-price">BDT ${product.price}${product.was?`<span class="was">BDT ${product.was}</span>`:''}</div>
      ${soldText ? `<p class="p-sold">${esc(soldText)}</p>` : ''}
      ${actions}
      ${product.description ? `
      <div style="padding:24px 0;border-top:1px solid var(--line);margin-top:8px;">
        <div style="font-size:11px;letter-spacing:0.14em;color:var(--text-dim);text-transform:uppercase;margin-bottom:12px;">Description</div>
        <p style="font-size:13.5px;color:var(--text-dim);line-height:1.7;white-space:pre-line;">${esc(product.description)}</p>
      </div>` : ''}
    </div>
    <section class="collection">
      <div class="section-head"><h2 class="display">Similar Products</h2></div>
      <div class="grid" id="similarGrid">${similarCards}</div>
    </section>`;
}

// Sends a permanent redirect. Short edge cache so a slug that is later
// changed in the admin doesn't stay stale for long.
function redirectPermanent(res, location){
  res.setHeader('Location', location);
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
  res.status(301).end();
}

module.exports = async function handler(req, res){
  const query = req.query || {};
  const id = query.id ? String(query.id) : '';
  // /product/<slug> arrives as ?slug= (see the rewrite in vercel.json).
  const bySlug = !!query.slug;
  let slug = '';
  if(bySlug){
    try{ slug = decodeURIComponent(String(query.slug)).toLowerCase(); }catch(e){ slug = ''; }
  }
  const templatePath = path.join(__dirname, '..', 'templates', 'product.html');

  let html;
  try{
    html = fs.readFileSync(templatePath, 'utf8');
  }catch(e){
    console.error('product.html template missing:', e);
    res.status(500).send('Template not found');
    return;
  }

  // Adds the optional sub-category step to the client-rendered breadcrumb
  // (see withSubcategoryCrumb above). Applied before every code path below,
  // so the template is patched the same way however the page is served.
  html = withSubcategoryCrumb(html);

  // The page can be served from /product/<slug>, one level below the site root,
  // while the template (and js/cart.js, js/footer.js ...) use root-relative
  // paths such as "js/cart.js" and "shop.html". <base href="/"> keeps every one
  // of them resolving against the site root.
  html = html.replace('<meta charset="UTF-8">', () => '<meta charset="UTF-8">\n<base href="/">');

  // Favicon: the old favicon.svg was removed; the brand logo now lives at
  // /favicon.png (512x512), used for the tab icon and the iOS home-screen icon.
  html = html.replace(
    '<link rel="icon" type="image/svg+xml" href="favicon.svg">\n<link rel="alternate icon" href="favicon-4.ico">\n<link rel="apple-touch-icon" href="apple-touch-icon-4.png">',
    () => '<link rel="icon" type="image/png" sizes="512x512" href="/favicon.png">\n<link rel="apple-touch-icon" href="/favicon.png">'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if(!id && !bySlug){
    // A product template without an ID or slug is not a valid product page.
    // Return a real 404 so crawlers do not treat this empty shell as indexable.
    html = html.replace(
      '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="noindex, follow">'
    );
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).send(html);
    return;
  }

  let product = null;
  let fetchFailed = false;
  try{
    if(bySlug){
      // A slug that could never have been generated can't match a product.
      product = validSlug(slug) ? await fetchProductBySlug(slug) : null;
    }else{
      product = await fetchProduct(id);
    }
  }catch(e){
    console.error('SSR product fetch failed, serving unmodified template:', e);
    fetchFailed = true;
  }

  if(fetchFailed){
    res.setHeader('Cache-Control', 'no-store');
    // If the product lookup failed, do not send a successful HTML response
    // to crawlers: it would look like a valid but empty product page. A 503
    // asks crawlers to retry after the temporary data/API failure is resolved.
    const ua = String((req && req.headers && req.headers['user-agent']) || '');
    if(CRAWLER_UA.test(ua)){
      res.setHeader('Retry-After', '120');
      res.status(503).send('Service temporarily unavailable. Please try again shortly.');
      return;
    }
    if(bySlug && validSlug(slug)){
      html = html.replace(
        '<link rel="canonical" id="canonicalLink" href="https://fashion1sta.com/product.html">',
        () => `<link rel="canonical" id="canonicalLink" href="${SITE}/product/${slug}">`
      );
    }
    // For shoppers, retain the existing client-side retry/fallback behavior.
    res.status(200).send(html);
    return;
  }

  if(!product){
    // Firestore positively confirmed there's no such product — a real dead
    // link, so tell crawlers directly instead of leaving the default
    // "index, follow" in place. A /product/<slug> URL is a proper 404.
    html = html.replace(
      '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="noindex, follow">'
    );
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(404).send(html);
    return;
  }

  // Consolidate old ID URLs and any stale name-derived slug aliases to the
  // product's current canonical URL.
  if(validSlug(product.slug) && ((!bySlug) || product.slug !== slug)){
    redirectPermanent(res, productPath(product));
    return;
  }

  // Apply unique, verified-catalog copy before metadata, schema and SSR markup
  // are built so crawlers and shoppers receive the same product description.
  product = applyProductDescriptionOverride(product);

  const [similar, reviews, peers] = await Promise.all([
    fetchSimilar(product.category, product.id),
    fetchReviews(product.id),
    fetchCategoryPeers(product.category)
  ]);

  const url = `${SITE}${productPath(product)}`;
  // Name used in <title>/meta: title-cased, plus a differentiator when another
  // product in the category has the very same name.
  const label = `${titleCaseName(product.name) || 'Product'}${variantSuffix(product, peers)}`;
  // SEO override for this exact product only. Describes the style instead of
  // naming a third-party brand.
  const isSilverRimlessOverride = product.id === 'hRTjTVeGAcjWuwFAMwcs';
  const isBlackGoldGlassesOverride = String(product.slug || '').toLowerCase() === 'chrome-heart-black-gold';
  const isChromeHeartRimlessGoldOverride = String(product.slug || '').toLowerCase() === 'chrome-heart-rimless-gold';
  const isRedBandanaOverride = String(product.slug || '').toLowerCase() === 'red-bandana';
  const isRaglanTeeOverride = String(product.slug || '').toLowerCase() === 'raglan-long-sleeve-t-shirt';
  const isY2kStarGlassesOverride = String(product.slug || '').toLowerCase() === 'retro-y2k-star-glass';
  const productContentOverride = PRODUCT_CONTENT_OVERRIDES[String(product.slug || '').toLowerCase()] || null;
  const metaOverride = PRODUCT_META_OVERRIDES[String(product.slug || '').toLowerCase()] || productContentOverride || null;
  const rawMetaDescription = metaOverride && metaOverride.description
    ? String(metaOverride.description).replace(/\{price\}/g, () => String(product.price)).replace(/\s+/g, ' ').trim()
    : buildDescription(product, label);
  const desc = rawMetaDescription.length <= 160 ? rawMetaDescription : cutAtBoundary(rawMetaDescription, 160);
  // Use first-party image URLs in metadata/schema so Google can crawl the photos
  // without depending on the external image host. Keep order identical to
  // api/product-image.js: imageUrl first, then the remaining images array.
  const originalImages = [];
  if(typeof product.imageUrl === 'string' && /^https?:\/\//i.test(product.imageUrl)) {
    originalImages.push(product.imageUrl);
  }
  if(Array.isArray(product.images)) {
    product.images.forEach(src => {
      if(typeof src === 'string' && /^https?:\/\//i.test(src) && !originalImages.includes(src)) {
        originalImages.push(src);
      }
    });
  }
  const productImages = originalImages.map((src, i) => `${SITE}/product-image/${encodeURIComponent(product.id)}.jpg${i ? `?n=${i}` : ''}`);
  // Keep the generic social-share fallback separate from Product structured data.
  // A generic store image is not a truthful image of an individual product.
  const image = productImages[0] || `${SITE}/og-image.png`;
  const titleTag = esc(metaOverride && metaOverride.title ? metaOverride.title : buildTitle(label));
  const keywordsContent = esc(buildKeywords(product).join(', '));

  // The meta/og/twitter description tags are matched by pattern (not by exact
  // text) so a wording change in templates/product.html can never leave the
  // generic template description in the served page.
  html = html
    .replace('<title>FASHIONISTA</title>', `<title>${titleTag}</title>`)
    .replace(
      /<meta name="description" content="[^"]*">/,
      () => `<meta name="description" content="${esc(desc)}">\n<meta name="keywords" content="${keywordsContent}">`
    )
    .replace(
      '<link rel="canonical" id="canonicalLink" href="https://fashion1sta.com/product.html">',
      `<link rel="canonical" id="canonicalLink" href="${esc(url)}">`
    )
    .replace(
      '<meta id="ogTitle" property="og:title" content="FASHIONISTA">',
      `<meta id="ogTitle" property="og:title" content="${titleTag}">`
    )
    .replace(
      /<meta id="ogDescription" property="og:description" content="[^"]*">/,
      () => `<meta id="ogDescription" property="og:description" content="${esc(desc)}">`
    )
    .replace(
      '<meta id="ogUrl" property="og:url" content="https://fashion1sta.com/product.html">',
      `<meta id="ogUrl" property="og:url" content="${esc(url)}">`
    )
    .replace(
      '<meta id="ogImage" property="og:image" content="https://fashion1sta.com/og-image.png">',
      `<meta id="ogImage" property="og:image" content="${esc(image)}">`
    )
    .replace(
      '<meta id="ogPriceAmount" property="product:price:amount" content="">',
      `<meta id="ogPriceAmount" property="product:price:amount" content="${esc(product.price)}">`
    )
    .replace(
      '<meta id="twitterTitle" name="twitter:title" content="FASHIONISTA">',
      `<meta id="twitterTitle" name="twitter:title" content="${titleTag}">`
    )
    .replace(
      /<meta id="twitterDescription" name="twitter:description" content="[^"]*">/,
      () => `<meta id="twitterDescription" name="twitter:description" content="${esc(desc)}">`
    )
    .replace(
      '<meta id="twitterImage" name="twitter:image" content="https://fashion1sta.com/og-image.png">',
      `<meta id="twitterImage" name="twitter:image" content="${esc(image)}">`
    );

  const productSchema = {
    "@context": "https://schema.org",
    "@type": "Product",
    "name": product.name,
    "sku": String(product.id),
    "brand": { "@type": "Brand", "name": "FASHIONISTA" },
    "url": url,
    "image": productImages.length ? productImages : undefined,
    "description": desc,
    "category": product.category || undefined,
    "offers": {
      "@type": "Offer",
      "url": url,
      "priceCurrency": "BDT",
      "price": product.price,
      "availability": product.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
      "itemCondition": "https://schema.org/NewCondition",
      "seller": {
        "@type": "Organization",
        "name": "FASHIONISTA",
        "url": SITE
      },
      "shippingDetails": SHIPPING_DETAILS,
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "BD",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": 7,
        "returnMethod": "https://schema.org/ReturnByMail",
        "returnFees": "https://schema.org/ReturnFeesCustomerResponsibility",
        "refundType": "https://schema.org/ExchangeRefund",
        "merchantReturnDescription": "The customer is responsible for return shipping fees. For a confirmed damaged, defective or incorrect item covered by this policy, FASHIONISTA pays the return shipping cost. Contact FASHIONISTA before returning an item to receive instructions.",
        "url": `${SITE}/return-policy`
      }
    }
  };
  // Only real customer reviews ever go into the schema: products with no
  // reviews (or when the reviews query failed) get no rating markup at all.
  if(Array.isArray(reviews) && reviews.length){
    const avg = reviews.reduce((s, rv) => s + rv.rating, 0) / reviews.length;
    productSchema.aggregateRating = {
      "@type": "AggregateRating",
      "ratingValue": Math.round(avg * 10) / 10,
      "reviewCount": reviews.length,
      "bestRating": 5,
      "worstRating": 1
    };
    productSchema.review = reviews.slice(0, 5).map(rv => ({
      "@type": "Review",
      "author": { "@type": "Person", "name": rv.name || 'Customer' },
      "datePublished": rv.createdAt ? String(rv.createdAt).slice(0, 10) : undefined,
      "reviewRating": { "@type": "Rating", "ratingValue": rv.rating, "bestRating": 5, "worstRating": 1 },
      "reviewBody": rv.comment || undefined
    }));
  }

  const jsonLd = `
${SEO_INFO_CSS}
<script type="application/ld+json" id="productLd">${JSON.stringify(productSchema).replace(/</g,'\\u003c')}</script>
<script type="application/ld+json" id="breadcrumbLd">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": breadcrumbItems(product, url)
  }).replace(/</g,'\\u003c')}</script>
</head>`;

  html = html.replace('</head>', jsonLd);

  const snapshot = renderSnapshot(product, similar);
  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ product, similar, reviews }).replace(/</g,'\\u003c')}</script>`;
  html = html.replace(
    '<div id="productRoot">\n  <p class="not-found">Loading...</p>\n</div>',
    `<div id="productRoot">${snapshot}</div>\n${ssrDataScript}\n${renderInfoSection(product)}`
  );

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
};

// Exposed only so the SEO helpers can be unit-tested locally; Vercel ignores it.
module.exports.__seo = { cleanDescription, cutAtBoundary, variantSuffix, buildTitle, buildDescription, titleCaseName, renderInfoSection };
