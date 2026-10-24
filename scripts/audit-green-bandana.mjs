#!/usr/bin/env node
// Read-only diagnostic for /product/<slug> 404s (e.g. Green Bandana, Chrome heart chain).
// Run: node scripts/audit-green-bandana.mjs [slug ...]
// Default slugs: green-bandana chrome-heart-chain. Does not write to Firestore.
//
// For each slug it reports:
//   - products whose `slug` field equals it exactly (what api/product-page.js queries first)
//   - products whose NAME slugifies to it (the fallback in api/product-page.js, which only
//     works when exactly ONE product matches)
// plus the total number of products (the fallback only lists the first 300).
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'argentum-3709f';
const sitemapSource = readFileSync(new URL('../api/sitemap.js', import.meta.url), 'utf8');
const keyMatch = sitemapSource.match(/const FIREBASE_API_KEY = ['"]([^'"]+)['"]/);
if (!keyMatch) throw new Error('Could not find public Firestore API key in api/sitemap.js');
const API_KEY = keyMatch[1];

const slugs = process.argv.slice(2).filter(Boolean);
if (!slugs.length) slugs.push('green-bandana', 'chrome-heart-chain');

const slugifyName = value => String(value || '').normalize('NFKD')
  .replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80).replace(/-+$/g, '');

function simplify(doc) {
  const fields = doc.fields || {};
  const read = key => {
    const f = fields[key];
    if (!f) return null;
    if ('stringValue' in f) return f.stringValue;
    if ('integerValue' in f) return Number(f.integerValue);
    if ('doubleValue' in f) return Number(f.doubleValue);
    if ('booleanValue' in f) return f.booleanValue;
    return null;
  };
  return { id: doc.name.split('/').pop(), name: read('name'), slug: read('slug'), category: read('category'), subcategory: read('subcategory'), stock: read('stock') };
}

async function listAll() {
  const out = [];
  let pageToken = '';
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products?pageSize=300&key=${API_KEY}`
      + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Firestore list failed HTTP ${response.status}; no conclusions can be drawn.`);
    const body = await response.json();
    (body.documents || []).forEach(d => out.push(simplify(d)));
    pageToken = body.nextPageToken || '';
  } while (pageToken);
  return out;
}

try {
  const all = await listAll();
  console.log('Slug 404 diagnostic (read-only)');
  console.log(`Total products: ${all.length} (api/product-page.js fallback only scans the first 300)`);
  for (const slug of slugs) {
    const exact = all.filter(p => p.slug === slug);
    const byName = all.filter(p => slugifyName(p.name) === slug);
    const verdict = exact.length >= 1 ? 'OK: slug field matches (page should be 200)'
      : byName.length === 1 ? 'OK via name fallback (page should be 200 after the fallback fix is deployed)'
      : byName.length > 1 ? 'PROBLEM: no slug field match and the name matches MORE THAN ONE product, so the fallback refuses -> 404'
      : 'PROBLEM: no product has this slug and no product name matches -> real 404 (stale/old URL)';
    console.log('\n=== /product/' + slug + ' ===');
    console.log(verdict);
    console.log(JSON.stringify({ exactSlugMatches: exact, nameSlugMatches: byName }, null, 2));
  }
  console.log('\nNo database writes performed.');
} catch (error) {
  console.error('Diagnostic failed:', error.message);
  process.exitCode = 1;
}
