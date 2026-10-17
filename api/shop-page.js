// api/shop-page.js — Server-renders shop.html so the grid arrives with
// real product cards already visible instead of a blank page that only
// filled in once client-side JS finished fetching every product from
// Firestore. Also bakes in the right per-category SEO tags server-side.
//
// The static template lives at templates/shop.html (not at the public
// path) so this function is what actually serves the shop URLs. Reached via
// the rewrites in vercel.json: /shop, /clothing and /accessories (the last two
// pass ?category=), plus /bracelets and /bandanas (?scope=). Reads Firestore's
// public REST API directly (same public web key already used client-side —
// firestore.rules already allows public read on /products, same access level
// the storefront pages themselves have).
//
// Sub-category landing pages (/bracelets, /bandanas) reuse the shop template and
// add their own title, description, H1, intro, supporting copy, internal links
// and JSON-LD (see SCOPE_PAGES below).

const fs = require('fs');
const path = require('path');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

// Search-engine crawlers. If the product data genuinely can't be fetched for a
// sub-category landing page, they get a 503 (try again later) instead of a
// thin 200 page — same policy as api/home-page.js.
const CRAWLER_UA = /googlebot|google-inspectiontool|googleother|adsbot-google|bingbot|duckduckbot|yandexbot|baiduspider/i;

// ---------- Firestore REST "fields" -> plain JS value ----------
function fsValue(v){
  if(v == null) return null;
  if('stringValue' in v) return v.stringValue;
  if('integerValue' in v) return Number(v.integerValue);
  if('doubleValue' in v) return Number(v.doubleValue);
  if('booleanValue' in v) return v.booleanValue;
  if('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue);
  if('mapValue' in v) return fsFields(v.mapValue.fields || {});
  return null;
}
function fsFields(fields){
  const out = {};
  for(const k in fields) out[k] = fsValue(fields[k]);
  return out;
}

async function listCollection(name){
  const docs = [];
  let pageToken = '';
  do{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${name}?pageSize=300&key=${FIREBASE_API_KEY}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url);
    if(!r.ok) throw new Error(`Firestore list(${name}) failed: ${r.status}`);
    const j = await r.json();
    (j.documents || []).forEach(doc => {
      docs.push({ id: doc.name.split('/').pop(), ...fsFields(doc.fields || {}) });
    });
    pageToken = j.nextPageToken || '';
  } while(pageToken);
  return docs;
}

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Replaces the content="" or href="" value of a tag identified by id="ID",
// regardless of attribute order or exactly what the old value was — more
// robust than matching full tag text, which breaks the moment anyone edits
// the template's existing copy.
function setAttrById(html, id, attr, value){
  const re = new RegExp(`(<[^>]*\\bid="${id}"[^>]*\\s${attr}=")[^"]*(")`);
  return html.replace(re, (m, p1, p2) => p1 + value.replace(/\$/g, '$$$$') + p2);
}
function setTextById(html, id, tag, text){
  const re = new RegExp(`(<${tag}[^>]*\\bid="${id}"[^>]*>)[^<]*(</${tag}>)`);
  return html.replace(re, (m, p1, p2) => p1 + text.replace(/\$/g, '$$$$') + p2);
}

// Title / description / social tags / canonical, written server-side.
function applySeoHead(html, seo, url){
  html = html.replace(/<title>[^<]*<\/title>/, () => `<title>${esc(seo.title)}</title>`);
  html = setAttrById(html, 'metaDesc', 'content', esc(seo.desc));
  html = setAttrById(html, 'ogTitle', 'content', esc(seo.title));
  html = setAttrById(html, 'ogDescription', 'content', esc(seo.desc));
  html = setAttrById(html, 'ogUrl', 'content', esc(url));
  html = setAttrById(html, 'twitterTitle', 'content', esc(seo.title));
  html = setAttrById(html, 'twitterDescription', 'content', esc(seo.desc));
  html = setAttrById(html, 'canonicalLink', 'href', esc(url));
  return html;
}

function glassesSVG(){return `<svg viewBox="0 0 100 46" fill="none"><circle cx="26" cy="23" r="19" stroke="url(#sg1)" stroke-width="2.5"/><circle cx="74" cy="23" r="19" stroke="url(#sg1)" stroke-width="2.5"/><line x1="45" y1="23" x2="55" y2="23" stroke="url(#sg1)" stroke-width="2.5"/><line x1="7" y1="16" x2="0" y2="11" stroke="url(#sg1)" stroke-width="2.5" stroke-linecap="round"/><line x1="93" y1="16" x2="100" y2="11" stroke="url(#sg1)" stroke-width="2.5" stroke-linecap="round"/><defs><linearGradient id="sg1" x1="0" y1="0" x2="100" y2="46"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function crossSVG(){return `<svg viewBox="0 0 60 60" fill="none"><path d="M30 6 L30 54 M12 24 L48 24" stroke="url(#sg3)" stroke-width="4" stroke-linecap="round"/><defs><linearGradient id="sg3" x1="0" y1="0" x2="60" y2="60"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function chainSVG(){return `<svg viewBox="0 0 90 50" fill="none"><ellipse cx="22" cy="25" rx="14" ry="9" stroke="url(#sg4)" stroke-width="2.2"/><ellipse cx="46" cy="25" rx="14" ry="9" stroke="url(#sg4)" stroke-width="2.2"/><ellipse cx="70" cy="25" rx="14" ry="9" stroke="url(#sg4)" stroke-width="2.2"/><defs><linearGradient id="sg4" x1="0" y1="0" x2="90" y2="50"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function iconFor(type){
  if(type==="glasses") return glassesSVG();
  if(type==="chain") return chainSVG();
  return crossSVG();
}

function cardMarkup(p, i, eager){
  const outOfStock = p.stock === 0;
  const imgAttrs = eager
    ? (i === 0 ? ' fetchpriority="high"' : '')
    : ' loading="lazy" decoding="async"';
  const media = p.imageUrl
    ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}"${imgAttrs} style="width:100%;height:100%;object-fit:contain;${outOfStock?'opacity:0.4;':''}">`
    : iconFor(p.iconType);
  const dir = i % 2 === 0 ? 'from-left' : 'from-right';
  const delay = (i % 4) * 0.08;
  const discount = p.was ? Math.round((1 - p.price/p.was) * 100) : 0;
  const soldText = p.sold ? `${p.sold >= 1000 ? (p.sold/1000).toFixed(1).replace('.0','')+'k' : p.sold} sold` : '';
  const actionsHtml = outOfStock
    ? `<button class="order" disabled style="opacity:0.5;cursor:not-allowed;flex:1;">Out of Stock</button>`
    : `<button class="order add-cart-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}">Add to Cart</button>
       <button class="order buy-now-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}">Buy Now</button>`;
  return `
    <div class="card reveal ${dir}" style="transition-delay:${delay}s">
      <a href="product.html?id=${encodeURIComponent(p.id)}" class="card-link">
        <div class="frame">
          ${discount>0 && !outOfStock ? `<span class="discount-badge">-${discount}%</span>` : ''}
          ${outOfStock ? `<span class="discount-badge" style="background:var(--text-dim);">Out of Stock</span>` : ''}
          <button class="fav-btn" data-id="${esc(p.id)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}" aria-label="Save"></button>
          ${media}
        </div>
        <h3>${esc(p.name)}</h3>
      </a>
      <div class="price"><span class="now">BDT ${p.price}</span>${p.was?`<span class="was">BDT ${p.was}</span>`:''}</div>
      ${soldText ? `<p class="sold-text">${esc(soldText)}</p>` : ''}
      <div class="card-actions">
        ${actionsHtml}
      </div>
    </div>`;
}

const CATEGORY_SEO = {
  "New In": {
    title: "New Arrivals in Bangladesh | FASHIONISTA",
    desc: "Explore new and featured sunglasses, accessories and streetwear at FASHIONISTA. See BDT prices and stock status, with cash on delivery across Bangladesh."
  },
  "Glasses": {
    title: "Sunglasses & Glasses in Bangladesh | FASHIONISTA",
    desc: "Shop rimless, aviator and round sunglasses at FASHIONISTA. Explore gothic, Y2K and streetwear eyewear with BDT prices and cash on delivery across Bangladesh."
  },
  "Accessories": {
    title: "Gothic & Streetwear Accessories in Bangladesh | FASHIONISTA",
    desc: "Shop bracelets, rings, chain necklaces, bandanas and belts at FASHIONISTA. Gothic and Y2K styles, BDT prices and cash on delivery across Bangladesh."
  },
  "Clothing": {
    title: "Streetwear T-Shirts & Clothing in Bangladesh | FASHIONISTA",
    desc: "Explore streetwear T-shirts and clothing at FASHIONISTA, Dhaka. Check product pages for sizes and BDT prices. Cash on delivery across Bangladesh."
  }
};

// Clean public path for each category. Categories not listed here (New In)
// keep using the ?category= query on /shop.
const CATEGORY_PATHS = {
  "Glasses": "/glasses",
  "Clothing": "/clothing",
  "Accessories": "/accessories"
};

function categoryPath(name){
  return Object.prototype.hasOwnProperty.call(CATEGORY_PATHS, name)
    ? CATEGORY_PATHS[name]
    : `/shop?category=${encodeURIComponent(name)}`;
}

function seoForCategory(name){
  return Object.prototype.hasOwnProperty.call(CATEGORY_SEO, name) ? CATEGORY_SEO[name] : null;
}

// =====================================================================
// Sub-category landing pages: /bracelets and /bandanas
// =====================================================================
// A product belongs to a landing page when its Firestore `subcategory` field
// matches one of `aliases` (case-insensitive, trimmed) — the same field the
// shop's filter drawer uses. Nothing here is guessed from product names.
//
// Copy rules: no claims about materials, authenticity, sizing, reviews or
// delivery times beyond what the site already states (see shipping.html and
// return-policy.html). The "highlights" blocks are generated from the real
// product names/descriptions and only appear when at least one product
// actually mentions the term. Third-party brand names are never used.
const SCOPE_PAGES = {
  bracelets: {
    path: '/bracelets',
    label: 'Bracelets',
    aliases: ['bracelets', 'bracelet'],
    title: 'Gothic & Fashion Bracelets in Bangladesh | FASHIONISTA',
    desc: 'Browse gothic and streetwear bracelets at FASHIONISTA. Prices in BDT, live stock status and cash on delivery across Bangladesh.',
    h1: 'Fashion Bracelets in Bangladesh',
    sub: 'Gothic and streetwear bracelets, priced in BDT',
    intro: [
      'FASHIONISTA is a Bangladesh-based accessories brand inspired by retro, Y2K and street fashion. This page collects the bracelets currently listed in our shop, with the price in BDT and a clear out-of-stock label on anything that has sold through.',
      'Pay cash on delivery anywhere in Bangladesh, with nothing to pay online.'
    ],
    highlights: [
      { heading: 'Silver cross bracelets', text: 'These listings mention both silver and a cross design in their name or description:', test: s => /cross/i.test(s) && /silver/i.test(s) },
      { heading: 'Cross bracelets', text: 'These listings mention a cross design in their name or description:', test: s => /cross/i.test(s) && !/silver/i.test(s) },
      { heading: 'Gothic bracelets', text: 'These listings describe themselves as gothic:', test: s => /goth/i.test(s) }
    ],
    sections: [
      { h: 'How to choose a bracelet', p: [
        'Open any listing to see its photos, price and description. Size and finish differ from piece to piece, so check those details on the product page before you order, and message us on WhatsApp through the <a href="/contact">contact page</a> if you are unsure about fit.'
      ]},
      { h: 'Styling a bracelet', p: [
        'Darker, gothic-leaning designs look sharpest against plain basics such as a black or white tee, a hoodie or a denim jacket. Wear one on its own for a clean look, or stack it with a watch or a second bracelet. Chain necklaces and rings from the wider <a href="/accessories">accessories range</a> are an easy match.'
      ]},
      { h: 'Ordering bracelets in Bangladesh', p: [
        'We deliver across Bangladesh and every order is cash on delivery, so you pay the courier when the parcel arrives. Delivery charges depend on whether you are inside or outside Dhaka; the <a href="/shipping">shipping info page</a> lists the current charges and timelines. After checkout we confirm your order on WhatsApp. If an item arrives damaged or incorrect, our <a href="/return-policy">return and exchange policy</a> explains what to do.'
      ]}
    ],
    related: [
      { href: '/bandanas', text: 'Bandanas' },
      { href: '/glasses', text: 'Glasses and sunglasses' },
      { href: '/accessories', text: 'All accessories' },
      { href: '/shop', text: 'Shop everything' }
    ]
  },
  bandanas: {
    path: '/bandanas',
    label: 'Bandanas',
    aliases: ['bandana', 'bandanas'],
    title: 'Bandanas in Bangladesh | Streetwear & Gothic | FASHIONISTA',
    desc: 'Shop bandanas at FASHIONISTA to wear as a headband, neck scarf or waist accessory. Prices in BDT, cash on delivery across Bangladesh.',
    h1: 'Bandanas in Bangladesh',
    sub: 'Streetwear and gothic bandanas, priced in BDT',
    intro: [
      'A bandana is one of the easiest ways to change an outfit. Tie one as a headband, around your neck, on your waist or hooked onto your jeans. Every bandana listed here shows its price in BDT and an out-of-stock label when it has sold through.',
      'Order from anywhere in Bangladesh and pay cash on delivery.'
    ],
    highlights: [
      { heading: 'Printed bandanas', text: 'These listings mention a print, paisley or pattern in their name or description:', test: s => /print|paisley|pattern/i.test(s) },
      { heading: 'Gothic bandanas', text: 'These listings describe themselves as gothic:', test: s => /goth/i.test(s) },
      { heading: 'Streetwear bandanas', text: 'These listings mention streetwear in their name or description:', test: s => /street/i.test(s) }
    ],
    sections: [
      { h: 'Ways to wear a bandana', p: [
        'Folded into a band and tied at the back, it works as a headband. Knotted loosely at the front, it becomes a neck scarf. You can also tie it at your waist, hook it onto a belt loop or jeans, or knot it around a wrist or bag strap for a small pop of colour.'
      ]},
      { h: 'Choosing a bandana', p: [
        'Look at the photos on each product page for colour and print, and read the description for any details we have added. Darker, graphic designs suit gothic and streetwear outfits, while a lighter colour gives a strong contrast against all black.'
      ]},
      { h: 'Ordering bandanas in Bangladesh', p: [
        'Place your order and pay the courier in cash when the parcel reaches you. Delivery charges are different inside and outside Dhaka, and the <a href="/shipping">shipping info page</a> has the current charges and timelines. We confirm each order with you on WhatsApp after checkout. Our <a href="/return-policy">return and exchange policy</a> covers damaged or incorrect items.'
      ]}
    ],
    related: [
      { href: '/bracelets', text: 'Bracelets' },
      { href: '/glasses', text: 'Glasses and sunglasses' },
      { href: '/accessories', text: 'All accessories' },
      { href: '/shop', text: 'Shop everything' }
    ]
  }
};

function getScopeConfig(req){
  const key = String((req.query && req.query.scope) || '').toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCOPE_PAGES, key) ? SCOPE_PAGES[key] : null;
}

function inScope(p, cfg){
  return cfg.aliases.indexOf(String(p.subcategory || '').trim().toLowerCase()) !== -1;
}

const LANDING_CSS = `<style>
  .crumbs{font-size:12px;color:var(--text-dim);margin-bottom:12px;}
  .crumbs a{color:var(--silver-bright);text-decoration:underline;text-underline-offset:2px;}
  .cat-intro{max-width:760px;margin:0 auto 22px;font-size:13.5px;color:var(--text-dim);line-height:1.7;}
  .cat-intro p{margin-bottom:10px;}
  .cat-copy{padding:6px 22px 40px;max-width:760px;}
  .cat-copy h2{font-family:'Fraunces',serif;font-weight:500;font-size:19px;margin:26px 0 12px;padding-bottom:12px;border-bottom:1px solid var(--line);}
  .cat-copy h2:first-child{margin-top:0;}
  .cat-copy p,.cat-copy li{font-size:13.5px;color:var(--text-dim);line-height:1.7;margin-bottom:10px;}
  .cat-copy ul{padding-left:20px;margin-bottom:10px;}
  .cat-copy a{color:var(--silver-bright);text-decoration:underline;text-underline-offset:2px;}
  .cat-links{padding:0 22px 32px;font-size:13px;color:var(--text-dim);}
  .cat-links a{color:var(--silver-bright);text-decoration:underline;text-underline-offset:2px;margin-right:14px;}
</style>`;

function productLink(p){
  const out = p.stock === 0 ? ' (out of stock)' : '';
  const price = Number.isFinite(Number(p.price)) ? ` — BDT ${esc(p.price)}` : '';
  return `<li><a href="/product.html?id=${encodeURIComponent(p.id)}">${esc(p.name)}</a>${price}${out}</li>`;
}

// "Silver cross bracelets" / "Printed bandanas" ... blocks, built only from
// products whose own name or description contains the term.
function highlightsMarkup(cfg, items){
  const used = new Set();
  const blocks = [];
  cfg.highlights.forEach(h => {
    const hits = items
      .filter(p => !used.has(h.heading + p.id) && h.test(`${p.name || ''} ${p.description || ''}`))
      .slice(0, 6);
    if(!hits.length) return;
    blocks.push(`<h2>${esc(h.heading)}</h2><p>${esc(h.text)}</p><ul>${hits.map(productLink).join('')}</ul>`);
  });
  return blocks.join('\n  ');
}

function relatedMarkup(cfg){
  return `<h2>More from FASHIONISTA</h2><ul>${cfg.related.map(l => `<li><a href="${esc(l.href)}">${esc(l.text)}</a></li>`).join('')}</ul>`;
}

function introMarkup(cfg, count){
  const countLine = count > 0
    ? `${count} ${count === 1 ? 'style is' : 'styles are'} listed right now.`
    : 'New styles are being added soon, so check back shortly.';
  return `<div class="cat-intro">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> / <a href="/accessories">Accessories</a> / <span>${esc(cfg.label)}</span></nav>
    <p>${esc(cfg.intro[0])} ${esc(countLine)}</p>
    <p>${esc(cfg.intro[1])}</p>
  </div>`;
}

function supportingCopyMarkup(cfg, items){
  const sections = cfg.sections.map(s => `<h2>${esc(s.h)}</h2>${s.p.map(t => `<p>${t}</p>`).join('')}`).join('\n  ');
  const highlights = highlightsMarkup(cfg, items);
  return `<section class="cat-copy" aria-label="${esc(cfg.label)} buying guide">
  ${highlights ? highlights + '\n  ' : ''}${sections}
  ${relatedMarkup(cfg)}
</section>`;
}

function landingJsonLd(cfg, items){
  const url = SITE + cfg.path;
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Home", "item": `${SITE}/` },
      { "@type": "ListItem", "position": 2, "name": "Accessories", "item": `${SITE}/accessories` },
      { "@type": "ListItem", "position": 3, "name": cfg.label, "item": url }
    ]
  };
  const listItems = [];
  for(const p of items){
    if(!p || !p.name) continue;
    const entry = {
      "@type": "ListItem",
      "position": listItems.length + 1,
      "url": `${SITE}/product.html?id=${encodeURIComponent(p.id)}`,
      "name": p.name
    };
    if(typeof p.imageUrl === 'string' && /^https?:\/\//i.test(p.imageUrl)) entry.image = p.imageUrl;
    listItems.push(entry);
    if(listItems.length >= 30) break;
  }
  const tags = [`<script type="application/ld+json" id="breadcrumbLd">${JSON.stringify(crumbs).replace(/</g,'\\u003c')}</script>`];
  if(listItems.length){
    const list = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      "name": cfg.h1,
      "url": url,
      "numberOfItems": listItems.length,
      "itemListElement": listItems
    };
    tags.push(`<script type="application/ld+json" id="itemListLd">${JSON.stringify(list).replace(/</g,'\\u003c')}</script>`);
  }
  return tags.join('\n');
}

// The shop template's client script re-renders the grid and the heading after
// load, using only ?category= from the URL. On a landing page that would reset
// the heading to "Shop All" and show every product, so a handful of exact
// one-line anchors in that script are patched (only for landing pages — the
// template file itself, and every other shop URL, are untouched). If the
// template is ever edited so an anchor no longer matches, the patch is skipped
// with a console error and the SSR HTML is still correct; only the client-side
// re-render would fall back to the generic behaviour.
const CLIENT_PATCHES = [
  [
    "document.getElementById('pageTitle').textContent = activeCategory || 'Shop All';",
    "document.getElementById('pageTitle').textContent = window.__SHOP_SCOPE__ ? window.__SHOP_SCOPE__.title : (activeCategory || 'Shop All');"
  ],
  [
    "document.getElementById('pageSub').textContent = activeCategory",
    "document.getElementById('pageSub').textContent = window.__SHOP_SCOPE__ ? window.__SHOP_SCOPE__.sub : activeCategory"
  ],
  [
    "baseFiltered = filtered;",
    "if(window.__SHOP_SCOPE__){ filtered = window.__shopScopeFilter(all); }\n  baseFiltered = filtered;"
  ],
  [
    "document.getElementById('pageTitle').textContent = 'Shop All';",
    "document.getElementById('pageTitle').textContent = window.__SHOP_SCOPE__ ? window.__SHOP_SCOPE__.title : 'Shop All';"
  ],
  [
    "document.getElementById('pageSub').textContent = 'Every FASHIONISTA piece in one place';",
    "document.getElementById('pageSub').textContent = window.__SHOP_SCOPE__ ? window.__SHOP_SCOPE__.sub : 'Every FASHIONISTA piece in one place';"
  ]
];

// Category pages (/shop, /clothing, /accessories, /glasses, ?category=New In)
// now live at clean URLs, so the client script can no longer read the category
// from location.search alone. The server publishes it as window.__SHOP_CATEGORY__
// (see categoryScript) and these anchors are patched to use it, plus the
// clean-URL helpers for the drawer, the filter bar and the client-side canonical.
// Same skip-if-missing behaviour as CLIENT_PATCHES above.
const CATEGORY_CLIENT_PATCHES = [
  [
    "const activeCategory = params.get('category');",
    "const activeCategory = window.__SHOP_CATEGORY__ !== undefined ? window.__SHOP_CATEGORY__ : params.get('category');"
  ],
  [
    "return name === 'Glasses' ? '/glasses' : `shop.html?category=${encodeURIComponent(name)}`;",
    "return window.__categoryPath(name);"
  ],
  [
    ": `https://fashion1sta.com/shop.html?category=${encodeURIComponent(cat)}`;",
    ": window.__categoryCanonical(cat);"
  ],
  [
    "window.location.href = c ? categoryUrl(c) : 'shop.html';",
    "window.location.href = c ? categoryUrl(c) : '/shop';"
  ]
];

function applyClientPatches(html, patches){
  patches.forEach(([from, to]) => {
    if(html.indexOf(from) === -1){
      console.error('shop-page: client patch anchor not found, skipped:', from);
      return;
    }
    html = html.replace(from, () => to);
  });
  return html;
}

function patchClientForScope(html){
  return applyClientPatches(html, CLIENT_PATCHES);
}

// Classic script placed before the module script. Publishes the current
// category and the clean-URL helpers the template's client code calls.
function categoryScript(category){
  const data = category || null;
  return `<script>window.__SHOP_CATEGORY__=${JSON.stringify(data).replace(/</g,'\\u003c')};`
    + `window.__CATEGORY_PATHS__=${JSON.stringify(CATEGORY_PATHS).replace(/</g,'\\u003c')};`
    + `window.__categoryPath=function(n){var m=window.__CATEGORY_PATHS__;return Object.prototype.hasOwnProperty.call(m,n)?m[n]:'/shop?category='+encodeURIComponent(n);};`
    + `window.__categoryCanonical=function(n){return ${JSON.stringify(SITE)}+window.__categoryPath(n);};</script>\n`;
}

// Head and client setup for the main shop page (/shop, /clothing, /accessories,
// /shop?category=New In). Runs before the product fetch so the canonical and
// client hooks are correct even when the fetch fails.
function prepareMainPage(html, category){
  const seo = category ? seoForCategory(category) : null;
  const pagePath = seo ? categoryPath(category) : '/shop';
  if(seo){
    html = applySeoHead(html, seo, SITE + pagePath);
  }else{
    html = setAttrById(html, 'canonicalLink', 'href', esc(SITE + pagePath));
    html = setAttrById(html, 'ogUrl', 'content', esc(SITE + pagePath));
  }
  html = applyClientPatches(html, CATEGORY_CLIENT_PATCHES);
  html = html.replace('<script type="module">', () => categoryScript(category) + '<script type="module">');
  return html;
}

// Same "You Might Also Like" handling the shop page has always had.
function injectSimilar(html, similar, cardFn){
  if(similar.length){
    return html
      .replace('<div class="grid" id="similarGrid"></div>', () => `<div class="grid" id="similarGrid">${similar.map((p,i)=>cardFn(p,i,false)).join('')}</div>`);
  }
  return html.replace('<section class="collection" id="similarSection">', '<section class="collection" id="similarSection" style="display:none;">');
}

// Classic script placed before the module script: tells the client which
// products make up this landing page (ids from the server, in display order;
// or, when the server could not load products, the sub-category aliases so the
// client can filter after its own fetch).
function scopeScript(cfg, ids){
  const data = { title: cfg.h1, sub: cfg.sub, ids: ids || null, aliases: cfg.aliases };
  return `<script>window.__SHOP_SCOPE__=${JSON.stringify(data).replace(/</g,'\\u003c')};`
    + `window.__shopScopeFilter=function(all){var s=window.__SHOP_SCOPE__;`
    + `if(s.ids){var m={};all.forEach(function(p){m[p.id]=p;});return s.ids.map(function(id){return m[id];}).filter(Boolean);}`
    + `return all.filter(function(p){return s.aliases.indexOf(String(p.subcategory||'').trim().toLowerCase())!==-1;});};</script>\n`;
}

async function serveLandingPage(req, res, html, cfg){
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const url = SITE + cfg.path;

  html = applySeoHead(html, { title: cfg.title, desc: cfg.desc }, url);
  html = setTextById(html, 'pageTitle', 'h1', esc(cfg.h1));
  html = setTextById(html, 'pageSub', 'p', esc(cfg.sub));
  html = patchClientForScope(html);
  html = applyClientPatches(html, CATEGORY_CLIENT_PATCHES);
  html = html.replace('<script type="module">', () => categoryScript(null) + '<script type="module">');

  let products;
  try{
    products = await listCollection('products');
  }catch(e){
    console.error('SSR landing page products fetch failed:', e);
    res.setHeader('Cache-Control', 'no-store');
    const ua = String((req && req.headers && req.headers['user-agent']) || '');
    if(CRAWLER_UA.test(ua)){
      res.setHeader('Retry-After', '120');
      res.status(503).send('Service temporarily unavailable. Please try again shortly.');
      return;
    }
    // Everyone else: correct head/heading from the config, and the client
    // fetches and filters the products itself (see scopeScript).
    html = html.replace('<script type="module">', () => scopeScript(cfg, null) + '<script type="module">');
    html = html.replace('</head>', () => LANDING_CSS + '\n</head>');
    res.status(200).send(html);
    return;
  }

  // In-stock first, then out-of-stock; otherwise the stored order.
  const items = products
    .filter(p => inScope(p, cfg))
    .map((p, idx) => ({ p, idx }))
    .sort((a, b) => ((a.p.stock === 0) - (b.p.stock === 0)) || (a.idx - b.idx))
    .map(x => x.p);

  const similar = products.filter(p => !inScope(p, cfg)).sort(() => Math.random() - 0.5).slice(0, 4);

  const head = [LANDING_CSS, landingJsonLd(cfg, items)];
  // A landing page with no products would be a thin page: keep it out of the index.
  if(!items.length) head.push('<meta name="robots" content="noindex, follow">');
  html = html.replace('</head>', () => head.join('\n') + '\n</head>');

  const gridInner = items.map((p, i) => cardMarkup(p, i, i < 2)).join('');
  html = html.replace('<div class="grid" id="shopGrid"></div>', () => introMarkup(cfg, items.length) + `<div class="grid" id="shopGrid">${gridInner}</div>`);
  if(!items.length){
    html = html.replace(
      '<p class="empty-state" id="emptyState" style="display:none;">No products in this category yet — check back soon.</p>',
      () => '<p class="empty-state" id="emptyState">No products in this category yet — check back soon.</p>'
    );
  }

  html = html.replace('<section class="collection" id="similarSection">', () => supportingCopyMarkup(cfg, items) + '\n<section class="collection" id="similarSection">');
  html = injectSimilar(html, similar, cardMarkup);

  html = html.replace('<script type="module">', () => scopeScript(cfg, items.map(p => p.id)) + '<script type="module">');
  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ products, similar }).replace(/</g,'\\u003c')}</script>\n`;
  html = html.replace('<script type="module">', () => ssrDataScript + '<script type="module">');

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
}

// ---------- SEO: category intro text ----------
// Real, server-rendered copy for each category page, so the pages are not
// "thin" (just a product grid) when a crawler reads them. Sits between the
// product grid and "You Might Also Like". The same text for /glasses is kept
// in glasses.html (a static page) - edit both together.
const CATEGORY_CONTENT = {
  "New In": {
    h2: "New arrivals at FASHIONISTA",
    paras: [
      "Browse newly added and featured pieces from FASHIONISTA, including eyewear, accessories and streetwear. Product cards show current prices in BDT and indicate when an item is out of stock.",
      "Looking for something specific? Browse our <a href=\"/glasses\">sunglasses</a>, <a href=\"/accessories\">accessories</a> or <a href=\"/clothing\">clothing</a>."
    ]
  },
  "Glasses": {
    h2: "Sunglasses and glasses in Bangladesh",
    paras: [
      "Explore sunglasses and glasses in Bangladesh, including rimless, aviator and round styles selected for gothic, Y2K and streetwear outfits. Each product card shows its current BDT price; open a listing to check photos and availability before ordering.",
      "Rimless frames offer a minimal look, aviator shapes feel classic, and round frames add a retro accent. Compare the photos and details on each product page, or contact us if you need help choosing a pair. Browse our <a href=\"/accessories\">accessories</a> to complete the look."
    ]
  },
  "Accessories": {
    h2: "Gothic and streetwear accessories in Bangladesh",
    paras: [
      "Explore accessories for gothic, Y2K and streetwear outfits, including chain necklaces, rings, bracelets, bandanas and belts where available. Layer a necklace with a bracelet or pair an accessory with a plain tee to make it stand out. Product pages show the current BDT price and stock status.",
      "Browse our dedicated <a href=\"/bracelets\">bracelet collection</a> and <a href=\"/bandanas\">bandanas</a>, or explore <a href=\"/glasses\">sunglasses</a> and <a href=\"/clothing\">streetwear clothing</a>. Open any listing for product photos, current price and availability."
    ]
  },
  "Clothing": {
    h2: "Streetwear clothing in Bangladesh",
    paras: [
      "Explore everyday streetwear clothing from FASHIONISTA, including T-shirts and other styles currently listed in the shop. Product pages show the available size options and current price in BDT, so check each listing before placing an order.",
      "Check the size details on the product page and contact us if you need help before ordering. Complete the outfit with <a href=\"/glasses\">sunglasses</a>, <a href=\"/bracelets\">bracelets</a> or other <a href=\"/accessories\">accessories</a>."
    ]
  }
};

const CATEGORY_FAQ = [
  ["Can I pay cash on delivery?", "Yes. We offer cash on delivery nationwide across Bangladesh, so there is nothing to pay online. See our <a href=\"/shipping\">shipping info</a> for delivery charges and timelines."],
  ["What if an item is damaged or the wrong size?", "Inspect your parcel in front of the delivery person and report any damaged, incorrect or wrong-size item on the spot. Details are in our <a href=\"/return-policy\">return and exchange policy</a>."],
  ["How do I ask a question before ordering?", "Message us on WhatsApp or visit our <a href=\"/contact\">contact page</a>. We usually reply within a few hours."]
];

const SEO_INFO_CSS = `<style>
  .seo-info{padding:6px 22px 40px;max-width:760px;}
  .seo-info h2{font-family:'Fraunces',serif;font-weight:500;font-size:19px;margin-bottom:14px;padding-bottom:13px;border-bottom:1px solid var(--line);}
  .seo-info h3{font-size:14px;font-weight:600;color:var(--silver-bright);margin:18px 0 6px;}
  .seo-info p{font-size:13.5px;color:var(--text-dim);line-height:1.7;margin-bottom:10px;}
  .seo-info a{color:var(--silver-bright);text-decoration:underline;text-underline-offset:2px;}
</style>`;

function categoryContentMarkup(category){
  const c = CATEGORY_CONTENT[category];
  if(!c) return '';
  return `
<section class="seo-info" aria-labelledby="seoInfoHead">
  <h2 id="seoInfoHead" class="display">${c.h2}</h2>
${c.paras.map(p => `  <p>${p}</p>`).join('\n')}
${CATEGORY_FAQ.map(([q, a]) => `  <h3>${q}</h3>\n  <p>${a}</p>`).join('\n')}
</section>
`;
}

// Crawlable links from the main shop and Accessories pages to the landing pages.
const BROWSE_LINKS = `<nav class="cat-links" aria-label="Browse by type">Browse by type: <a href="/bracelets">Bracelets</a><a href="/bandanas">Bandanas</a><a href="/glasses">Glasses</a></nav>`;

module.exports = async function handler(req, res){
  let category = String((req.query && req.query.category) || '');
  if(category === 'New') category = 'New In';   // old links used ?category=New
  const templatePath = path.join(__dirname, '..', 'templates', 'shop.html');

  let html;
  try{
    html = fs.readFileSync(templatePath, 'utf8');
  }catch(e){
    console.error('shop.html template missing:', e);
    res.status(500).send('Template not found');
    return;
  }

  const scopeCfg = getScopeConfig(req);
  if(scopeCfg){
    await serveLandingPage(req, res, html, scopeCfg);
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  html = prepareMainPage(html, category);

  let products;
  try{
    products = await listCollection('products');
  }catch(e){
    // Fail soft: client-side JS does its own fetch (with its own retry
    // logic) exactly as before this page had SSR. Never block the page.
    console.error('SSR shop products fetch failed, serving template with client-side fetch:', e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
    return;
  }

  let filtered;
  if(category === 'New In'){
    const featured = products.filter(p=>p.featured);
    filtered = featured.length ? featured : products.slice(0, 8);
  }else if(category){
    filtered = products.filter(p=>p.category === category);
  }else{
    filtered = products;
  }

  const pool = category ? products.filter(p=>p.category !== category) : products;
  const similar = [...pool].sort(()=>Math.random()-0.5).slice(0, 4);

  // Page title/subtitle
  const titleText = category || 'Shop All';
  const subText = category ? `Everything in ${category}` : 'Every FASHIONISTA piece in one place';
  html = setTextById(html, 'pageTitle', 'h1', esc(titleText));
  html = setTextById(html, 'pageSub', 'p', esc(subText));

  // Main grid
  const gridInner = filtered.length
    ? filtered.map((p,i)=>cardMarkup(p,i,i<2)).join('')
    : '';
  html = html.replace('<div class="grid" id="shopGrid"></div>', () => `<div class="grid" id="shopGrid">${gridInner}</div>`);
  if(!filtered.length){
    html = html.replace(
      '<p class="empty-state" id="emptyState" style="display:none;">No products in this category yet — check back soon.</p>',
      () => '<p class="empty-state" id="emptyState">No products in this category yet — check back soon.</p>'
    );
  }

  // Crawlable links to /bracelets, /bandanas and /glasses from the main shop
  // page and the Accessories page.
  if(!category || category === 'Accessories'){
    html = html.replace('</head>', () => LANDING_CSS + '\n</head>');
    html = html.replace('<section class="collection" id="similarSection">', () => BROWSE_LINKS + '\n<section class="collection" id="similarSection">');
  }

  // Category intro text + FAQ (the four real categories only)
  const contentHtml = categoryContentMarkup(category);
  if(contentHtml){
    html = html.replace('</head>', () => SEO_INFO_CSS + '\n</head>');
    html = html.replace('<section class="collection" id="similarSection">', () => contentHtml + '<section class="collection" id="similarSection">');
  }

  // "You Might Also Like"
  html = injectSimilar(html, similar, cardMarkup);

  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ products, similar }).replace(/</g,'\\u003c')}</script>\n`;
  html = html.replace('<script type="module">', () => ssrDataScript + '<script type="module">');

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
};

// Exposed only so the landing-page helpers can be tested locally; Vercel ignores it.
module.exports.__content = { categoryContentMarkup, SEO_INFO_CSS, CATEGORY_CONTENT };
module.exports.__landing = { SCOPE_PAGES, inScope, highlightsMarkup, supportingCopyMarkup, introMarkup, landingJsonLd, patchClientForScope, scopeScript };
