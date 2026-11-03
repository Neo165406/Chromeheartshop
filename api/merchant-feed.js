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

// Product-specific Merchant Center copy. This improves the feed without
// changing Firestore product records or customer-facing catalog data.
const FEED_COPY_BY_SLUG = Object.freeze({
'chrome-heart-bracelet':{title:'Gothic Style Bracelet',description:'A bold gothic-style bracelet for alternative outfits and everyday streetwear. View the product photos, current BDT price and availability before ordering from FASHIONISTA.'},
'chrome-heart-black-silver':{title:'Black and Silver Style Glasses',description:'Black-and-silver style glasses for Y2K-inspired outfits and everyday streetwear. Explore the product photos, current BDT price and availability at FASHIONISTA.'},
'chrome-heart-bracelet-3':{title:'Statement Gothic Bracelet',description:'A statement bracelet with an edgy streetwear look. Style it with casual or alternative outfits and check the current price and stock status at FASHIONISTA.'},
'sun-moon-couple-set':{title:'Sun and Moon Couple Set',description:'A coordinated sun-and-moon design set with a distinctive decorative look. Explore the product photos and current BDT price at FASHIONISTA before ordering.'},
'green-bandana':{title:'Green Bandana',description:'A green bandana that can be styled around your head, neck or waist. Add a versatile accent to casual and streetwear outfits with this FASHIONISTA accessory.'},
'chrome-heart-rimless-silver':{title:'Silver Rimless Glasses',description:'Silver-tone rimless glasses for a clean, understated Y2K-inspired look. View the frame photos, current BDT price and availability at FASHIONISTA.'},
'raglan-long-sleeve-t-shirt':{title:'Raglan Long Sleeve T-Shirt',description:'A long-sleeve raglan T-shirt for casual everyday outfits. Check the product photos, available stock and current BDT price at FASHIONISTA before ordering.'},
'red-bandana':{title:'Red Bandana',description:'A red bandana for styling around your head, neck or waist. Add a bright accent to casual and streetwear outfits with this FASHIONISTA accessory.'},
'pink-bandana':{title:'Pink Bandana',description:'A pink bandana for styling around your head, neck or waist. Add a colour accent to casual and streetwear outfits with this FASHIONISTA accessory.'},
'chrome-heart-rimless-gold':{title:'Gold Rimless Glasses',description:'Gold-tone rimless glasses for a refined Y2K-inspired outfit. View the frame photos, current BDT price and availability at FASHIONISTA.'},
'retro-y2k-star-glass':{title:'Retro Y2K Star Glasses',description:'Retro star-shaped glasses with a Y2K-inspired look. Explore the product photos, current BDT price and availability at FASHIONISTA.'},
'chrome-heart-bracelet-2':{title:'Alternative Style Bracelet',description:'An alternative-style bracelet designed to add an edgy detail to casual outfits. Check the product photos, current BDT price and stock status at FASHIONISTA.'},
'chrome-heart-black-gold':{title:'Black and Gold Style Glasses',description:'Black-and-gold style glasses for Y2K-inspired outfits and everyday streetwear. Explore the frame photos, current BDT price and availability at FASHIONISTA.'},
'chrome-fire-heart-chain':{title:'Gothic Heart Pendant Necklace',description:'A heart-themed pendant necklace with a dark, alternative style. Explore the product photos, current BDT price and availability at FASHIONISTA.'},
'chrome-double-heart-chain':{title:'Double Heart Pendant Necklace',description:'A double-heart pendant necklace for layered looks or a standalone accessory. View the product photos and current BDT price at FASHIONISTA.'},
'retro-double-sided-skull-cross':{title:'Double-Sided Skull Cross Pendant',description:'A skull-and-cross inspired pendant with a reversible design. Add a distinctive detail to alternative outfits and check the current BDT price at FASHIONISTA.'},
'spider-pendant':{title:'Spider Pendant Necklace',description:'A spider-themed pendant for gothic and alternative styling. Explore the product photos, current BDT price and availability at FASHIONISTA.'},
'gothic-fleur-de-lis-cross-pendant':{title:'Gothic Fleur-de-Lis Cross Pendant',description:'A fleur-de-lis cross pendant with a gothic-inspired look. Style it with alternative outfits or layer it with other accessories from FASHIONISTA.'},
'y2k-star-necklace':{title:'Y2K Star Necklace',description:'A star pendant necklace for Y2K, cybercore and everyday streetwear looks. Explore the product photos and current BDT price at FASHIONISTA.'},
'chrome-heart-chain':{title:'Gothic Cross Pendant Necklace',description:'A cross pendant necklace for gothic-inspired outfits and alternative streetwear. View the product photos and current BDT price at FASHIONISTA.'},
'vintage-dark-cross-hollow-out-necklace':{title:'Vintage Dark Cross Hollow-Out Necklace',description:'A hollow-out cross necklace with a vintage, dark aesthetic. Add a distinctive accessory to alternative outfits and explore the current price at FASHIONISTA.'},
'chrome-hearts-raised-cross-dog-tag':{title:'Raised Cross Dog Tag Necklace',description:'A raised-cross dog tag necklace for bold, alternative styling. Explore the product photos and current BDT price at FASHIONISTA before ordering.'}
});

function itemXml(p){
  const price = Number(p.price);
  if(!Number.isFinite(price) || price <= 0) return '';

  const imgs = [];
  if(isHttpUrl(p.imageUrl)) imgs.push(p.imageUrl);
  if(Array.isArray(p.images)) p.images.forEach(u => {
    if(isHttpUrl(u) && !imgs.includes(u)) imgs.push(u);
  });
  if(!imgs.length) return ''; // Merchant Center requires an image

  // Google gets each photo from our own domain (api/product-image.js), not
  // from the image host directly: free image hosts often refuse Google's
  // crawler, which shows up as "broken image link" / "In progress". The index
  // here matches the order of imageList() in api/product-image.js.
  const photoUrls = imgs.map((u, i) =>
    `${SITE}/product-image/${encodeURIComponent(p.id)}.jpg` + (i ? `?n=${i}` : '')
  );

  const category = clean(p.category);
  const slug = clean(p.slug).toLowerCase();
  const copy = FEED_COPY_BY_SLUG[slug] || null;
  let title = copy ? copy.title : titleCase(p.name);
  // Avoid a generic title when a third-party trademark is stripped.
  if(!copy && String(p.name || '').search(BLOCKED_TERM_RE) !== -1 && title) title = `${BRAND} ${title}`;
  BLOCKED_TERM_RE.lastIndex = 0;
  if(title.length < 3) title = `${category || 'Accessory'} — ${BRAND}`;
  title = title.slice(0, 150);

  let desc = copy ? copy.description : clean(p.description)
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
