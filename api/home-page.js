// api/home-page.js — Server-renders index.html so the homepage arrives
// with the hero slide, product grids, reels and collage already visible
// instead of a blank shell that only filled in once client-side JS ran
// four separate Firestore round trips (slides, products, reels, collage).
//
// The static template lives at templates/index.html (not at the public
// path index.html) so this function — reached via the "/" and
// "/index.html" rewrites in vercel.json — is what actually serves those
// URLs, with no static-file-vs-rewrite conflict. Reads Firestore's public
// REST API directly (same public web key already used client-side —
// firestore.rules already allows public read on these collections, same
// access level the storefront pages themselves have).

const fs = require('fs');
const path = require('path');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

// Share image: a plain static file in the repo root (og-image.jpg, 1200x630,
// under 100 KB). Served directly — no function, no query string — because
// WhatsApp is picky about both. If the image ever changes, give the new file a
// new name so Instagram / Facebook / WhatsApp don't reuse a cached preview.
const OG_IMAGE_FILE = 'og-image.jpg';

// Every Firestore call gets a hard time limit and one retry, so a slow or
// flaky database can't hold the page hostage — and a single hiccup doesn't
// turn into an empty page. Worst case per collection is ~2 x 3s.
const FETCH_TIMEOUT_MS = 3000;
const FETCH_ATTEMPTS = 2;

// Search-engine crawlers. If the data genuinely can't be fetched, they get a
// 503 (try again later) instead of an empty 200 page, which Google would
// otherwise file as a "Soft 404" for the homepage.
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

// Fetches every document in a collection (paginated), with a per-request
// timeout. Throws on failure — callers decide how to fail soft.
async function listCollectionOnce(name){
  const docs = [];
  let pageToken = '';
  do{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/${name}?pageSize=300&key=${FIREBASE_API_KEY}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(!r.ok) throw new Error(`Firestore list(${name}) failed: ${r.status}`);
    const j = await r.json();
    (j.documents || []).forEach(doc => {
      docs.push({ id: doc.name.split('/').pop(), ...fsFields(doc.fields || {}) });
    });
    pageToken = j.nextPageToken || '';
  } while(pageToken);
  return docs;
}
async function listCollection(name){
  let lastErr;
  for(let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++){
    try{
      return await listCollectionOnce(name);
    }catch(e){
      lastErr = e;
      console.error(`Firestore list(${name}) attempt ${attempt}/${FETCH_ATTEMPTS} failed:`, e);
    }
  }
  throw lastErr;
}

function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ---------- Icon SVGs (mirrors the client's functions exactly) ----------
function glassesSVG(){return `<svg viewBox="0 0 100 46" fill="none"><circle cx="26" cy="23" r="19" stroke="url(#cardg)" stroke-width="2.5"/><circle cx="74" cy="23" r="19" stroke="url(#cardg)" stroke-width="2.5"/><line x1="45" y1="23" x2="55" y2="23" stroke="url(#cardg)" stroke-width="2.5"/><line x1="7" y1="16" x2="0" y2="11" stroke="url(#cardg)" stroke-width="2.5" stroke-linecap="round"/><line x1="93" y1="16" x2="100" y2="11" stroke="url(#cardg)" stroke-width="2.5" stroke-linecap="round"/><defs><linearGradient id="cardg" x1="0" y1="0" x2="100" y2="46"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function crossSVG(){return `<svg viewBox="0 0 60 60" fill="none"><path d="M30 6 L30 54 M12 24 L48 24" stroke="url(#cardg3)" stroke-width="4" stroke-linecap="round"/><defs><linearGradient id="cardg3" x1="0" y1="0" x2="60" y2="60"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function chainSVG(){return `<svg viewBox="0 0 90 50" fill="none"><ellipse cx="22" cy="25" rx="14" ry="9" stroke="url(#cardg4)" stroke-width="2.2"/><ellipse cx="46" cy="25" rx="14" ry="9" stroke="url(#cardg4)" stroke-width="2.2"/><ellipse cx="70" cy="25" rx="14" ry="9" stroke="url(#cardg4)" stroke-width="2.2"/><defs><linearGradient id="cardg4" x1="0" y1="0" x2="90" y2="50"><stop offset="0%" stop-color="#6b6f76"/><stop offset="55%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs></svg>`;}
function iconFor(type){
  if(type==="glasses") return glassesSVG();
  if(type==="chain") return chainSVG();
  return crossSVG();
}
function slideIcon(type){
  const grad = `<defs><linearGradient id="sg" x1="0" y1="0" x2="60" y2="60"><stop offset="0%" stop-color="#6b6f76"/><stop offset="50%" stop-color="#f2f4f7"/><stop offset="100%" stop-color="#b8bcc4"/></linearGradient></defs>`;
  if(type==="cross") return `<svg viewBox="0 0 60 60" fill="none">${grad}<path d="M30 4 L30 56 M10 22 L50 22" stroke="url(#sg)" stroke-width="4" stroke-linecap="round"/></svg>`;
  if(type==="bottle") return `<svg viewBox="0 0 60 80" fill="none">${grad}<rect x="14" y="24" width="32" height="48" rx="3" stroke="url(#sg)" stroke-width="2.5"/><rect x="22" y="8" width="16" height="16" rx="2" stroke="url(#sg)" stroke-width="2.5"/></svg>`;
  return `<svg viewBox="0 0 90 50" fill="none">${grad}<ellipse cx="22" cy="25" rx="14" ry="9" stroke="url(#sg)" stroke-width="2.5"/><ellipse cx="46" cy="25" rx="14" ry="9" stroke="url(#sg)" stroke-width="2.5"/><ellipse cx="70" cy="25" rx="14" ry="9" stroke="url(#sg)" stroke-width="2.5"/></svg>`;
}
function isDirectVideo(url){
  return /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) || /firebasestorage\.googleapis\.com|firebasestorage\.app/i.test(url);
}

// ---------- Section markup (mirrors the client's render functions) ----------
// Hero slides intentionally render no title <h1>: the page's single h1 is the
// static visually-hidden one in the template (id="staticH1").
function slidesMarkup(slides){
  return slides.map(s=>{
    const bg = s.imageUrl ? ` style="background-image:url('${esc(s.imageUrl)}');"` : '';
    return `
      <div class="slide">
        <div class="slide-bg"${bg}></div>
        <div class="sglow"></div>
        <div class="slide-icon">${s.imageUrl ? '' : slideIcon(s.icon||'cross')}</div>
        ${s.text ? `<p>${esc(s.text)}</p>` : ''}
      </div>`;
  }).join('');
}
function dotsMarkup(slides){
  return slides.map((s,i)=>`<span class="dot${i===0?' active':''}" data-i="${i}"></span>`).join('');
}

// The template's client script (initHero) re-renders the slides after the
// page loads and would put the slide title back as an <h1>. Strip that one
// expression out of the served HTML so the hero never gets a title h1,
// before or after hydration. If the template line ever changes, this simply
// does nothing (the replace finds no match) — it can't break the page.
const CLIENT_SLIDE_TITLE_EXPR = '${s.title ? `<h1 class="display">${s.title}</h1>` : \'\'}';
function withoutSlideTitles(html){
  return html.split(CLIENT_SLIDE_TITLE_EXPR).join('');
}

function cardMarkup(p, i, eagerCount){
  const pid = p.id || String(p.name||'').toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const outOfStock = p.stock === 0;
  const imgAttrs = i < eagerCount
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
    : `<button class="order add-cart-btn" data-id="${esc(pid)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}">Add to Cart</button>
         <button class="order buy-now-btn" data-id="${esc(pid)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}">Buy Now</button>`;
  return `
      <div class="card reveal ${dir}" style="transition-delay:${delay}s">
        <a href="product.html?id=${encodeURIComponent(pid)}" class="card-link">
          <div class="frame">
            ${discount>0 && !outOfStock ? `<span class="discount-badge">-${discount}%</span>` : ''}
            ${outOfStock ? `<span class="discount-badge" style="background:var(--text-dim);">Out of Stock</span>` : ''}
            <button class="fav-btn" data-id="${esc(pid)}" data-name="${esc(p.name)}" data-price="${p.price}" data-image="${esc(p.imageUrl||'')}" aria-label="Save"></button>
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
function gridMarkup(items, eagerCount){
  if(!items.length){
    return '<p style="grid-column:1/-1;font-size:12.5px;color:var(--text-dim);padding:20px 0;">No products here yet — check back soon.</p>';
  }
  return items.map((p,i)=>cardMarkup(p,i,eagerCount||0)).join('');
}

function collageItemMarkup(p){
  const cap = p.caption ? `<div class="collage-caption">${esc(p.caption)}</div>` : '';
  const size = p.size === 'tall' || p.size === 'wide' ? ' ' + p.size : '';
  const safeCap = esc(p.caption||'');
  const safeHref = esc(p.href||'');
  const inner = `<img src="${esc(p.imageUrl)}" alt="${esc(p.caption||'Model wearing our product')}" loading="lazy"><div class="collage-overlay"></div>${cap}`;
  return `<div class="collage-item${size}" role="button" tabindex="0" data-image="${esc(p.imageUrl)}" data-caption="${safeCap}" data-href="${safeHref}">${inner}</div>`;
}

function reelMarkup(r){
  const cap = r.caption ? `<div class="reel-caption">${esc(r.caption)}</div>` : '';
  if(isDirectVideo(r.videoUrl||'')){
    return `<div class="reel-card" data-href="${esc(r.href||'')}">
        <video src="${esc(r.videoUrl)}" muted loop playsinline preload="metadata" ${r.thumbUrl?`poster="${esc(r.thumbUrl)}"`:''}></video>
        <div class="reel-overlay"></div>
        <button class="reel-sound" aria-label="Toggle sound">&#128263;</button>
        ${cap}
      </div>`;
  }
  const cover = r.thumbUrl
    ? `<img src="${esc(r.thumbUrl)}" alt="${esc(r.caption||'Reel')}" loading="lazy">`
    : `<div style="width:100%;height:100%;background:var(--bg-alt);"></div>`;
  return `<a class="reel-card" href="${esc(r.videoUrl)}" target="_blank" rel="noopener">
      ${cover}<div class="reel-overlay"></div><div class="reel-play">&#9654;</div>${cap}
    </a>`;
}

// Share-preview (Instagram / WhatsApp / Facebook) image tags. The image is
// the static /og-image.jpg, on the host that actually served this request, so
// it can never point at a host that redirects. Width/height/type are declared
// so the crawler doesn't have to download the file just to size the card.
function withShareImage(html, req){
  const rawHost = String((req && req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '').split(',')[0].trim();
  const origin = rawHost && !/localhost|\.vercel\.app$/i.test(rawHost) ? `https://${rawHost}` : SITE;
  const img = `${origin}/${OG_IMAGE_FILE}`;
  // Favicon: the old favicon.svg was removed; the brand logo now lives at
  // /favicon-192.png (192x192 — a multiple of 48px, which is what Google
  // Search needs for the result icon) and /favicon.png (512x512), also used
  // for the iOS home-screen icon.
  const iconTags = `<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192.png">\n`
    + `<link rel="icon" type="image/png" sizes="512x512" href="/favicon.png">\n`
    + `<link rel="apple-touch-icon" href="/favicon.png">`;
  return html
    .replace(
      '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg">\n<link rel="shortcut icon" type="image/svg+xml" href="/favicon.svg">',
      () => iconTags
    )
    .replace(
      '<meta property="og:image" content="https://fashion1sta.com/og-image.png">',
      () => `<meta property="og:image" content="${img}">\n`
        + `<meta property="og:image:secure_url" content="${img}">\n`
        + `<meta property="og:image:type" content="image/jpeg">\n`
        + `<meta property="og:image:width" content="1200">\n`
        + `<meta property="og:image:height" content="630">\n`
        + `<meta property="og:image:alt" content="FASHIONISTA — gothic silver accessories">`
    )
    .replace(
      '<meta name="twitter:image" content="https://fashion1sta.com/og-image.png">',
      () => `<meta name="twitter:image" content="${img}">`
    );
}

module.exports = async function handler(req, res){
  const templatePath = path.join(__dirname, '..', 'templates', 'index.html');
  let html;
  try{
    html = fs.readFileSync(templatePath, 'utf8');
  }catch(e){
    console.error('index.html template missing:', e);
    res.status(500).send('Template not found');
    return;
  }

  html = withShareImage(html, req);
  html = withoutSlideTitles(html);

  res.setHeader('Content-Type', 'text/html; charset=utf-8');

  let slides, products, reels, collage;
  try{
    [slides, products, reels, collage] = await Promise.all([
      listCollection('slides'),
      listCollection('products'),
      listCollection('reels'),
      listCollection('collage')
    ]);
  }catch(e){
    console.error('SSR homepage data fetch failed after retries:', e);
    res.setHeader('Cache-Control', 'no-store');

    // Crawlers: tell them to come back later rather than letting them index
    // an empty shell (which Google reports as a "Soft 404").
    const ua = String((req && req.headers && req.headers['user-agent']) || '');
    if(CRAWLER_UA.test(ua)){
      res.setHeader('Retry-After', '120');
      res.status(503).send('Service temporarily unavailable. Please try again shortly.');
      return;
    }

    // Everyone else: fail soft. We can't trust the whole batch, so serve the
    // template completely unmodified. The client script's own per-section
    // fetches (with their own retry logic) take over exactly as before this
    // project had SSR.
    res.status(200).send(html);
    return;
  }

  slides = slides.sort((a,b)=>(a.order||0)-(b.order||0));
  reels = reels.sort((a,b)=>(a.order||0)-(b.order||0));
  const collagePhotos = collage.filter(p=>p.imageUrl).sort((a,b)=>(a.order||0)-(b.order||0));

  const featured = products.filter(p=>p.featured).slice(0,4);
  const arrivals = featured.length ? featured : products.slice(0,4);
  const glasses = products.filter(p=>p.category==="Glasses").slice(0,4);
  const clothing = products.filter(p=>p.category==="Clothing").slice(0,4);
  const newIn = products.slice(0,8);

  // Hero slider
  if(slides.length){
    html = html.replace(
      '<div class="slides" id="slides"></div>',
      `<div class="slides" id="slides">${slidesMarkup(slides)}</div>`
    );
    html = html.replace(
      '<div class="dots" id="dots"></div>',
      `<div class="dots" id="dots">${dotsMarkup(slides)}</div>`
    );
  }else{
    html = html.replace('<div class="hero-slider">', '<div class="hero-slider" style="display:none;">');
  }

  // Product grids
  html = html
    .replace('<div class="grid" id="arrivalsGrid"></div>', `<div class="grid" id="arrivalsGrid">${gridMarkup(arrivals, 2)}</div>`)
    .replace('<div class="grid" id="glassesGrid"></div>', `<div class="grid" id="glassesGrid">${gridMarkup(glasses, 0)}</div>`)
    .replace('<div class="grid" id="clothingGrid"></div>', `<div class="grid" id="clothingGrid">${gridMarkup(clothing, 0)}</div>`)
    .replace('<div class="swipe-row" id="newInRow"></div>', `<div class="swipe-row" id="newInRow">${gridMarkup(newIn, 0)}</div>`);

  // Collage ("Worn By") — stays hidden unless there are photos
  if(collagePhotos.length){
    html = html
      .replace('<section class="collection" id="collage" style="display:none;">', '<section class="collection" id="collage">')
      .replace('<div class="collage-grid" id="collageGrid"></div>', `<div class="collage-grid" id="collageGrid">${collagePhotos.map(collageItemMarkup).join('')}</div>`);
  }

  // Reels — stays hidden unless there are any
  if(reels.length){
    html = html
      .replace('<section class="collection" id="reels" style="display:none;">', '<section class="collection" id="reels">')
      .replace('<div class="reels-row" id="reelsRow"></div>', `<div class="reels-row" id="reelsRow">${reels.map(reelMarkup).join('')}</div>`);
  }

  const ssrDataScript = `<script type="application/json" id="__SSR_DATA__">${JSON.stringify({ slides, products, reels, collage: collagePhotos }).replace(/</g,'\\u003c')}</script>\n`;
  html = html.replace('<script type="module">', ssrDataScript + '<script type="module">');

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
  res.status(200).send(html);
};
