// api/sitemap.js — Vercel serverless function
// Serves /sitemap.xml (see the rewrite in vercel.json). Rebuilds the list on
// every request so every product added/removed in the admin panel is
// reflected without a redeploy. Reads Firestore's public REST API directly —
// no admin credentials needed, since firestore.rules already allows public
// read on /products (same access level as the storefront pages themselves).

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

const STATIC_PAGES = [
  { loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' },
  { loc: `${SITE}/shop.html`, changefreq: 'daily', priority: '0.9' },
  { loc: `${SITE}/glasses`, changefreq: 'daily', priority: '0.8' },
  { loc: `${SITE}/shop.html?category=Accessories`, changefreq: 'daily', priority: '0.7' },
  { loc: `${SITE}/shop.html?category=Clothing`, changefreq: 'daily', priority: '0.7' },
  { loc: `${SITE}/contact.html`, changefreq: 'monthly', priority: '0.5' },
  { loc: `${SITE}/shipping.html`, changefreq: 'monthly', priority: '0.4' },
  { loc: `${SITE}/return-policy.html`, changefreq: 'monthly', priority: '0.4' },
  { loc: `${SITE}/terms.html`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/privacy.html`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/track-order.html`, changefreq: 'monthly', priority: '0.3' }
];

// Pulls every /products document via the Firestore REST API (paginated,
// public read). Returns [] on any failure rather than throwing, so a
// Firestore hiccup degrades to "static pages only" instead of a 500.
async function fetchAllProducts(){
  const products = [];
  let pageToken = '';
  try{
    do{
      const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products?pageSize=300&key=${FIREBASE_API_KEY}`
        + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
      const r = await fetch(url);
      if(!r.ok) break;
      const j = await r.json();
      (j.documents || []).forEach(doc => {
        const id = doc.name.split('/').pop();
        const stockField = doc.fields && doc.fields.stock;
        const stock = stockField ? Number(stockField.integerValue ?? stockField.doubleValue) : null;
        products.push({ id, updateTime: doc.updateTime, outOfStock: stock === 0 });
      });
      pageToken = j.nextPageToken || '';
    } while(pageToken);
  }catch(e){
    console.error('Sitemap: product fetch failed, falling back to static pages only:', e);
    return [];
  }
  return products;
}

function xmlEscape(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function urlTag({ loc, lastmod, changefreq, priority }){
  const lastmodTag = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
  return `  <url>\n    <loc>${xmlEscape(loc)}</loc>${lastmodTag}\n    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`;
}

module.exports = async function handler(req, res){
  const products = await fetchAllProducts();

  const staticUrls = STATIC_PAGES.map(urlTag);
  const productUrls = products.map(p => urlTag({
    loc: `${SITE}/product.html?id=${encodeURIComponent(p.id)}`,
    lastmod: p.updateTime ? p.updateTime.slice(0, 10) : undefined,
    changefreq: 'weekly',
    priority: p.outOfStock ? '0.4' : '0.6'
  }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...productUrls].join('\n')}\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
