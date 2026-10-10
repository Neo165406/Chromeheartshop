// api/product-page.js — Server-renders product.html so the page arrives
// with the real product already visible (name, price, image, description)
// instead of the blank "Loading..." shell that only filled in once
// client-side JS finished a chain of Firestore round trips.
//
// The static template lives at templates/product.html (not at the public
// path product.html) so this function — reached via the /product.html
// rewrite in vercel.json — is what actually serves that URL, with no
// static-file-vs-rewrite conflict. Reads Firestore's public REST API
// directly (same public web key already used client-side — firestore.rules
// already allows public read on /products, same access level the
// storefront pages themselves have).

const fs = require('fs');
const path = require('path');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

// Hard time limits on the Firestore calls so a slow database can never hold
// the whole page hostage. The product itself gets a generous limit (if it
// times out we fall back to the client-side loader). "Similar products" is
// only a nice-to-have, so it gets a short one — on timeout the page ships
// without it and the browser fills it in afterwards.
const PRODUCT_TIMEOUT_MS = 4000;
const SIMILAR_TIMEOUT_MS = 1500;
const REVIEWS_TIMEOUT_MS = 1500;

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
    ? `<div class="p-thumbs" id="pThumbs">${images.map((img,i)=>`<img src="${esc(img)}" class="${i===0?'active':''}" data-i="${i}" loading="lazy" decoding="async">`).join('')}</div>`
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
    return `<div class="card"><a href="product.html?id=${encodeURIComponent(p.id)}" class="card-link"><div class="frame">${m}</div><h3>${esc(p.name)}</h3></a><div class="price"><span class="now">BDT ${p.price}</span>${p.was?`<span class="was">BDT ${p.was}</span>`:''}</div></div>`;
  }).join('');

  return `
    <div class="breadcrumb"><a href="shop.html">Shop</a> / <a href="shop.html?category=${encodeURIComponent(product.category||'')}">${esc(product.category||'')}</a></div>
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

module.exports = async function handler(req, res){
  const id = (req.query && req.query.id) || '';
  const templatePath = path.join(__dirname, '..', 'templates', 'product.html');

  let html;
  try{
    html = fs.readFileSync(templatePath, 'utf8');
  }catch(e){
    console.error('product.html template missing:', e);
    res.status(500).send('Template not found');
    return;
  }

  // Favicon: the old favicon.svg was removed; the brand logo now lives at
  // /favicon.png (512x512), used for the tab icon and the iOS home-screen icon.
  html = html.replace(
    '<link rel="icon" type="image/svg+xml" href="favicon.svg">\n<link rel="alternate icon" href="favicon-4.ico">\n<link rel="apple-touch-icon" href="apple-touch-icon-4.png">',
    () => '<link rel="icon" type="image/png" sizes="512x512" href="/favicon.png">\n<link rel="apple-touch-icon" href="/favicon.png">'
  );

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  if(!id){
    // No id in the URL — serve the template as-is; the client script's own
    // "Product not found" + noindex handling covers this case.
    res.status(200).send(html);
    return;
  }

  let product = null;
  let fetchFailed = false;
  try{
    product = await fetchProduct(id);
  }catch(e){
    console.error('SSR product fetch failed, serving unmodified template:', e);
    fetchFailed = true;
  }

  if(fetchFailed){
    // Fail soft: client-side JS does its own fetch (with its own retry
    // logic) exactly as before this project ever had SSR. The page is
    // never blocked on this.
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(html);
    return;
  }

  if(!product){
    // Firestore positively confirmed there's no such product — a real dead
    // link, so tell crawlers directly instead of leaving the default
    // "index, follow" in place.
    html = html.replace(
      '<meta name="robots" content="index, follow">',
      '<meta name="robots" content="noindex, follow">'
    );
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=3600');
    res.status(200).send(html);
    return;
  }

  const [similar, reviews] = await Promise.all([
    fetchSimilar(product.category, product.id),
    fetchReviews(product.id)
  ]);

  const url = `${SITE}/product.html?id=${encodeURIComponent(product.id)}`;
  // SEO override for this exact product only.
  const isChromeHeartRimlessSilver = product.id === 'hRTjTVeGAcjWuwFAMwcs';
  const desc = isChromeHeartRimlessSilver
    ? 'Shop silver rimless glasses with Chrome Hearts-inspired detailing at Fashion1sta. Stylish silver-tone eyewear for everyday streetwear.'
    : (product.description
      ? product.description.replace(/\s+/g,' ').trim().slice(0,155)
      : `${product.name} — BDT ${product.price}. Neon silver accessories and eyewear from FASHIONISTA, cash on delivery across Bangladesh.`);
  const image = (product.images && product.images[0]) || product.imageUrl || `${SITE}/og-image.jpg`;
  const titleTag = isChromeHeartRimlessSilver
    ? 'Chrome Heart Rimless Silver Glasses | Fashion1sta'
    : `${esc(product.name)} — FASHIONISTA`;

  html = html
    .replace('<title>FASHIONISTA</title>', `<title>${titleTag}</title>`)
    .replace(
      '<meta name="description" content="Shop neon silver accessories and eyewear at FASHIONISTA. Cash on delivery across Bangladesh.">',
      `<meta name="description" content="${esc(desc)}">`
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
    "url": url,
    "image": image ? [image] : undefined,
    "description": desc,
    "category": product.category || undefined,
    "offers": {
      "@type": "Offer",
      "url": url,
      "priceCurrency": "BDT",
      "price": product.price,
      "availability": product.stock === 0 ? "https://schema.org/OutOfStock" : "https://schema.org/InStock"
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
<script type="application/ld+json" id="productLd">${JSON.stringify(productSchema).replace(/</g,'\\u003c')}</script>
<script type="application/ld+json" id="breadcrumbLd">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Shop", "item": `${SITE}/shop.html` },
      { "@type": "ListItem", "position": 2, "name": product.category || "Products", "item": `${SITE}/shop.html?category=${encodeURIComponent(product.category||'')}` },
      { "@type": "ListItem", "position": 3, "name": product.name, "item": url }
    ]
  }).replace(/</g,'\\u003c')}</script>
</head>`;
  html = html.replace('</head>', jsonLd);

  const snapshot = renderSnapshot(product, similar);
  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ product, similar, reviews }).replace(/</g,'\\u003c')}</script>`;
  html = html.replace(
    '<div id="productRoot">\n  <p class="not-found">Loading...</p>\n</div>',
    `<div id="productRoot">${snapshot}</div>\n${ssrDataScript}`
  );

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
};
