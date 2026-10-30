// js/chatbot.js
// FASHIONISTA AI chat assistant ("Fashi") — a self-contained floating widget.
//
// Loaded on every page by js/footer.js (a dynamic import after the page has
// loaded), so there is nothing to add to individual pages. If anything in here
// fails, the page itself is never affected. Firebase is imported dynamically
// and wrapped in try/catch for the same reason. Server side: api/chat.js.
//
// How answers work (cheapest first):
//   1. Quick chips + keyword rules  -> instant, free (offer, delivery, payment, return...)
//   2. Product search from Firestore -> instant, free
//   3. AI (/api/chat, Claude)        -> only for questions the rules can't answer
//   4. Fallback                      -> WhatsApp button
//
// Optional overrides (a page can set this before footer.js runs):
//   <script>window.FASHI_CHAT = { ai:false, botName:'Fashi' };</script>

const CFG = Object.assign({
  botName: 'Fashi',
  store: 'FASHIONISTA',
  whatsapp: '8801759406602',
  email: 'fashionistabd.ceo@gmail.com',
  couponCode: 'SILVER10', // checked live against Firestore coupons/<code>; only mentioned if it exists
  deliveryInside: 70,     // overwritten by Firestore settings/delivery when available
  deliveryOutside: 130,
  api: '/api/chat',
  ai: true
}, window.FASHI_CHAT || {});

if (!document.getElementById('fc-root')) {

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = (n) => `BDT ${n}`;
const withTimeout = (p, ms) => Promise.race([p, new Promise(r => setTimeout(() => r(null), ms))]);
const waLink = (text) => `https://wa.me/${CFG.whatsapp}` + (text ? `?text=${encodeURIComponent(text)}` : '');
function linkify(safeHtml){
  return safeHtml.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

/* ------------------------------------------------------------------ */
/* Data (Firestore, lazy + fail-safe)                                  */
/* ------------------------------------------------------------------ */
let fb = null;
let products = null, productsAt = 0;
let deliveryLoaded = false;

async function getFb(){
  if (fb) return fb;
  try { fb = await import('./firebase-config.js'); }
  catch (e) { console.error('[chatbot] firebase-config failed to load:', e); fb = {}; }
  return fb;
}
async function loadProducts(){
  if (products && (products.length || Date.now() - productsAt < 30000)) return products;
  productsAt = Date.now();
  const f = await getFb();
  try {
    if (f.getDocs && f.collection && f.db) {
      const snap = await withTimeout(f.getDocs(f.collection(f.db, 'products')), 6000);
      if (snap && !snap.empty) products = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }
  } catch (e) { console.error('[chatbot] products load failed:', e); }
  if (!products) products = [];
  return products;
}
async function loadDelivery(){
  if (deliveryLoaded) return;
  deliveryLoaded = true;
  try {
    const f = await getFb();
    if (f.doc && f.getDoc && f.db) {
      const snap = await withTimeout(f.getDoc(f.doc(f.db, 'settings', 'delivery')), 4000);
      if (snap && snap.exists && snap.exists()) {
        const d = snap.data();
        if (d.insideDhaka) CFG.deliveryInside = d.insideDhaka;
        if (d.outsideDhaka) CFG.deliveryOutside = d.outsideDhaka;
      }
    }
  } catch (e) { console.error('[chatbot] delivery settings failed:', e); }
}

// Coupon codes can be read one at a time (Firestore rules: `get` is public), so we
// can check the code is real instead of promising a discount that doesn't exist.
let coupon;  // undefined = not checked yet, null = none, {code,text} = active
async function loadCoupon(){
  if (coupon !== undefined) return coupon;
  coupon = null;
  try {
    const f = await getFb();
    if (f.doc && f.getDoc && f.db && CFG.couponCode) {
      const snap = await withTimeout(f.getDoc(f.doc(f.db, 'coupons', CFG.couponCode)), 4000);
      if (snap && snap.exists && snap.exists()) {
        const d = snap.data();
        coupon = { code: CFG.couponCode, text: d.type === 'percent' ? `${d.value}% off` : `BDT ${d.value} off` };
      }
    }
  } catch (e) { console.error('[chatbot] coupon check failed:', e); }
  return coupon;
}

// Same rule as api/_urls.js productPath(): /product/<slug>, else the old id URL.
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const productPath = (p) => (typeof p.slug === 'string' && p.slug.length <= 100 && SLUG_RE.test(p.slug))
  ? `/product/${p.slug}` : `/product.html?id=${encodeURIComponent(p.id)}`;

/* ------------------------------------------------------------------ */
/* Rule-based answers                                                  */
/* ------------------------------------------------------------------ */
const has = (t, list) => list.some(k => t.includes(k));

function detect(raw){
  const t = raw.toLowerCase().trim();
  if (has(t, ['whatsapp','contact','phone number','number dao','nombor','call korbo','email','mail','jogajog','যোগাযোগ','নাম্বার','নম্বর','হোয়াটসঅ্যাপ'])) return 'contact';
  if (has(t, ['kivabe','kibhabe','kibhabe','how to order','how do i order','order korbo','order korte','order dibo','কিভাবে','কীভাবে'])) return 'howto';
  if (has(t, ['track','order status','order kothay','order ta kothay','pai nai','pailam na','pacchi na','where is my','ট্র্যাক','ট্রাক','স্ট্যাটাস','অর্ডার কোথায়'])) return 'track';
  if (has(t, ['return','exchange','refund','ferot','ferat','bodol','রিটার্ন','এক্সচেঞ্জ','ফেরত','রিফান্ড','বদল'])) return 'return';
  if (has(t, ['payment','bkash','bikash','nagad','rocket','cash on','cod','taka dite','পেমেন্ট','ক্যাশ','বিকাশ','নগদ'])) return 'payment';
  if (has(t, ['delivery','deliver','shipping','courier','charge','koto din','kotodin','kobe pabo','dhaka','ডেলিভারি','ডেলিভারী','কুরিয়ার','চার্জ','কবে পাব'])) return 'delivery';
  if (has(t, ['offer','discount','coupon','promo','silver10','sale','ছাড়','অফার','কুপন','ডিসকাউন্ট'])) return 'offer';
  if (has(t, ['thanks','thank you','thx','dhonnobad','dhanyabad','ধন্যবাদ'])) return 'thanks';
  if (t.length < 28 && /^(hi|hello|hey|hlw|helo|salam|assalam|assalamu|as-salam|হ্যালো|হাই|সালাম|আসসালামু)/.test(t)) return 'greet';
  return null;
}

function ruleReply(intent){
  switch (intent) {
    case 'offer': {
      const disc = (products || []).filter(p => p.was && p.was > p.price).length;
      const parts = [];
      if (coupon) parts.push(`Checkout-e "${coupon.code}" code dile ${coupon.text} pabén.`);
      if (disc) parts.push(`${disc}ta product-e ekhon discount price cholche.`);
      return {
        text: parts.length ? parts.join('\n') : 'Ekhon kono coupon code cholche na. Notun offer-er jonno amader Instagram ba shop page dekhte thakun.',
        links: [{ label: 'Shop dekhun', href: '/shop' }]
      };
    }
    case 'delivery':
      return {
        text: `Delivery charge:\n• Dhaka-r bhitore: ${money(CFG.deliveryInside)}\n• Dhaka-r baire: ${money(CFG.deliveryOutside)}\n\nShomoy (order confirm hobar por):\n• Dhaka-r bhitore: 1–2 business day\n• Dhaka-r baire: 2–5 business day\n\nRaat 8-tar pore, Shukrobar ba chhutir din order korle porer business day-e process hoy. Shob jaygay Cash on Delivery.`,
        links: [{ label: 'Shipping info', href: '/shipping' }]
      };
    case 'payment':
      return { text: 'Amader shob order Cash on Delivery. Courier-er haate product peye taka dibén — online payment lagbe na.' };
    case 'return':
      return {
        text: 'Delivery-r shomoy delivery man-er samne-i parcel check korben. Product damaged/defective, vul product ba vul size hole:\n1. Product ar parcel-er clear chobi tulun\n2. Possible hole sathe sathe delivery man-ke janan\n3. Chobi ar order details amader contact-e pathan\n\nDelivery-r 7 din-er moddhe janate hobe. Eligible hole amra exchange-er babostha kori (cash refund na).',
        links: [{ label: 'Full policy', href: '/return-policy' }, { label: 'Contact', href: '/contact' }]
      };
    case 'track':
      return {
        text: 'Order-er status amra WhatsApp-e jani. Track Order page-e phone number diye WhatsApp-e message korle amra current status ar delivery-r shomoy janiye dibo.',
        links: [{ label: 'Track Order', href: '/track-order' }, { label: 'WhatsApp-e message', href: waLink('Hi! Amar order-er status jante chai. Phone number: ') }]
      };
    case 'howto':
      return { text: 'Order korte:\n1. Product-e "Add to Cart" ba "Buy Now" chapun\n2. Cart theke Checkout-e jan\n3. Naam, phone, address diye "Place Order" chapun\n\nAmra WhatsApp-e order confirm kori, tarpor courier-e pathai. Cash on Delivery.' };
    case 'contact':
      return {
        text: `Amader sathe jogajog:\nWhatsApp: +880 1759-406602\nEmail: ${CFG.email}`,
        links: [{ label: 'WhatsApp-e message', href: waLink('Hi! ') }]
      };
    case 'thanks':
      return { text: 'Welcome! Aro kichu lagle jiggesh korben.' };
    case 'greet':
      return { text: `Assalamu alaikum! Ami ${CFG.botName}. Offer, delivery, return ba product niye help lagle niche theke chip chapun, ba message korun.` };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Product search                                                      */
/* ------------------------------------------------------------------ */
const STOP = new Set(['ache','ase','achhe','ki','koto','dam','price','ta','ti','gulo','dekhan','dekhao','dekhaw','show','the','want','kinbo','chai','lagbe','kon','kemon','amar','ami','apnader','apnar','tomader','ekta','kichu','product','products','item','items','you','have','there','any','for','and','dao','how','much','available','stock','nai','are','tell','about',
  'new','latest','notun','best','popular','selling','sold','trending','cheap','sosta','budget','low','sell']);

function compact(p){ return { href: productPath(p), name: p.name, price: p.price, was: p.was || null, imageUrl: p.imageUrl || null, stock: typeof p.stock === 'number' ? p.stock : null }; }

function findProducts(raw, list){
  if (!list.length) return null;
  const t = raw.toLowerCase();
  const tokens = t.split(/[^a-z0-9]+/).filter(w => w.length >= 3 && !STOP.has(w));
  if (tokens.length) {
    const scored = list.map(p => {
      const hay = `${p.name || ''} ${p.category || ''} ${p.subcategory || ''}`.toLowerCase();
      let s = 0;
      tokens.forEach(w => { if (hay.includes(w) || hay.includes(w.replace(/s$/, ''))) s++; });
      return { p, s };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
    if (scored.length) return { items: scored.slice(0, 4).map(x => x.p), label: 'Eigulo pelam:' };
  }
  const price = (p) => Number(p.price) || 0;
  if (has(t, ['best','popular','selling','bestsell','trending','sold'])) {
    return { items: [...list].sort((a, b) => (b.sold || 0) - (a.sold || 0)).slice(0, 4), label: 'Shobcheye beshi bikri hocche:' };
  }
  if (has(t, ['new','latest','notun','নতুন'])) {
    const f = list.filter(p => p.featured);
    return { items: (f.length ? f : list).slice(0, 4), label: 'Notun kichu piece:' };
  }
  if (has(t, ['cheap','sosta','budget','low price','kom dam'])) {
    return { items: [...list].sort((a, b) => price(a) - price(b)).slice(0, 4), label: 'Kom dam-er piece:' };
  }
  if (has(t, ['glass','chosma','চশমা'])) {
    const g = list.filter(p => p.category === 'Glasses');
    if (g.length) return { items: g.slice(0, 4), label: 'Amader glasses:' };
  }
  if (has(t, ['cloth','jama','pant','পোশাক'])) {
    const c = list.filter(p => p.category === 'Clothing');
    if (c.length) return { items: c.slice(0, 4), label: 'Amader clothing:' };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* AI fallback                                                         */
/* ------------------------------------------------------------------ */
const msgs = [];   // {role:'user'|'bot', text, links?, products?}

async function askAI(){
  if (!CFG.ai) return null;
  const list = await loadProducts();
  const history = msgs.filter(m => m.text).slice(-10)
    .map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(CFG.api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        messages: history,
        products: list.slice(0, 60).map(p => ({
          name: p.name, price: p.price, was: p.was || null,
          category: p.category || '', sub: p.subcategory || '',
          stock: typeof p.stock === 'number' ? p.stock : null
        })),
        delivery: { inside: CFG.deliveryInside, outside: CFG.deliveryOutside },
        coupon: (await loadCoupon()) ? `Code ${coupon.code} gives ${coupon.text} at checkout` : null
      })
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.reply ? String(j.reply) : null;
  } catch (e) {
    console.error('[chatbot] AI call failed:', e);
    return null;
  } finally { clearTimeout(timer); }
}

async function answer(text){
  const intent = detect(text);
  if (intent) {
    if (intent === 'offer') await Promise.all([loadProducts(), loadCoupon()]);
    if (intent === 'delivery') await loadDelivery();
    return ruleReply(intent);
  }
  const list = await loadProducts();
  const found = findProducts(text, list);
  if (found) return { text: found.label, products: found.items.map(compact), links: [{ label: 'Shob dekhun', href: '/shop' }] };
  const ai = await askAI();
  if (ai) return { text: ai };
  return {
    text: 'Eta ami thik bujhte parlam na. Amader team-ke WhatsApp-e message korun, tara help korbe.',
    links: [{ label: 'WhatsApp-e message', href: waLink(text) }]
  };
}

/* ------------------------------------------------------------------ */
/* UI                                                                  */
/* ------------------------------------------------------------------ */
const CHIPS = [
  { label: 'Offer', q: 'offer' },
  { label: 'Delivery', q: 'delivery charge' },
  { label: 'Payment', q: 'payment' },
  { label: 'Return', q: 'return policy' },
  { label: 'Track Order', q: 'track order' },
  { label: 'Products', q: 'best selling products' },
  { label: 'WhatsApp', q: 'whatsapp' }
];

const ICON_CHAT = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.3A8 8 0 1 1 21 12z"/><circle cx="9" cy="12" r="0.6" fill="currentColor"/><circle cx="12.5" cy="12" r="0.6" fill="currentColor"/><circle cx="16" cy="12" r="0.6" fill="currentColor"/></svg>';
const ICON_BOT = '<svg viewBox="0 0 32 32" width="30" height="30" fill="none"><defs><linearGradient id="fcg" x1="0" y1="0" x2="32" y2="32"><stop offset="0" stop-color="#6b6f76"/><stop offset=".55" stop-color="#f2f4f7"/><stop offset="1" stop-color="#b8bcc4"/></linearGradient></defs><rect x="5" y="9" width="22" height="16" rx="6" stroke="url(#fcg)" stroke-width="2"/><circle cx="12" cy="17" r="2" fill="url(#fcg)"/><circle cx="20" cy="17" r="2" fill="url(#fcg)"/><path d="M16 9V5" stroke="url(#fcg)" stroke-width="2" stroke-linecap="round"/><circle cx="16" cy="4" r="1.5" fill="url(#fcg)"/></svg>';

const CSS = `
#fc-root{--fc-bg:#15171a;--fc-head:#0a0b0d;--fc-card:#1e2124;--fc-line:rgba(184,188,196,.22);--fc-silver:#b8bcc4;--fc-bright:#f2f4f7;--fc-dim:#9195a0;font-family:'Instrument Sans',system-ui,-apple-system,sans-serif;}
#fc-root *{box-sizing:border-box;}
.fc-fab{position:fixed;left:14px;bottom:18px;width:54px;height:54px;border-radius:50%;border:1px solid var(--fc-line);background:linear-gradient(135deg,#8b9098,#f2f4f7 55%,#b8bcc4);color:#0a0b0d;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:42;box-shadow:0 6px 22px rgba(0,0,0,.45);padding:0;transition:transform .2s ease;}
.fc-fab:active{transform:scale(.94);}
.fc-panel{position:fixed;left:12px;right:12px;bottom:84px;max-width:390px;height:min(72vh,580px);height:min(72dvh,580px);background:var(--fc-bg);border:1px solid var(--fc-line);border-radius:18px;display:flex;flex-direction:column;overflow:hidden;z-index:48;box-shadow:0 18px 50px rgba(0,0,0,.6);opacity:0;transform:translateY(14px) scale(.98);pointer-events:none;transition:opacity .25s ease,transform .25s ease;}
.fc-panel.open{opacity:1;transform:none;pointer-events:auto;}
.fc-head{display:flex;align-items:center;gap:11px;padding:13px 14px;background:var(--fc-head);border-bottom:1px solid var(--fc-line);}
.fc-avatar{width:40px;height:40px;border-radius:50%;border:1px solid var(--fc-line);display:flex;align-items:center;justify-content:center;background:#17191c;flex-shrink:0;}
.fc-title{flex:1;min-width:0;line-height:1.25;}
.fc-title b{display:block;color:var(--fc-bright);font-size:15px;font-weight:600;}
.fc-title span{font-size:11.5px;color:var(--fc-dim);}
.fc-x{background:none;border:none;color:var(--fc-silver);font-size:17px;cursor:pointer;padding:6px 8px;}
.fc-body{flex:1;overflow-y:auto;padding:14px 12px;display:flex;flex-direction:column;gap:10px;-webkit-overflow-scrolling:touch;}
.fc-msg{max-width:86%;padding:10px 13px;font-size:13.5px;line-height:1.5;color:var(--fc-bright);word-wrap:break-word;overflow-wrap:anywhere;}
.fc-bot{align-self:flex-start;background:var(--fc-card);border:1px solid var(--fc-line);border-radius:16px 16px 16px 4px;}
.fc-user{align-self:flex-end;background:linear-gradient(120deg,#b8bcc4,#f2f4f7);color:#0a0b0d;border-radius:16px 16px 4px 16px;font-weight:500;}
.fc-msg a{color:inherit;text-decoration:underline;}
.fc-links{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px;}
.fc-links a{display:inline-block;text-decoration:none;font-size:12px;font-weight:600;padding:7px 13px;border:1px solid var(--fc-silver);border-radius:16px;color:var(--fc-bright);}
.fc-prods{display:flex;gap:9px;overflow-x:auto;margin:10px -4px 0;padding:0 4px 4px;scrollbar-width:none;}
.fc-prods::-webkit-scrollbar{display:none;}
.fc-pcard{flex:0 0 118px;text-decoration:none !important;color:var(--fc-bright) !important;background:#101215;border:1px solid var(--fc-line);border-radius:10px;padding:7px;}
.fc-pimg{aspect-ratio:1/.8;display:flex;align-items:center;justify-content:center;margin-bottom:6px;}
.fc-pimg img{width:100%;height:100%;object-fit:contain;}
.fc-pname{font-size:11.5px;line-height:1.3;margin-bottom:3px;}
.fc-pprice{font-size:11.5px;font-weight:600;}
.fc-pprice s{color:var(--fc-dim);font-weight:400;margin-left:5px;font-size:10.5px;}
.fc-oos{font-size:10px;color:var(--fc-dim);margin-top:2px;}
.fc-typing{align-self:flex-start;display:flex;gap:4px;padding:12px 14px;background:var(--fc-card);border:1px solid var(--fc-line);border-radius:16px 16px 16px 4px;}
.fc-typing i{width:6px;height:6px;border-radius:50%;background:var(--fc-silver);opacity:.4;animation:fcb 1s infinite ease-in-out;}
.fc-typing i:nth-child(2){animation-delay:.15s;} .fc-typing i:nth-child(3){animation-delay:.3s;}
@keyframes fcb{0%,80%,100%{opacity:.3;transform:translateY(0);}40%{opacity:1;transform:translateY(-3px);}}
.fc-chips{display:flex;gap:8px;overflow-x:auto;padding:10px 12px;border-top:1px solid var(--fc-line);scrollbar-width:none;flex-shrink:0;}
.fc-chips::-webkit-scrollbar{display:none;}
.fc-chips button{flex:0 0 auto;padding:8px 14px;font-size:12px;font-weight:700;letter-spacing:.03em;text-transform:uppercase;background:var(--fc-card);border:1px solid var(--fc-line);color:var(--fc-bright);border-radius:18px;cursor:pointer;font-family:inherit;}
.fc-form{display:flex;gap:9px;padding:10px 12px 4px;border-top:1px solid var(--fc-line);flex-shrink:0;}
.fc-form input{flex:1;min-width:0;padding:11px 14px;background:#101215;border:1px solid var(--fc-line);border-radius:20px;color:var(--fc-bright);font-size:16px;font-family:inherit;outline:none;}
.fc-form input:focus{border-color:var(--fc-silver);}
.fc-form button{padding:0 16px;border:none;border-radius:18px;background:linear-gradient(120deg,#b8bcc4,#f2f4f7);color:#0a0b0d;font-weight:700;font-size:12.5px;letter-spacing:.04em;cursor:pointer;font-family:inherit;}
.fc-form button:disabled{opacity:.5;}
.fc-note{text-align:center;font-size:10.5px;color:var(--fc-dim);padding:2px 0 9px;flex-shrink:0;}
@media(min-width:520px){.fc-panel{right:auto;width:380px;}}
`;

function mount(){
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'fc-root';
  root.innerHTML = `
    <button class="fc-fab" id="fcFab" aria-label="Chat with ${esc(CFG.botName)}">${ICON_CHAT}</button>
    <div class="fc-panel" id="fcPanel" role="dialog" aria-label="Chat assistant">
      <div class="fc-head">
        <div class="fc-avatar">${ICON_BOT}</div>
        <div class="fc-title"><b>${esc(CFG.botName)}</b><span>${esc(CFG.store)} AI Assistant</span></div>
        <button class="fc-x" id="fcClose" aria-label="Close">✕</button>
      </div>
      <div class="fc-body" id="fcBody"></div>
      <div class="fc-chips" id="fcChips"></div>
      <form class="fc-form" id="fcForm" autocomplete="off">
        <input id="fcInput" type="text" placeholder="Ask anything..." maxlength="300" aria-label="Your message">
        <button type="submit" id="fcSend">SEND</button>
      </form>
      <div class="fc-note">AI Assistant can make mistakes.</div>
    </div>`;
  document.body.appendChild(root);

  const panel = root.querySelector('#fcPanel');
  const body = root.querySelector('#fcBody');
  const input = root.querySelector('#fcInput');
  const sendBtn = root.querySelector('#fcSend');
  let busy = false;
  let opened = false;

  function scrollDown(){ body.scrollTop = body.scrollHeight; }

  function renderMsg(m){
    const el = document.createElement('div');
    el.className = 'fc-msg ' + (m.role === 'user' ? 'fc-user' : 'fc-bot');
    let html = linkify(esc(m.text)).replace(/\n/g, '<br>');
    if (m.products && m.products.length) {
      html += '<div class="fc-prods">' + m.products.map(p => `
        <a class="fc-pcard" href="${esc(p.href)}">
          <div class="fc-pimg">${p.imageUrl ? `<img src="${esc(p.imageUrl)}" alt="${esc(p.name)}" loading="lazy">` : ''}</div>
          <div class="fc-pname">${esc(p.name)}</div>
          <div class="fc-pprice">${esc(money(p.price))}${p.was ? `<s>${esc(money(p.was))}</s>` : ''}</div>
          ${p.stock === 0 ? '<div class="fc-oos">Out of stock</div>' : ''}
        </a>`).join('') + '</div>';
    }
    if (m.links && m.links.length) {
      html += '<div class="fc-links">' + m.links.map(l =>
        `<a href="${esc(l.href)}"${/^https?:/.test(l.href) ? ' target="_blank" rel="noopener"' : ''}>${esc(l.label)}</a>`).join('') + '</div>';
    }
    el.innerHTML = html;
    body.appendChild(el);
    scrollDown();
  }

  function persist(){
    try { sessionStorage.setItem('fc_msgs', JSON.stringify(msgs.slice(-30))); } catch (e) {}
  }
  function push(m){ msgs.push(m); renderMsg(m); persist(); }

  function showTyping(){
    const el = document.createElement('div');
    el.className = 'fc-typing';
    el.innerHTML = '<i></i><i></i><i></i>';
    body.appendChild(el);
    scrollDown();
    return el;
  }

  async function ask(text){
    text = text.trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true;
    push({ role: 'user', text });
    const typing = showTyping();
    let reply;
    try { reply = await answer(text); }
    catch (e) {
      console.error('[chatbot] answer failed:', e);
      reply = { text: 'Kichu ekta somossa hoyeche. Abar try korun, ba WhatsApp-e message korun.', links: [{ label: 'WhatsApp-e message', href: waLink() }] };
    }
    typing.remove();
    push(Object.assign({ role: 'bot' }, reply));
    busy = false; sendBtn.disabled = false;
  }

  // restore this tab's conversation (the site is multi-page)
  try {
    const saved = JSON.parse(sessionStorage.getItem('fc_msgs') || '[]');
    if (Array.isArray(saved)) saved.forEach(m => { msgs.push(m); renderMsg(m); });
  } catch (e) {}
  if (!msgs.length) {
    push({ role: 'bot', text: `Assalamu alaikum! Ami ${CFG.botName}, ${CFG.store}-er AI assistant. Offer, delivery, return ba product niye help lagle message korun.` });
  }

  // chips
  const chips = root.querySelector('#fcChips');
  CHIPS.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.label;
    b.addEventListener('click', () => { open(true); ask(c.q); });
    chips.appendChild(b);
  });

  function open(v){
    panel.classList.toggle('open', v);
    if (v && !opened) { opened = true; loadDelivery(); loadProducts(); }
    if (v) scrollDown();
  }
  root.querySelector('#fcFab').addEventListener('click', () => open(!panel.classList.contains('open')));
  root.querySelector('#fcClose').addEventListener('click', () => open(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
  root.querySelector('#fcForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = input.value;
    input.value = '';
    ask(v);
  });
}

mount();

}
