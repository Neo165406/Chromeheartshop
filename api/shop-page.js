// api/shop-page.js — Server-renders shop.html so the grid arrives with
// real product cards already visible instead of a blank page that only
// filled in once client-side JS finished fetching every product from
// Firestore. Also bakes in the right per-category SEO tags server-side.
//
// The static template lives at templates/shop.html (not at the public
// path shop.html) so this function — reached via the /shop.html rewrite
// in vercel.json — is what actually serves that URL, with no
// static-file-vs-rewrite conflict. Reads Firestore's public REST API
// directly (same public web key already used client-side — firestore.rules
// already allows public read on /products, same access level the
// storefront pages themselves have).

const fs = require('fs');
const path = require('path');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

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
    title: "New Arrivals — Gothic Silver Accessories & Eyewear | FASHIONISTA",
    desc: "See the latest arrivals at FASHIONISTA — gothic silver accessories, sunglasses and clothing in Bangladesh. Cash on delivery nationwide."
  },
  "Glasses": {
    title: "Sunglasses Price in Bangladesh — Rimless, Aviator & Round Glasses | FASHIONISTA",
    desc: "Shop gothic silver sunglasses and glasses in Bangladesh — rimless glasses, aviator sunglasses and round sunglasses for men. Cash on delivery nationwide from FASHIONISTA, Dhaka."
  },
  "Accessories": {
    title: "Chain Necklace, Rings, Bracelets & Teeth Grillz in Bangladesh — FASHIONISTA",
    desc: "Shop chain necklaces, silver rings for men, silver bracelets, bandanas, belts and teeth grillz bd. Gothic jewelry Bangladesh with cash on delivery nationwide."
  },
  "Clothing": {
    title: "Streetwear Clothing & T-shirts in Bangladesh — FASHIONISTA",
    desc: "Shop premium streetwear T-shirts and clothing from FASHIONISTA, Dhaka. Cash on delivery across Bangladesh."
  }
};

module.exports = async function handler(req, res){
  const category = (req.query && req.query.category) || '';
  const templatePath = path.join(__dirname, '..', 'templates', 'shop.html');

  let html;
  try{
    html = fs.readFileSync(templatePath, 'utf8');
  }catch(e){
    console.error('shop.html template missing:', e);
    res.status(500).send('Template not found');
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let products;
  try{
    products = await listCollection('products');
  }catch(e){
    // Fail soft: client-side JS does its own fetch (with its own retry
    // logic) exactly as before this page had SSR. Never block the page.
    console.error('SSR shop products fetch failed, serving unmodified template:', e);
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

  // Category-specific SEO tags (default /shop.html tags already in the template)
  const seo = CATEGORY_SEO[category];
  if(seo){
    const url = category === 'Glasses' ? `${SITE}/glasses` : `${SITE}/shop.html?category=${encodeURIComponent(category)}`;
    html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(seo.title)}</title>`);
    html = setAttrById(html, 'metaDesc', 'content', esc(seo.desc));
    html = setAttrById(html, 'ogTitle', 'content', esc(seo.title));
    html = setAttrById(html, 'ogDescription', 'content', esc(seo.desc));
    html = setAttrById(html, 'ogUrl', 'content', esc(url));
    html = setAttrById(html, 'twitterTitle', 'content', esc(seo.title));
    html = setAttrById(html, 'twitterDescription', 'content', esc(seo.desc));
    html = setAttrById(html, 'canonicalLink', 'href', esc(url));
  }

  // Main grid
  const gridInner = filtered.length
    ? filtered.map((p,i)=>cardMarkup(p,i,i<2)).join('')
    : '';
  html = html.replace('<div class="grid" id="shopGrid"></div>', `<div class="grid" id="shopGrid">${gridInner}</div>`);
  if(!filtered.length){
    html = html.replace(
      '<p class="empty-state" id="emptyState" style="display:none;">No products in this category yet — check back soon.</p>',
      '<p class="empty-state" id="emptyState">No products in this category yet — check back soon.</p>'
    );
  }

  // "You Might Also Like"
  if(similar.length){
    html = html
      .replace('<section class="collection" id="similarSection">', '<section class="collection" id="similarSection">')
      .replace('<div class="grid" id="similarGrid"></div>', `<div class="grid" id="similarGrid">${similar.map((p,i)=>cardMarkup(p,i,false)).join('')}</div>`);
  }else{
    html = html.replace('<section class="collection" id="similarSection">', '<section class="collection" id="similarSection" style="display:none;">');
  }

  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ products, similar }).replace(/</g,'\\u003c')}</script>\n`;
  html = html.replace('<script type="module">', ssrDataScript + '<script type="module">');

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
};
