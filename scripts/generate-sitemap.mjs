// scripts/generate-sitemap.mjs
//
// Regenerates sitemap.xml with the site's static pages plus one <url> entry
// per product pulled live from Firestore (products with stock:0 are still
// included, just at a lower priority — they may come back in stock, and a
// 404-free URL is better than churn in the sitemap).
//
// Run manually:
//   npm install firebase
//   node scripts/generate-sitemap.mjs
//
// Runs automatically every day via .github/workflows/update-sitemap.yml

import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import { writeFileSync } from "node:fs";

const firebaseConfig = {
  apiKey: "AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE",
  authDomain: "argentum-3709f.firebaseapp.com",
  projectId: "argentum-3709f",
  storageBucket: "argentum-3709f.firebasestorage.app",
  messagingSenderId: "640506841572",
  appId: "1:640506841572:web:b23582fb753967d5365ff1",
};

const SITE = "https://fashion1sta.com";

const STATIC_PAGES = [
  { loc: "/", changefreq: "daily", priority: "1.0" },
  { loc: "/shop.html", changefreq: "daily", priority: "0.9" },
  { loc: "/shop.html?category=Glasses", changefreq: "daily", priority: "0.7" },
  { loc: "/shop.html?category=Accessories", changefreq: "daily", priority: "0.7" },
  { loc: "/contact.html", changefreq: "monthly", priority: "0.5" },
  { loc: "/shipping.html", changefreq: "monthly", priority: "0.4" },
  { loc: "/return-policy.html", changefreq: "monthly", priority: "0.4" },
  { loc: "/terms.html", changefreq: "yearly", priority: "0.3" },
  { loc: "/privacy.html", changefreq: "yearly", priority: "0.3" },
  { loc: "/track-order.html", changefreq: "monthly", priority: "0.3" },
];

async function main() {
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snap = await getDocs(collection(db, "products"));
  const products = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const urls = [
    ...STATIC_PAGES.map((p) => ({
      loc: `${SITE}${p.loc}`,
      changefreq: p.changefreq,
      priority: p.priority,
    })),
    ...products.map((p) => ({
      loc: `${SITE}/product.html?id=${encodeURIComponent(p.id)}`,
      changefreq: "weekly",
      priority: p.stock === 0 ? "0.3" : "0.6",
    })),
  ];

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (u) =>
          `  <url>\n    <loc>${u.loc}</loc>\n    <changefreq>${u.changefreq}</changefreq>\n    <priority>${u.priority}</priority>\n  </url>`
      )
      .join("\n") +
    `\n</urlset>\n`;

  writeFileSync(new URL("../sitemap.xml", import.meta.url), xml);
  console.log(
    `sitemap.xml written with ${urls.length} URLs (${products.length} products, ${STATIC_PAGES.length} static pages).`
  );
}

main().catch((err) => {
  console.error("Failed to generate sitemap:", err);
  process.exitCode = 1;
});
