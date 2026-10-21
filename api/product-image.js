// api/product-image.js — serves a product's photo from fashion1sta.com itself.
// Served at /product-image/<productId>.jpg (see the rewrite in vercel.json);
// "?n=1", "?n=2" ... pick the additional photos, in the same order the
// Merchant Center feed lists them.
//
// Why this exists: product photos are uploaded to imgbb (js/imgbb.js) and
// the feed used to hand Google the imgbb links directly. Google's image
// crawler is often refused or rate-limited by free image hosts, and then
// Merchant Center shows "In progress" / "broken image link" and the product
// has no picture in Google. Serving the same photo from our own domain, with
// long cache headers, lets Google fetch it reliably.
//
// Only photos that belong to a product in Firestore can be fetched through
// this function (the id is looked up, no URL is accepted from the request),
// so it cannot be used as an open proxy.

const FIREBASE_API_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
const PROJECT_ID = 'argentum-3709f';
const FETCH_TIMEOUT_MS = 8000;
// Vercel functions can return about 4.5 MB; anything bigger is redirected
// to the original link instead of being proxied.
const MAX_BYTES = 4 * 1024 * 1024;

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

function isPublicHttpUrl(u){
  let url;
  try{ url = new URL(u); }catch(e){ return false; }
  if(url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const h = url.hostname.toLowerCase();
  if(h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if(/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':')) return false; // raw IP addresses
  return true;
}

// Same order as api/merchant-feed.js: the main imageUrl first, then the rest.
function imageList(p){
  const imgs = [];
  if(typeof p.imageUrl === 'string' && /^https?:\/\//i.test(p.imageUrl)) imgs.push(p.imageUrl);
  if(Array.isArray(p.images)) p.images.forEach(u => {
    if(typeof u === 'string' && /^https?:\/\//i.test(u) && !imgs.includes(u)) imgs.push(u);
  });
  return imgs;
}

module.exports = async function handler(req, res){
  const id = String((req.query && req.query.id) || '').replace(/\.(jpe?g|png|webp)$/i, '');
  const n = Math.max(0, parseInt(req.query && req.query.n, 10) || 0);
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id)){
    res.status(404).send('Not found');
    return;
  }

  let product;
  try{
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products/${encodeURIComponent(id)}?key=${FIREBASE_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(r.status === 404){ res.status(404).send('Not found'); return; }
    if(!r.ok) throw new Error('Firestore get(products/' + id + ') failed: ' + r.status);
    const j = await r.json();
    product = fsFields(j.fields || {});
  }catch(e){
    console.error('product-image: product lookup failed:', e);
    res.setHeader('Cache-Control', 'no-store');
    res.status(503).send('Temporarily unavailable');
    return;
  }

  const original = imageList(product)[n];
  if(!original || !isPublicHttpUrl(original)){
    res.status(404).send('Not found');
    return;
  }

  try{
    const up = await fetch(original, {
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; fashion1sta-image-proxy)',
        'Accept': 'image/avif,image/webp,image/*,*/*;q=0.8'
      }
    });
    const type = String(up.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if(!up.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) throw new Error('upstream ' + up.status + ' ' + type);
    const declared = Number(up.headers.get('content-length') || 0);
    if(declared > MAX_BYTES){
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.redirect(302, original);
      return;
    }
    const buf = Buffer.from(await up.arrayBuffer());
    if(buf.length > MAX_BYTES){
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.redirect(302, original);
      return;
    }
    res.setHeader('Content-Type', type);
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.status(200).send(buf);
  }catch(e){
    console.error('product-image: could not fetch original photo for ' + id + ':', e);
    // Do not cache a failure; let Google retry later.
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Image temporarily unavailable');
  }
};
