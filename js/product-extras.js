// js/product-extras.js
// Extra sections under the Add to Cart / Buy Now buttons on every product page
// (step 1 of the product-page upgrade): trust strip, Description / Shipping &
// Delivery / Materials & Sizes / Returns & Exchange accordions, and the
// "pay after you look" steps.
//
// Loaded on product pages only, by js/footer.js. The product page re-renders
// #productRoot when it hydrates, so a MutationObserver puts the sections back
// each time. They are plain HTML (<details>), so Google can still read the text.
//
// Every statement below mirrors shipping.html and return-policy.html. If those
// policies change, change the text here too.

(function(){
  'use strict';

  var STYLE_ID = 'pxStyle';
  var FS_KEY = 'AIzaSyC_Fgdc_JlFlrPwByNQIa3e-MMGmoRXRWE'; // public web key (same as js/firebase-config.js)
  var FS_PROJECT = 'argentum-3709f';
  var WHATSAPP = '8801759406602';
  var DEFAULT_CLOTHING_SIZES = ['M', 'L', 'XL'];

  function esc(s){
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function errMsg(e){
    return (e && e.code ? e.code + ' — ' : '') + (e && e.message ? e.message : e);
  }

  // ---------- live delivery charges (Firestore settings/delivery, public read) ----------
  var delivery = null;
  var deliveryRequested = false;

  function chargeText(){
    return delivery
      ? 'Inside Dhaka BDT ' + delivery.inside + ' · Outside Dhaka BDT ' + delivery.outside
      : 'shown at checkout';
  }

  function num(f){
    if(!f) return null;
    if('integerValue' in f) return Number(f.integerValue);
    if('doubleValue' in f) return Number(f.doubleValue);
    return null;
  }

  function loadDelivery(){
    if(deliveryRequested) return;
    deliveryRequested = true;
    var url = 'https://firestore.googleapis.com/v1/projects/' + FS_PROJECT + '/databases/(default)/documents/settings/delivery?key=' + FS_KEY;
    var opts = {};
    if(window.AbortSignal && typeof AbortSignal.timeout === 'function') opts.signal = AbortSignal.timeout(4000);
    fetch(url, opts)
      .then(function(r){
        if(!r.ok) throw new Error('Delivery settings fetch failed: HTTP ' + r.status);
        return r.json();
      })
      .then(function(d){
        var f = (d && d.fields) || {};
        var inside = num(f.insideDhaka);
        var outside = num(f.outsideDhaka);
        if(inside == null || outside == null || isNaN(inside) || isNaN(outside)) return;
        delivery = { inside: inside, outside: outside };
        var el = document.getElementById('pxCharge');
        if(el) el.textContent = chargeText();
      })
      .catch(function(e){ console.error('product-extras delivery charges:', errMsg(e)); });
  }

  // ---------- product data (embedded by api/product-page.js) ----------
  function readProduct(){
    var el = document.getElementById('__SSR_DATA__');
    if(!el) return null;
    try{
      var payload = JSON.parse(el.textContent);
      return (payload && payload.product) ? payload.product : null;
    }catch(e){
      return null;
    }
  }

  function sizesOf(p){
    if(!p) return [];
    if(Array.isArray(p.sizes) && p.sizes.length) return p.sizes;
    return String(p.category || '').trim().toLowerCase() === 'clothing' ? DEFAULT_CLOTHING_SIZES : [];
  }

  // ---------- style ----------
  function injectStyle(){
    if(document.getElementById(STYLE_ID)) return;
    var css = [
      '.px-extras{margin:0 0 12px;}',
      '.px-trust{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);border-bottom:1px solid var(--line);margin-bottom:6px;}',
      '.px-trust-item{display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 6px;text-align:center;font-size:11px;color:var(--text-dim);line-height:1.3;}',
      '.px-trust-item + .px-trust-item{border-left:1px solid var(--line);}',
      '.px-trust-item svg{width:20px;height:20px;color:var(--silver);}',
      '.px-det{border-bottom:1px solid var(--line);}',
      ".px-det summary{list-style:none;cursor:pointer;display:flex;align-items:center;justify-content:space-between;padding:16px 0;font-family:'Fraunces',serif;font-size:16px;color:var(--silver-bright);}",
      '.px-det summary::-webkit-details-marker{display:none;}',
      ".px-det summary::after{content:'';width:8px;height:8px;margin-right:4px;border-right:1.6px solid var(--silver);border-bottom:1.6px solid var(--silver);transform:rotate(45deg);transition:transform 0.2s ease;}",
      '.px-det[open] summary::after{transform:rotate(-135deg);}',
      '.px-body{padding:0 0 18px;font-size:13.5px;color:var(--text-dim);line-height:1.7;}',
      '.px-body p{margin-bottom:10px;}',
      '.px-body ul,.px-body ol{padding-left:20px;margin-bottom:10px;}',
      '.px-body li{margin-bottom:6px;}',
      '.px-body a{color:var(--silver-bright);text-decoration:underline;}',
      '.px-body b{color:var(--silver-bright);font-weight:600;}',
      '.px-steps{padding:26px 0 8px;}',
      '.px-steps-title{font-size:11px;letter-spacing:0.14em;color:var(--text-dim);text-transform:uppercase;margin-bottom:16px;}',
      '.px-step{display:flex;gap:14px;position:relative;padding-bottom:18px;}',
      '.px-step:last-child{padding-bottom:0;}',
      '.px-step:not(:last-child)::before{content:"";position:absolute;left:11.5px;top:24px;bottom:0;width:1px;background:var(--line);}',
      '.px-step-n{width:24px;height:24px;border:1px solid var(--line);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;color:var(--silver);flex-shrink:0;background:var(--bg);position:relative;z-index:1;}',
      '.px-step h4{font-size:13.5px;font-weight:600;color:var(--silver-bright);margin-bottom:2px;}',
      '.px-step p{font-size:12.5px;color:var(--text-dim);line-height:1.55;}'
    ].join('');
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ---------- icons ----------
  var ICON_CASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>';
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 9.5-4.1-1.9-7-5.3-7-9.5V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>';
  var ICON_BOX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 7v10l9 4 9-4V7"/><path d="M12 11v10"/></svg>';

  function details(title, body, open){
    return '<details class="px-det"' + (open ? ' open' : '') + '><summary>' + title + '</summary><div class="px-body">' + body + '</div></details>';
  }

  // ---------- build + insert ----------
  function inject(){
    var root = document.getElementById('productRoot');
    var info = root && root.querySelector('.p-info');
    if(!info || info.querySelector('#pxExtras')) return;

    injectStyle();
    loadDelivery();
    var product = readProduct();

    // The old plain "Description" block moves into the accordion below.
    var descText = product && product.description ? String(product.description) : '';
    var kids = info.children;
    for(var i = kids.length - 1; i >= 0; i--){
      var k = kids[i];
      var head = k.firstElementChild;
      if(k.tagName === 'DIV' && head && /^description$/i.test((head.textContent || '').trim())){
        if(!descText){
          var para = k.querySelector('p');
          if(para) descText = para.textContent || '';
        }
        k.remove();
      }
    }

    var html = '';

    // 1) trust strip
    html += '<div class="px-trust">'
      + '<div class="px-trust-item">' + ICON_CASH + '<span>Cash on delivery</span></div>'
      + '<div class="px-trust-item">' + ICON_CHECK + '<span>Check before you pay</span></div>'
      + '<div class="px-trust-item">' + ICON_BOX + '<span>Delivery all over Bangladesh</span></div>'
      + '</div>';

    // 2) accordions
    if(descText.trim()){
      html += details('Description', '<p style="white-space:pre-line;">' + esc(descText) + '</p>', true);
    }

    html += details('Shipping &amp; Delivery',
      '<p><b>Cash on delivery</b> — you pay the courier when your order arrives. No online payment is needed to order.</p>'
      + '<ul>'
      + '<li>Inside Dhaka: usually 1–2 business days after confirmation.</li>'
      + '<li>Outside Dhaka: usually 2–5 business days, depending on courier coverage.</li>'
      + '</ul>'
      + '<p><b>Delivery charge:</b> <span id="pxCharge">' + esc(chargeText()) + '</span></p>'
      + '<p><a href="shipping.html">Full shipping info</a></p>', false);

    var material = product && product.material ? String(product.material).trim() : '';
    var guide = product && product.sizeGuide ? String(product.sizeGuide).trim() : '';
    var sizes = sizesOf(product);
    if(material || guide || sizes.length){
      var mBody = '';
      if(material) mBody += '<p><b>Material:</b> ' + esc(material) + '</p>';
      if(sizes.length) mBody += '<p><b>Available sizes:</b> ' + sizes.map(esc).join(', ') + '</p>';
      if(guide) mBody += '<p style="white-space:pre-line;">' + esc(guide) + '</p>';
      mBody += '<p>Not sure about your size? <a href="https://wa.me/' + WHATSAPP + '" target="_blank" rel="noopener">Message us on WhatsApp</a> before you order.</p>';
      html += details('Materials &amp; Sizes', mBody, false);
    }

    html += details('Returns &amp; Exchange',
      '<p>Please <b>inspect your parcel in front of the delivery person</b> before accepting it. If the product is damaged or defective, incorrect, or the wrong size:</p>'
      + '<ol>'
      + '<li>Take clear photos of the issue while the delivery person is still there.</li>'
      + '<li>Hand the affected product back to the delivery person immediately.</li>'
      + '<li>Send us the photos as proof.</li>'
      + '<li>If eligible, we will arrange an exchange parcel for you.</li>'
      + '</ol>'
      + '<p>Once the parcel is accepted and the delivery person has left, we cannot accept claims for damage, incorrect product or incorrect size.</p>'
      + '<p><a href="return-policy.html">Full return &amp; exchange policy</a></p>', false);

    // 3) pay after you look
    html += '<div class="px-steps">'
      + '<div class="px-steps-title">You pay after you look</div>'
      + '<div class="px-step"><span class="px-step-n">1</span><div><h4>Parcel arrives</h4><p>Open and inspect it in front of the delivery person. No payment yet.</p></div></div>'
      + '<div class="px-step"><span class="px-step-n">2</span><div><h4>You check it</h4><p>Wrong item, damaged or wrong size? Take photos and hand it back on the spot.</p></div></div>'
      + '<div class="px-step"><span class="px-step-n">3</span><div><h4>Then you pay</h4><p>Happy with it? Pay the courier in cash. That is the whole process.</p></div></div>'
      + '</div>';

    var box = document.createElement('div');
    box.id = 'pxExtras';
    box.className = 'px-extras';
    box.innerHTML = html;

    var actions = info.querySelector('.p-actions');
    if(actions && actions.parentNode === info) actions.insertAdjacentElement('afterend', box);
    else info.appendChild(box);
  }

  function run(){
    try{
      inject();
    }catch(e){
      console.error('product-extras error:', errMsg(e));
    }
  }

  var root = document.getElementById('productRoot');
  if(!root) return;
  // The product page replaces #productRoot's content when it hydrates (and
  // again if the product is loaded client-side), so re-apply each time.
  new MutationObserver(run).observe(root, { childList: true });
  run();
})();
