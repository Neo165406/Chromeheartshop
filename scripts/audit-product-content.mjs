#!/usr/bin/env node
// Read-only product content audit for FASHIONISTA.
// Reads the public Firestore products collection; never writes to Firestore.
// Run: node scripts/audit-product-content.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const PROJECT_ID = 'argentum-3709f';
const source = readFileSync(new URL('../api/sitemap.js', import.meta.url), 'utf8');
const match = source.match(/const FIREBASE_API_KEY = ['"]([^'"]+)['"]/);
if (!match) throw new Error('Could not read the public Firebase web API key from api/sitemap.js.');
const API_KEY = match[1];
const PAGE_SIZE = 300;
const TIMEOUT_MS = 10000;

function value(fields, key) {
  const f = fields?.[key];
  if (!f) return '';
  if ('stringValue' in f) return f.stringValue;
  if ('integerValue' in f) return Number(f.integerValue);
  if ('doubleValue' in f) return Number(f.doubleValue);
  if ('booleanValue' in f) return f.booleanValue;
  return '';
}
function clean(v) {
  return String(v ?? '').replace(/\s+/g, ' ').trim();
}
function csvCell(v) {
  return '"' + String(v ?? '').replace(/"/g, '""') + '"';
}
async function fetchProducts() {
  const all = [];
  let token = '';
  do {
    const url = new URL(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/products`);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    url.searchParams.set('key', API_KEY);
    if (token) url.searchParams.set('pageToken', token);
    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`Firestore read failed: HTTP ${response.status}. No complete audit was produced.`);
    const body = await response.json();
    for (const doc of body.documents || []) {
      const fields = doc.fields || {};
      all.push({
        id: doc.name.split('/').pop(),
        name: clean(value(fields, 'name')),
        slug: clean(value(fields, 'slug')),
        category: clean(value(fields, 'category')),
        subcategory: clean(value(fields, 'subcategory')),
        description: clean(value(fields, 'description')),
        price: value(fields, 'price'),
        stock: value(fields, 'stock')
      });
    }
    token = body.nextPageToken || '';
  } while (token);
  return all;
}

try {
  const products = await fetchProducts();
  const byDescription = new Map();
  for (const p of products) {
    const key = p.description.toLowerCase();
    if (key) byDescription.set(key, (byDescription.get(key) || 0) + 1);
  }
  const rows = products.map(p => {
    const issues = [];
    if (!p.name) issues.push('missing_name');
    if (!p.slug) issues.push('missing_slug');
    if (!p.description) issues.push('missing_description');
    else if (p.description.length < 80) issues.push('short_description_under_80_chars');
    if (p.description && byDescription.get(p.description.toLowerCase()) > 1) issues.push('duplicate_description');
    return { ...p, descriptionLength: p.description.length, issues };
  });
  const flagged = rows.filter(p => p.issues.length);
  const now = new Date().toISOString();
  const header = ['id','name','slug','category','subcategory','price_bdt','stock','description_length','issues','description'];
  const csv = [header, ...rows.map(p => [
    p.id,p.name,p.slug,p.category,p.subcategory,p.price,p.stock,p.descriptionLength,p.issues.join('; '),p.description
  ])].map(row => row.map(csvCell).join(',')).join('\n') + '\n';
  writeFileSync('product-content-audit.csv', csv, 'utf8');
  const lines = [
    '# FASHIONISTA product content audit',
    '',
    `- Generated: ${now}`,
    `- Products fetched: ${rows.length}`,
    `- Products flagged for review: ${flagged.length}`,
    `- Missing descriptions: ${rows.filter(p => !p.description).length}`,
    `- Short descriptions (<80 chars): ${rows.filter(p => p.description && p.description.length < 80).length}`,
    `- Duplicate-description products: ${rows.filter(p => p.description && byDescription.get(p.description.toLowerCase()) > 1).length}`,
    '',
    '## Products requiring review',
    ''
  ];
  if (!flagged.length) lines.push('No products were flagged by the basic checks.');
  for (const p of flagged) {
    lines.push(`### ${p.name || '(unnamed)'}`);
    lines.push(`- ID: ${p.id}`);
    lines.push(`- URL: ${p.slug ? '/product/' + p.slug : '(missing slug)'}`);
    lines.push(`- Category: ${p.category || '(none)'}`);
    lines.push(`- Description length: ${p.descriptionLength}`);
    lines.push(`- Issues: ${p.issues.join(', ')}`);
    lines.push(`- Current description: ${p.description || '(empty)'}`, '');
  }
  lines.push('## Full inventory', '', '| Product | Slug | Category | Description chars | Review flags |', '|---|---|---|---:|---|');
  for (const p of rows) lines.push(`| ${p.name.replace(/\|/g,'/')} | ${p.slug || '—'} | ${p.category.replace(/\|/g,'/')} | ${p.descriptionLength} | ${p.issues.join(', ') || '—'} |`);
  lines.push('', 'This audit is read-only. It does not update Firestore or website content.', '');
  writeFileSync('product-content-audit.md', lines.join('\n'), 'utf8');
  console.log(lines.slice(0, 14).join('\n'));
  console.log('Wrote product-content-audit.csv and product-content-audit.md');
} catch (error) {
  console.error('Product content audit failed:', error.message);
  process.exitCode = 1;
}
