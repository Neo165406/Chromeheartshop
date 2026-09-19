// js/footer.js
// One shared site footer (brand, socials, page links, contact, copyright).
// Loaded on every page: the app pages get it through js/cart.js, and the
// static pages (contact, policies, track-order) include it with a script tag.
// It replaces any old page-specific <footer>, so the footer is edited in ONE place.
// Works both as a classic <script> and as an imported module (no import/export).
(function(){
  if(window.__siteFooterInit) return;
  window.__siteFooterInit = true;
  if(/admin/i.test(location.pathname)) return; // admin dashboard keeps its own layout

  var CSS = ''
    + '.site-footer{padding:40px 24px 44px;border-top:1px solid var(--line,rgba(184,188,196,0.22));text-align:center;margin:0;background:transparent;font-family:"Instrument Sans",sans-serif;line-height:1.5;color:var(--text-dim,#9195a0);}'
    + '.site-footer *{box-sizing:border-box;}'
    + '.site-footer .sf-logo{font-family:"Fraunces",serif;font-size:18px;letter-spacing:0.14em;color:var(--silver,#b8bcc4);margin-bottom:12px;}'
    + '.site-footer .sf-tagline{font-size:12.5px;color:var(--text-dim,#9195a0);max-width:32ch;margin:0 auto 20px;}'
    + '.site-footer .sf-socials{display:flex;justify-content:center;gap:16px;margin-bottom:26px;}'
    + '.site-footer .sf-socials a{width:30px;height:30px;border:1px solid var(--line,rgba(184,188,196,0.22));border-radius:50%;display:flex;align-items:center;justify-content:center;text-decoration:none;}'
    + '.site-footer .sf-socials svg{width:14px;height:14px;display:block;}'
    + '.site-footer .sf-links{display:flex;flex-direction:column;gap:14px;margin-bottom:26px;}'
    + '.site-footer .sf-links a{font-size:13px;color:var(--text-dim,#9195a0);text-decoration:none;}'
    + '.site-footer .sf-links a:hover{color:var(--silver-bright,#f2f4f7);}'
    + '.site-footer .sf-contact p{font-size:12px;color:var(--text-dim,#9195a0);margin:0 0 4px;}'
    + '.site-footer .sf-contact a{color:var(--silver-bright,#f2f4f7);text-decoration:none;}'
    + '.site-footer .sf-copy{margin-top:20px;font-size:10.5px;letter-spacing:0.08em;color:var(--silver-deep,#6b6f76);}';

  var s = 'none', st = 'var(--silver,#b8bcc4)';
  var HTML = ''
    + '<div class="sf-logo">FASHIONISTA</div>'
    + '<p class="sf-tagline">Gothic-luxury accessories and eyewear for the after-dark wardrobe. Follow us on Instagram.</p>'
    + '<div class="sf-socials">'
    +   '<a href="https://www.instagram.com/FASHIONISTA_bd?stkn=OWJlYzFmOWoyZnlr" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="' + st + '" stroke-width="1.6"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="0.8" fill="' + st + '"/></svg></a>'
    +   '<a href="https://www.facebook.com/share/19EjoiggcT/" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="' + st + '" stroke-width="1.6"><path d="M14 9h3V6h-3c-2 0-3 1-3 3v2H8v3h3v6h3v-6h3l1-3h-4V9c0-.6.4-1 1-1z"/></svg></a>'
    +   '<a href="https://wa.me/8801759406602" target="_blank" rel="noopener" aria-label="WhatsApp"><svg viewBox="0 0 24 24" fill="none" stroke="' + st + '" stroke-width="1.6"><path d="M20 12a8 8 0 1 1-3.7-6.7L20 4l-1 4.3A8 8 0 0 1 20 12z"/><path d="M9 10.5c.3 1.8 2.2 3.7 4 4"/></svg></a>'
    +   '<a href="#" aria-label="TikTok"><svg viewBox="0 0 24 24" fill="none" stroke="' + st + '" stroke-width="1.6"><path d="M15 4v10.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M15 4c0 2.5 2 4.5 4.5 4.5"/></svg></a>'
    + '</div>'
    + '<div class="sf-links">'
    +   '<a href="shop.html">Shop All</a>'
    +   '<a href="shipping.html">Shipping</a>'
    +   '<a href="return-policy.html">Return &amp; Exchange Policy</a>'
    +   '<a href="contact.html">Contact</a>'
    +   '<a href="terms.html">Terms &amp; Conditions</a>'
    +   '<a href="privacy.html">Privacy Policy</a>'
    +   '<a href="track-order.html">Track Order</a>'
    + '</div>'
    + '<div class="sf-contact">'
    +   '<p>Email: <a href="mailto:fashionistabd.ceo@gmail.com">fashionistabd.ceo@gmail.com</a></p>'
    +   '<p>Phone: <a href="https://wa.me/8801759406602">+880 1759-406602</a></p>'
    + '</div>'
    + '<div class="sf-copy">&copy; ' + new Date().getFullYear() + ' FASHIONISTA. ALL RIGHTS RESERVED.</div>';

  function mount(){
    if(document.getElementById('siteFooter')) return;
    // Drop any older page-specific footer so every page shows the same one.
    document.querySelectorAll('body > footer').forEach(function(f){ f.remove(); });
    var style = document.createElement('style');
    style.id = 'siteFooterStyle';
    style.textContent = CSS;
    document.head.appendChild(style);
    var f = document.createElement('footer');
    f.id = 'siteFooter';
    f.className = 'site-footer';
    f.innerHTML = HTML;
    document.body.appendChild(f);
  }

  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
