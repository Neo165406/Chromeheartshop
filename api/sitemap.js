// api/sitemap.js — Vercel serverless function
// Serves /sitemap.xml (see the rewrite in vercel.json). Rebuilds the list on
// every request so every product added/removed in the admin panel is
// reflected without a redeploy. Reads Firestore's public REST API directly —
// no admin credentials needed, since firestore.rules already allows public
// read on /products (same access level as the storefront pages themselves).

const { productPath } = require('./_urls');

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const SITE = 'https://fashion1sta.com';

const STATIC_PAGES = [
  { loc: `${SITE}/`, changefreq: 'daily', priority: '1.0' },
  { loc: `${SITE}/shop`, changefreq: 'daily', priority: '0.9' },
  { loc: `${SITE}/glasses`, requiredCategory: 'Glasses', changefreq: 'daily', priority: '0.8' },
  { loc: `${SITE}/accessories`, requiredCategory: 'Accessories', changefreq: 'daily', priority: '0.7' },
  { loc: `${SITE}/clothing`, requiredCategory: 'Clothing', changefreq: 'daily', priority: '0.7' },
  { loc: `${SITE}/contact`, changefreq: 'monthly', priority: '0.5' },
  { loc: `${SITE}/shipping`, changefreq: 'monthly', priority: '0.4' },
  { loc: `${SITE}/return-policy`, changefreq: 'monthly', priority: '0.4' },
  { loc: `${SITE}/terms`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/privacy`, changefreq: 'yearly', priority: '0.3' },
  { loc: `${SITE}/track-order`, changefreq: 'monthly', priority: '0.3' }
];

// Sub-category landing pages (see SCOPE_PAGES in api/shop-page.js — keep the
// aliases in sync). A page is listed only while at least one product has a
// matching `subcategory`, because the landing page is noindex when empty.
const LANDING_PAGES = [
  { loc: `${SITE}/bracelets`, aliases: ['bracelets', 'bracelet'], changefreq: 'daily', priority: '0.8' },
  { loc: `${SITE}/rings`, aliases: ['rings', 'ring'], changefreq: 'daily', priority: '0.8' },
  { loc: `${SITE}/bandanas`, aliases: ['bandana', 'bandanas'], changefreq: 'daily', priority: '0.8' },
  { loc: `${SITE}/chrome-heart-chains`, aliases: ['chain', 'chains'], changefreq: 'daily', priority: '0.8' }
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
        const subField = doc.fields && doc.fields.subcategory;
        const subcategory = subField && typeof subField.stringValue === 'string' ? subField.stringValue.trim().toLowerCase() : '';
        const slugField = doc.fields && doc.fields.slug;
        const slug = slugField && typeof slugField.stringValue === 'string' ? slugField.stringValue : '';
        const categoryField = doc.fields && doc.fields.category;
        const category = categoryField && typeof categoryField.stringValue === 'string' ? categoryField.stringValue.trim() : '';
        products.push({ id, slug, updateTime: doc.updateTime, outOfStock: stock === 0, subcategory, category });
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

  // Don't advertise category pages that currently have no matching products;
  // api/shop-page.js marks empty category pages noindex, follow.
  const staticUrls = STATIC_PAGES
    .filter(page => !page.requiredCategory || products.some(p => p.category === page.requiredCategory))
    .map(urlTag);

  const landingUrls = LANDING_PAGES.map(page => {
    const matches = products.filter(p => page.aliases.indexOf(p.subcategory) !== -1);
    if(!matches.length) return null;
    const newest = matches.map(p => p.updateTime || '').sort().pop();
    return urlTag({
      loc: page.loc,
      lastmod: newest ? newest.slice(0, 10) : undefined,
      changefreq: page.changefreq,
      priority: page.priority
    });
  }).filter(Boolean);

  // /product/<slug> for products that have a slug, the old id URL until they do
  // (the same rule api/product-page.js uses for its canonical).
  const productUrls = products.map(p => urlTag({
    loc: `${SITE}${productPath(p)}`,
    lastmod: p.updateTime ? p.updateTime.slice(0, 10) : undefined,
    changefreq: 'weekly',
    priority: p.outOfStock ? '0.4' : '0.6'
  }));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...staticUrls, ...landingUrls, ...productUrls].join('\n')}\n</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  res.status(200).send(xml);
};
