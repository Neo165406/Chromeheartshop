#!/usr/bin/env node
// Read-only product slug audit using the same public Firestore REST access as
// api/sitemap.js. No service-account key, admin SDK, or database writes needed.
//
// Run from the repository root: node scripts/audit-product-slugs.mjs

import { readFileSync } from 'node:fs';

const PROJECT_ID = 'argentum-3709f';
const sitemapSource = readFileSync(new URL('../api/sitemap.js', import.meta.url), 'utf8');
const keyMatch = sitemapSource.match(/const FIREBASE_API_KEY = ['"]([^'"]+)['"]/);
if(!keyMatch){
  console.error('Could not find the public Firestore web API key in api/sitemap.js.');
  process.exit(1);
}
const FIREBASE_API_KEY = keyMatch[1];
const PAGE_SIZE = 300;
const FETCH_TIMEOUT_MS = 8000;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validSlug(value){
  return typeof value === 'string' && value.length <= 100 && SLUG_RE.test(value);
}
function field(doc, key){
  const f = doc.fields && doc.fields[key];
  if(!f) return undefined;
  if(Object.prototype.hasOwnProperty.call(f, 'stringValue')) return f.stringValue;
  if(Object.prototype.hasOwnProperty.call(f, 'integerValue')) return Number(f.integerValue);
  if(Object.prototype.hasOwnProperty.call(f, 'doubleValue')) return Number(f.doubleValue);
  if(Object.prototype.hasOwnProperty.call(f, 'booleanValue')) return f.booleanValue;
  return undefined;
}

async function fetchAll(){
  const products = [];
  let pageToken = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products`);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('key', FIREBASE_API_KEY);
    if(pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if(!response.ok) {
      throw new Error(`Firestore public read failed (HTTP ${response.status}). No audit conclusions can be drawn; check public read rules or run the service-account audit locally.`);
    }
    const body = await response.json();
    for(const doc of (body.documents || [])){
      products.push({
        id: doc.name.split('/').pop(),
        name: field(doc, 'name') || '(unnamed product)',
        slug: field(doc, 'slug'),
        category: field(doc, 'category') || '',
        stock: field(doc, 'stock')
      });
    }
    pageToken = body.nextPageToken || '';
  } while(pageToken);
  return products;
}

try {
  const products = await fetchAll();
  const slugOwners = new Map();
  const missingOrInvalid = [];
  for(const p of products){
    if(!validSlug(p.slug)){
      missingOrInvalid.push(p);
      continue;
    }
    if(!slugOwners.has(p.slug)) slugOwners.set(p.slug, []);
    slugOwners.get(p.slug).push(p);
  }
  const duplicates = [...slugOwners.entries()].filter(([, owners]) => owners.length > 1);
  const outOfStock = products.filter(p => p.stock === 0).length;

  console.log('Fashionista product slug audit (read-only)');
  console.log('==========================================');
  console.log(`Products fetched: ${products.length}`);
  console.log(`Valid slugs: ${products.length - missingOrInvalid.length}`);
  console.log(`Missing/invalid slugs (still use legacy ID URLs): ${missingOrInvalid.length}`);
  console.log(`Duplicate valid slug groups: ${duplicates.length}`);
  console.log(`Products with stock = 0: ${outOfStock}`);
  console.log('\nNo database writes were performed.');

  if(duplicates.length){
    console.log('\nDUPLICATE SLUGS — resolve before any backfill:');
    for(const [slug, owners] of duplicates){
      console.log(`  /product/${slug}`);
      for(const p of owners) console.log(`    ${p.id} | ${p.name}`);
    }
  }
  if(missingOrInvalid.length){
    console.log('\nMISSING/INVALID SLUGS — legacy URL candidates:');
    for(const p of missingOrInvalid){
      console.log(`  ${p.id} | ${p.name} | category=${p.category || '(none)'} | slug=${JSON.stringify(p.slug)}`);
    }
  }
} catch(error) {
  console.error(`Audit could not complete: ${error.message}`);
  process.exitCode = 1;
}
