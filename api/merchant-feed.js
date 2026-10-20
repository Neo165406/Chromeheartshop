// api/merchant-feed.js — Google Merchant Center product feed (RSS 2.0 / g: namespace).
// Served at /merchant-feed.xml (see the rewrite in vercel.json). Rebuilt on
// every request from the Firestore "products" collection, so products added,
// repriced or marked out of stock in the admin panel are reflected without a
// redeploy. Submitting this URL in Merchant Center (Products > Feeds >
// Scheduled fetch) is what lets Google show each product with its image and
// price in Shopping / Search free listings.
//
// Use the same canonical product path as the sitemap and product page.
const { productPath } = require('./_urls');

// Reads Firestore's public REST API directly (same public web key already used
// client-side; firestore.rules already allows public read on /products).

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';
const BRAND = 'FASHIONISTA';
const FETCH_TIMEOUT_MS = 8000;

// Third-party brand names must not appear in the feed: Merchant Center
// disapproves listings that use someone else's trademark. Same rule the
// product pages already follow for keywords.
const BLOCKED_TERM_RE = /chrome\s*-?\s*hearts?/gi;

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

async function fetchAllProducts(){
  const products = [];
  let pageToken = '';
  do{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products?pageSize=300&key=${FIREBASE_API_KEY}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(!r.ok) throw new Error('Firestore list(products) failed: ' + r.status);
    const j = await r.json();
    (j.documents || []).forEach(doc => {
      products.push({ id: doc.name.split('/').pop(), ...fsFields(doc.fields || {}) });
    });
    pageToken = j.nextPageToken || '';
  } while(pageToken);
  return products;
}

function xmlEscape(s){
  return String(s == null ? '' : s)
    // drop characters that are illegal in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function clean(s){
  return String(s == null ? '' : s).replace(BLOCKED_TERM_RE, ' ').replace(/\s+/g, ' ').trim();
}

function titleCase(name){
  return clean(name).split(' ').filter(Boolean).map(w => {
    if(/^y2k$/i.test(w)) return 'Y2K';
    if(/[A-Z]/.test(w.slice(1))) return w;
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
}

function money(n){
  return `${Number(n).toFixed(2)} BDT`;
}

function isHttpUrl(u){
  return typeof u === 'string' && /^https?:\/\//i.test(u);
}

function itemXml(p){
  const price = Number(p.price);
  if(!Number.isFinite(price) || price <= 0) return '';

  const imgs = [];
  if(Array.isArray(p.images)) p.images.forEach(u => { if(isHttpUrl(u)) imgs.push(u); });
  if(isHttpUrl(p.imageUrl) && !imgs.includes(p.imageUrl)) imgs.unshift(p.imageUrl);
  if(!imgs.length) return ''; // Merchant Center requires an image

  // Google gets each photo from our own domain (api/product-image.js), not
  // from the image host directly: free image hosts often refuse Google's
  // crawler, which shows up as "broken image link" / "In progress". The index
  // here matches the order of imageList() in api/product-image.js.
  const photoUrls = imgs.map((u, i) =>
    `${SITE}/product-image/${encodeURIComponent(p.id)}.jpg` + (i ? `?n=${i}` : '')
  );

  const category = clean(p.category);
  let title = titleCase(p.name);
  // A stripped third-party brand name would leave a bare "Bracelet": lead with our own brand instead.
  if(String(p.name || '').search(BLOCKED_TERM_RE) !== -1 && title) title = `${BRAND} ${title}`;
  BLOCKED_TERM_RE.lastIndex = 0;
  if(title.length < 3) title = `${category || 'Accessory'} — ${BRAND}`;
  title = title.slice(0, 150);

  let desc = clean(p.description)
    // strip decorative stars / bullets / emoji typed into descriptions
    .replace(/[★☆✦✧✨•●▪◆◇➤➜✔✓⭐️]|[\u{1F300}-\u{1FAFF}]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  if(desc.length < 10) desc = `${title} from ${BRAND}, Dhaka. Cash on delivery across Bangladesh.`;
  desc = desc.slice(0, 5000);

  const was = Number(p.was);
  const onSale = Number.isFinite(was) && was > price;
  const inStock = p.stock !== 0;

  const lines = [
    `<g:id>${xmlEscape(p.id)}</g:id>`,
    `<title>${xmlEscape(title)}</title>`,
    `<description>${xmlEscape(desc)}</description>`,
    `<link>${xmlEscape(`${SITE}${productPath(p)}`)}</link>`,
    `<g:image_link>${xmlEscape(photoUrls[0])}</g:image_link>`
  ];
  photoUrls.slice(1, 11).forEach(u => lines.push(`<g:additional_image_link>${xmlEscape(u)}</g:additional_image_link>`));
  lines.push(
    `<g:availability>${inStock ? 'in_stock' : 'out_of_stock'}</g:availability>`,
    `<g:price>${money(onSale ? was : price)}</g:price>`
  );
  if(onSale) lines.push(`<g:sale_price>${money(price)}</g:sale_price>`);
  lines.push(
    `<g:condition>new</g:condition>`,
    `<g:brand>${xmlEscape(BRAND)}</g:brand>`,
    `<g:identifier_exists>no</g:identifier_exists>`
  );
  if(category) lines.push(`<g:product_type>${xmlEscape(category)}</g:product_type>`);

  return `    <item>\n      ${lines.join('\n      ')}\n    </item>`;
}

function buildFeed(products){
  const items = products.map(itemXml).filter(Boolean);
  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n`
    + `  <channel>\n`
    + `    <title>${BRAND}</title>\n`
    + `    <link>${SITE}/</link>\n`
    + `    <description>${BRAND} — gothic silver accessories, eyewear and clothing, Dhaka, Bangladesh</description>\n`
    + `${items.join('\n')}\n`
    + `  </channel>\n`
    + `</rss>\n`;
}

module.exports = async function handler(req, res){
  let products;
  try{
    products = await fetchAllProducts();
  }catch(e){
    console.error('Merchant feed: product fetch failed:', e);
    // Never serve an empty feed — Merchant Center would treat it as "all products removed".
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).send('Product data temporarily unavailable. Please try again shortly.');
    return;
  }
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
  res.status(200).send(buildFeed(products));
};

// Exposed only for local testing; Vercel ignores it.
module.exports.__feed = { buildFeed, itemXml };
