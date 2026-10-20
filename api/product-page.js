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
  if(!row) return null;
  return { id: row.document.name.split('/').pop(), ...fsFields(row.document.fields || {}) };
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
      .filter(p => p.id !== excludeId)
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
    'sunglasses price in bangladesh', 'sunglasses bangladesh', "men's sunglasses bd",
    'gothic sunglasses bangladesh', 'rimless glasses bd', 'aviator sunglasses bd',
    'round sunglasses bd', 'gothic accessories bd'
  ]},
  { match: /cloth|t-?shirt|\btee\b|shirt|hoodie|jersey/, words: [
    'clothing', 'fashionista clothing', "men's clothing bd", "men's t-shirt bangladesh",
    'gothic t-shirt bd', 'gothic clothing bangladesh', 'online clothing store bangladesh',
    't-shirt price in bangladesh'
  ]},
  { match: /chain|necklace|pendant/, words: [
    'chain necklace bangladesh', "men's chain necklace bd", 'chain necklace bd',
    'gothic jewelry bangladesh', 'silver chain price in bangladesh'
  ]},
  { match: /bracelet|bangle/, words: [
    "men's bracelet bangladesh", 'silver bracelet bd', 'silver bracelet men bd',
    'gothic bracelet bangladesh', 'gothic jewelry bangladesh', 'bracelet price in bangladesh'
  ]},
  { match: /grill|grillz|teeth/, words: [
    'teeth grillz bangladesh', 'teeth grillz bd', 'grillz price in bangladesh'
  ]},
  { match: /bandana/, words: [
    'bandana bangladesh', 'bandana bd', 'bandana price in bangladesh',
    'printed bandana bangladesh', 'streetwear bandana bd', 'gothic bandana bangladesh'
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
  const full = `${label} Price in Bangladesh | FASHIONISTA`;
  if(full.length <= 60) return full;

  // Keep the product name and store brand within a predictable title length.
  // The shorter Bangladesh price suffix is preferred before truncating a long
  // product name; if the name itself is still too long, cut at a word boundary.
  const suffix = ' Price in BD | FASHIONISTA';
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

// Meta description, at most 160 characters: "<n>: <cleaned description>
// Price in Bangladesh — cash on delivery." The name leads so products that
// share the same stored description (the bandana colours, say) still differ.
function buildDescription(product, label){
  const suffix = ' Price in Bangladesh — cash on delivery.';
  const cleaned = cleanDescription(product.description);
  if(!cleaned){
    const cat = product.category ? `${product.category} from FASHIONISTA` : 'from FASHIONISTA';
    const fallback = `${label} — BDT ${product.price}. ${cat}, price in Bangladesh, cash on delivery nationwide.`;
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
  const lead = (alreadyNamed && !variant) ? '' : `${label}: `;
  const room = 160 - lead.length - suffix.length - 1;   // -1: possible closing period
  const body = cutAtBoundary(cleaned, room);
  const tail = /[.!?…]$/.test(body) ? '' : '.';
  const result = `${lead}${body}${tail}${suffix}`;
  // Extremely long product names can otherwise make the generated meta
  // description exceed the intended 160-character limit.
  return result.length <= 160 ? result : cutAtBoundary(result, 160);
}

// Short category-aware sentence for the on-page copy. Deliberately makes no
// claims about materials or sizing beyond what the shop already states.
function categoryBlurb(product){
  const hay = `${product.category || ''} ${product.name || ''}`.toLowerCase();
  if(/bandana/.test(hay)) return 'A versatile accessory you can wear as a headband, around your neck, on your waist or hooked onto your jeans.';
  if(product && product.id === 'hRTjTVeGAcjWuwFAMwcs') return 'These silver rimless glasses bring a minimalist eyewear look to Y2K outfits and everyday streetwear. Review the product photos and current BDT price before ordering.';
  if(/glass|eyewear/.test(hay)) return 'It belongs to our eyewear range, built around gothic, Y2K and streetwear styling. Wear the frames with a plain tee or an all-black outfit to make the look stand out.';
  if(/cloth|t-?shirt|\btee\b|shirt|hoodie|jersey/.test(hay)) return 'It belongs to our clothing range: clean, everyday streetwear cuts that are easy to style. Check the size options on this page before ordering, and message us on WhatsApp if you are unsure which size to pick.';
  if(/bracelet|bangle/.test(hay)) return 'Style this bracelet with a watch or other accessories for a layered gothic or streetwear look. Check the product photos and current BDT price for the exact design before ordering.';
  if(/\brings?\b|chain|necklace|pendant|grill/.test(hay)) return 'It belongs to our jewellery and accessories range for gothic and streetwear outfits. Pieces like this are easy to layer and easy to match with the rest of your look.';
  return "It belongs to FASHIONISTA's gothic and streetwear accessories collection.";
}

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

  const intro = [
    `${name} ${cat ? `is part of our ${esc(cat)} collection at FASHIONISTA` : 'is available at FASHIONISTA'}`,
    hasPrice ? ` and costs BDT ${price}${discount > 0 ? `, ${discount}% off the original BDT ${was}` : ''}` : '',
    '. We deliver across Bangladesh with cash on delivery, so you pay when the parcel reaches you.',
    outOfStock ? ' This item is currently out of stock; message us on WhatsApp to ask when it will be back.' : '',
    sizes.length ? ` Available sizes: ${sizes.map(esc).join(', ')}.` : ''
  ].join('');

  return `
<section class="seo-info" aria-labelledby="seoInfoHead">
  <h2 id="seoInfoHead" class="display">About ${name}</h2>
  <p>${intro}</p>
  <p>${esc(categoryBlurb(product))}</p>
  ${subPage ? `<p>Browse all <a href="${subPage.path}">${esc(subPage.label.toLowerCase())}</a> at FASHIONISTA.</p>` : ''}
  <h3>What is the price of ${name} in Bangladesh?</h3>
  <p>${hasPrice ? `${name} costs BDT ${price} at FASHIONISTA. ` : ''}Delivery charges depend on where you live; see our <a href="/shipping">shipping info</a> for charges, timelines and how order confirmation works.</p>
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
  const images = (product.images && product.images.length) ? product.images : (product.imageUrl ? [product.imageUrl] : []);
  const media = images.length
    ? `<img id="mainProductImg" src="${esc(images[0])}" alt="${esc(product.name)}" fetchpriority="high" style="${outOfStock?'opacity:0.4;':''}">`
    : '';
  const thumbs = images.length > 1
    ? `<div class="p-thumbs" id="pThumbs">${images.map((img,i)=>`<img src="${esc(img)}" alt="${esc(product.name)} - photo ${i+1}" class="${i===0?'active':''}" data-i="${i}" loading="lazy" decoding="async">`).join('')}</div>`
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
    const m = p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:contain;">` : '';
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
        <h1 class="display">${esc(product.name)}</h1>
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

  // Old id-based URL of a product that now has a slug: one permanent hop to
  // the slug URL, so links, bookmarks and Google's index all consolidate there.
  if(!bySlug && validSlug(product.slug)){
    redirectPermanent(res, productPath(product));
    return;
  }

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
  const desc = isSilverRimlessOverride
    ? 'Shop silver rimless glasses in Bangladesh at FASHIONISTA. Silver-tone eyewear for Y2K and streetwear looks, with cash on delivery nationwide.'
    : buildDescription(product, label);
  // Use first-party image URLs in metadata/schema so Google can crawl the photos
  // without depending on the external image host. Keep order identical to
  // api/product-image.js: imageUrl first, then the remaining images array.
  const originalImages = Array.isArray(product.images)
    ? product.images.filter(src => typeof src === 'string' && /^https?:\/\//i.test(src))
    : [];
  if(typeof product.imageUrl === 'string' && /^https?:\/\//i.test(product.imageUrl) && !originalImages.includes(product.imageUrl)) {
    originalImages.unshift(product.imageUrl);
  }
  const productImages = originalImages.length
    ? originalImages.map((src, i) => `${SITE}/product-image/${encodeURIComponent(product.id)}.jpg${i ? `?n=${i}` : ''}`)
    : [`${SITE}/og-image.png`];
  const image = productImages[0];
  const titleTag = isSilverRimlessOverride
    ? 'Silver Rimless Glasses Price in Bangladesh | FASHIONISTA'
    : esc(buildTitle(label));
  const keywordsContent = esc(buildKeywords(product).join(', '));

  html = html
    .replace('<title>FASHIONISTA</title>', `<title>${titleTag}</title>`)
    .replace(
      '<meta name="description" content="Shop neon silver accessories and eyewear at FASHIONISTA. Cash on delivery across Bangladesh.">',
      `<meta name="description" content="${esc(desc)}">\n<meta name="keywords" content="${keywordsContent}">`
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
      '<meta id="ogDescription" property="og:description" content="Shop neon silver accessories and eyewear at FASHIONISTA.">',
      `<meta id="ogDescription" property="og:description" content="${esc(desc)}">`
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
      '<meta id="twitterDescription" name="twitter:description" content="Shop neon silver accessories and eyewear at FASHIONISTA.">',
      `<meta id="twitterDescription" name="twitter:description" content="${esc(desc)}">`
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
      "seller": { "@type": "Organization", "name": "FASHIONISTA", "url": SITE },
      "shippingDetails": SHIPPING_DETAILS,
      "hasMerchantReturnPolicy": {
        "@type": "MerchantReturnPolicy",
        "applicableCountry": "BD",
        "returnPolicyCategory": "https://schema.org/MerchantReturnFiniteReturnWindow",
        "merchantReturnDays": 7,
        "refundType": "https://schema.org/ExchangeRefund",
        "merchantReturnLink": `${SITE}/return-policy`
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
