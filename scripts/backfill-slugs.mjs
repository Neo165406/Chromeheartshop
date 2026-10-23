#!/usr/bin/env node
// scripts/backfill-slugs.mjs — one-time script that gives every existing product
// a `slug` field (used for /product/<slug> URLs, see api/_urls.js).
//
// Run it on YOUR computer, once. It needs a Firebase service-account key, which
// must never be committed or shared (not with GitHub, not with a chat).
//
//   1. Firebase console -> Project settings -> Service accounts -> "Generate new
//      private key". Save the JSON file somewhere outside this repo.
//   2. In an empty folder:   npm init -y && npm i firebase-admin
//      (then copy this file into that folder, or run it from the repo after
//      `npm i firebase-admin` there; .gitignore the node_modules folder)
//   3. Preview (writes nothing):
//        GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json node backfill-slugs.mjs
//      Windows PowerShell:
//        $env:GOOGLE_APPLICATION_CREDENTIALS="C:\path\to\key.json"; node backfill-slugs.mjs
//   4. Looks right? Run again with --write to save the slugs:
//        node backfill-slugs.mjs --write
//
// Products that already have a valid slug are left alone (their slug is never
// changed). Products with the same name get -2, -3 ... in the order they were
// created, so the oldest keeps the plain slug. Safe to run again at any time.

import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Keep identical to slugify() / SLUG_RE in api/_urls.js and admin.html.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function slugify(name){
  const s = String(name == null ? '' : name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
  return s || 'product';
}
function validSlug(s){
  return typeof s === 'string' && s.length <= 100 && SLUG_RE.test(s);
}

const write = process.argv.includes('--write');
const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if(!keyPath){
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to the path of your service-account JSON key first.');
  process.exit(1);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(keyPath, 'utf8'))) });
const db = getFirestore();

const snap = await db.collection('products').get();
const products = snap.docs.map(d => ({ id: d.id, ref: d.ref, ...d.data() }));

// Audit existing valid slugs before planning writes. Duplicate slugs make two
// products compete for the same canonical URL, so never silently leave them in
// place or proceed with a bulk write until they have been resolved deliberately.
const slugOwners = new Map();
products.forEach(p => {
  if(!validSlug(p.slug)) return;
  if(!slugOwners.has(p.slug)) slugOwners.set(p.slug, []);
  slugOwners.get(p.slug).push(p);
});
const duplicates = [...slugOwners.entries()].filter(([, owners]) => owners.length > 1);
if(duplicates.length){
  console.error('DUPLICATE VALID SLUGS FOUND:');
  duplicates.forEach(([slug, owners]) => {
    console.error(`  /product/${slug}`);
    owners.forEach(p => console.error(`    ${p.id}  ${p.name || '(unnamed product)'}`));
  });
  if(write){
    console.error('Refusing to write slugs while duplicate existing slugs remain. Resolve these products first.');
    process.exit(2);
  }
  console.error('Audit only: no writes made. Resolve duplicate slugs before running with --write.\\n');
}

const taken = new Set(slugOwners.keys());

const millis = p => (p.createdAt && typeof p.createdAt.toMillis === 'function') ? p.createdAt.toMillis() : 0;
const todo = products
  .filter(p => !validSlug(p.slug))
  .sort((a, b) => (millis(a) - millis(b)) || a.id.localeCompare(b.id));

const plan = [];
for(const p of todo){
  const base = slugify(p.name);
  let slug = base;
  let n = 2;
  while(taken.has(slug)){ slug = `${base}-${n}`; n++; }
  taken.add(slug);
  plan.push({ ref: p.ref, id: p.id, name: p.name, slug });
}

console.log(`${products.length} products, ${products.length - todo.length} already have a slug, ${plan.length} to fill in.\n`);
plan.forEach(x => console.log(`  ${x.id}  ${String(x.name).padEnd(40)} ->  /product/${x.slug}`));

if(!plan.length){
  console.log('\nNothing to do.');
  process.exit(0);
}
if(!write){
  console.log('\nDry run — nothing was written. Run again with --write to save these slugs.');
  process.exit(0);
}

for(let i = 0; i < plan.length; i += 400){
  const batch = db.batch();
  plan.slice(i, i + 400).forEach(x => batch.update(x.ref, { slug: x.slug }));
  await batch.commit();
}
console.log(`\nDone — wrote ${plan.length} slugs.`);
