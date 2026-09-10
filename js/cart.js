// js/cart.js
// Shared cart logic for fashion1sta — localStorage-backed so it persists
// across index.html and shop.html without a backend. Import the pieces
// you need; renderCartDrawer()/updateCartBadge() expect the drawer
// markup (#cartItems, #cartTotal, #cartCheckoutBtn, #cartBadge) to
// already be on the page.

const CART_KEY = 'argentum_cart';
const WA_NUMBER = '8801759406602';

export function getCart(){
  try{ return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch(e){ return []; }
}
function saveCart(cart){
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
  updateCartBadge();
}
export function addToCart(item){
  const cart = getCart();
  const existing = cart.find(c=>c.id===item.id);
  if(existing){ existing.qty += 1; }
  else { cart.push({...item, qty:1}); }
  saveCart(cart);
  renderCartDrawer();
}
export function removeFromCart(id){
  saveCart(getCart().filter(c=>c.id!==id));
  renderCartDrawer();
}
export function updateQty(id, qty){
  const cart = getCart();
  const item = cart.find(c=>c.id===id);
  if(item){ item.qty = Math.max(1, qty); }
  saveCart(cart);
  renderCartDrawer();
}
export function cartTotal(){
  return getCart().reduce((sum,c)=>sum + c.price*c.qty, 0);
}
export function cartCount(){
  return getCart().reduce((sum,c)=>sum + c.qty, 0);
}
export function updateCartBadge(){
  const badge = document.getElementById('cartBadge');
  if(!badge) return;
  const count = cartCount();
  badge.textContent = count;
  badge.style.display = count>0 ? 'flex' : 'none';
}

export function renderCartDrawer(){
  const list = document.getElementById('cartItems');
  const totalEl = document.getElementById('cartTotal');
  const checkoutBtn = document.getElementById('cartCheckoutBtn');
  if(!list) return;
  const cart = getCart();
  if(cart.length===0){
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;padding:24px 0;text-align:center;">Your cart is empty.</p>';
    if(totalEl) totalEl.textContent = 'BDT 0';
    if(checkoutBtn){ checkoutBtn.style.pointerEvents='none'; checkoutBtn.style.opacity=0.4; }
    return;
  }
  list.innerHTML = cart.map(c=>`
    <div class="cart-item" data-id="${c.id}">
      <div class="ci-media">${c.imageUrl?`<img src="${c.imageUrl}">`:''}</div>
      <div class="ci-info">
        <h4>${c.name}</h4>
        <p>BDT ${c.price}</p>
        <div class="ci-qty">
          <button class="qty-btn" data-action="dec">−</button>
          <span>${c.qty}</span>
          <button class="qty-btn" data-action="inc">+</button>
        </div>
      </div>
      <button class="ci-remove" data-action="remove" aria-label="Remove">✕</button>
    </div>`).join('');
  if(totalEl) totalEl.textContent = `BDT ${cartTotal()}`;
  if(checkoutBtn){ checkoutBtn.style.pointerEvents='auto'; checkoutBtn.style.opacity=1; }

  list.querySelectorAll('.cart-item').forEach(el=>{
    const id = el.dataset.id;
    const item = cart.find(c=>c.id===id);
    el.querySelector('[data-action="inc"]').addEventListener('click', ()=>updateQty(id, item.qty+1));
    el.querySelector('[data-action="dec"]').addEventListener('click', ()=>{
      if(item.qty<=1) removeFromCart(id); else updateQty(id, item.qty-1);
    });
    el.querySelector('[data-action="remove"]').addEventListener('click', ()=>removeFromCart(id));
  });
}

export function clearCart(){
  saveCart([]);
  renderCartDrawer();
}

export function checkoutWhatsApp(){
  const cart = getCart();
  if(cart.length===0) return;
  const lines = cart.map(c=>`• ${c.name} x${c.qty} — BDT ${c.price*c.qty}`).join('\n');
  const msg = `Hi! I'd like to order:\n${lines}\n\nTotal: BDT ${cartTotal()}`;
  window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
}

// Instant single-item order, bypassing the cart — used by "Buy Now".
export function buyNowWhatsApp(item, qty=1){
  const msg = `Hi! I'd like to buy:\n• ${item.name} x${qty} — BDT ${item.price*qty}\n\nTotal: BDT ${item.price*qty}`;
  window.open(`https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}`, '_blank');
}

export function showToast(msg){
  let t = document.getElementById('toast');
  if(!t){
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}

// Wires up "Add to Cart" and "Buy Now" buttons inside a container via
// event delegation, so it works even for cards rendered after Firestore
// data loads.
export function wireAddToCart(containerId){
  const el = document.getElementById(containerId);
  if(!el) return;
  el.addEventListener('click', (e)=>{
    const addBtn = e.target.closest('.add-cart-btn');
    if(addBtn){
      addToCart({
        id: addBtn.dataset.id,
        name: addBtn.dataset.name,
        price: Number(addBtn.dataset.price),
        imageUrl: addBtn.dataset.image || null
      });
      showToast(`Added "${addBtn.dataset.name}" to cart`);
      return;
    }
    const buyBtn = e.target.closest('.buy-now-btn');
    if(buyBtn){
      addToCart({
        id: buyBtn.dataset.id,
        name: buyBtn.dataset.name,
        price: Number(buyBtn.dataset.price),
        imageUrl: buyBtn.dataset.image || null
      });
      if(typeof window.toggleCart === 'function') window.toggleCart(true);
    }
  });
}

updateCartBadge();
