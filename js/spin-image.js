// js/spin-image.js
// Homepage scroll-rotating image (glasses / bracelet / anything the admin sets).
// Reads Firestore settings/spinImage {imageUrl, enabled, size} — managed from
// admin.html → "Spin Image" tab. Shows ONLY the image; it rotates as you scroll.
// The section stays hidden until the admin has saved an image and turned it on.

import { db, doc, getDoc } from './firebase-config.js';

(async function(){
  const section = document.getElementById('spinSection');
  const img = document.getElementById('spinImg');
  if(!section || !img) return;

  let cfg = null;
  try{
    const snap = await getDoc(doc(db, 'settings', 'spinImage'));
    if(snap.exists()) cfg = snap.data();
  }catch(e){
    console.error('Spin image load failed:', e);
    return;
  }
  if(!cfg || !cfg.enabled || !cfg.imageUrl) return;

  const SIZES = { small: 220, medium: 300, large: 380 };
  section.style.setProperty('--spin-size', (SIZES[cfg.size] || SIZES.medium) + 'px');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEG_PER_PX = 0.3; // how fast it turns while scrolling

  function update(){
    if(reduceMotion){ img.style.transform = 'none'; return; }
    const rect = section.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    if(rect.bottom < -300 || rect.top > vh + 300) return; // off screen, skip work
    const center = rect.top + rect.height / 2;
    // upright when the image is in the middle of the screen, turning as it scrolls past
    const angle = (vh / 2 - center) * DEG_PER_PX;
    img.style.transform = 'rotate(' + angle.toFixed(1) + 'deg)';
  }

  let ticking = false;
  function onScroll(){
    if(ticking) return;
    ticking = true;
    requestAnimationFrame(function(){ ticking = false; update(); });
  }

  img.addEventListener('load', function(){
    section.style.display = 'block';
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
  });
  img.addEventListener('error', function(){ section.style.display = 'none'; });
  img.src = cfg.imageUrl;
})();
