#!/usr/bin/env node
// Read-only targeted diagnostic for the Fashionista Green Bandana 404.
// Run: node scripts/audit-green-bandana.mjs
// Does not write to Firestore.
import { readFileSync } from 'node:fs';

const PROJECT_ID = 'argentum-3709f';
const sitemapSource = readFileSync(new URL('../api/sitemap.js', import.meta.url), 'utf8');
const keyMatch = sitemapSource.match(/const FIREBASE_API_KEY = ['"]([^'"]+)['"]/);
if (!keyMatch) throw new Error('Could not find public Firestore API key in api/sitemap.js');
const API_KEY = keyMatch[1];

async function runQuery(fieldPath, value) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery?key=${API_KEY}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery: {
      from: [{ collectionId: 'products' }],
      where: { fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: { stringValue: value } } },
      limit: 10
    }}),
    signal: AbortSignal.timeout(8000)
  });
  if (!response.ok) throw new Error(`Firestore query failed HTTP ${response.status}; no conclusions can be drawn.`);
  const rows = await response.json();
  return rows.filter(row => row.document).map(row => {
    const d = row.document;
    const fields = d.fields || {};
    const read = key => {
      const f = fields[key];
      if (!f) return null;
      if ('stringValue' in f) return f.stringValue;
      if ('integerValue' in f) return Number(f.integerValue);
      if ('doubleValue' in f) return Number(f.doubleValue);
      if ('booleanValue' in f) return f.booleanValue;
      return null;
    };
    return { id: d.name.split('/').pop(), name: read('name'), slug: read('slug'), category: read('category'), stock: read('stock') };
  });
}

try {
  const [bySlug, byName] = await Promise.all([
    runQuery('slug', 'green-bandana'),
    runQuery('name', 'Green Bandana')
  ]);
  console.log('Fashionista Green Bandana diagnostic (read-only)');
  console.log(JSON.stringify({ queriedSlug: 'green-bandana', exactSlugMatches: bySlug, exactNameMatches: byName }, null, 2));
  console.log('No database writes performed.');
} catch (error) {
  console.error('Diagnostic failed:', error.message);
  process.exitCode = 1;
}
