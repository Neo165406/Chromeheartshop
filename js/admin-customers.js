// js/admin-customers.js
// "Customers" tab for admin.html: shows every buyer's purchase history, built
// from the Firestore "orders" collection. Buyers are grouped by phone number
// (checkout collects name / phone / address, so this works for guests and
// signed-in customers alike).
// The tab and panel are injected here, so admin.html itself needs no changes.

import { db, collection, getDocs, auth, onAuthStateChanged } from './firebase-config.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const bdt = (n) => 'BDT ' + Math.round(Number(n) || 0).toLocaleString('en-US');

let customers = [];

function phoneKey(o) {
  const digits = String(o.phone || '').replace(/\D/g, '');
  if (digits.length >= 10) return digits.slice(-10);
  if (digits) return digits;
  return 'name:' + String(o.customerName || 'unknown').trim().toLowerCase();
}

function orderTime(o) {
  return (o.createdAt && o.createdAt.seconds) ? o.createdAt.seconds * 1000 : 0;
}

function fmtDate(ms) {
  return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

function buildCustomers(orders) {
  const map = new Map();
  orders.forEach((o) => {
    const key = phoneKey(o);
    if (!map.has(key)) map.set(key, { key, orders: [] });
    map.get(key).orders.push(o);
  });
  return [...map.values()].map((c) => {
    c.orders.sort((a, b) => orderTime(b) - orderTime(a));
    const latest = c.orders[0];
    c.name = latest.customerName || 'Unnamed';
    c.phone = latest.phone || '';
    c.address = latest.address || '';
    c.spent = 0;      // fulfilled orders
    c.pending = 0;    // not fulfilled yet
    c.units = 0;
    c.orders.forEach((o) => {
      const total = Number(o.total) || 0;
      if (o.status === 'fulfilled') c.spent += total; else c.pending += total;
      (o.items || []).forEach((i) => { c.units += Number(i.qty) || 0; });
    });
    c.lastOrder = orderTime(latest);
    return c;
  });
}

function renderList() {
  const list = $('custList');
  const q = $('custSearch').value.trim().toLowerCase();
  const sort = $('custSort').value;
  let rows = customers.filter((c) =>
    !q || c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.address.toLowerCase().includes(q));

  if (sort === 'spent') rows.sort((a, b) => (b.spent + b.pending) - (a.spent + a.pending));
  else if (sort === 'orders') rows.sort((a, b) => b.orders.length - a.orders.length);
  else rows.sort((a, b) => b.lastOrder - a.lastOrder);

  if (!rows.length) {
    list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;">No customers match.</p>';
    return;
  }
  list.innerHTML = rows.map((c) => `
    <details class="item" style="display:block;">
      <summary style="cursor:pointer;list-style:none;display:flex;gap:12px;align-items:flex-start;">
        <div class="info">
          <h4>${esc(c.name)} · ${c.orders.length} order${c.orders.length === 1 ? '' : 's'}</h4>
          <p>${esc(c.phone)}</p>
          <p>Spent ${bdt(c.spent)} (fulfilled)${c.pending ? ' · ' + bdt(c.pending) + ' pending' : ''} · ${c.units} item${c.units === 1 ? '' : 's'}</p>
          <p>Last order: ${fmtDate(c.lastOrder)}</p>
        </div>
        <span style="font-size:11px;color:var(--text-dim);flex-shrink:0;">Details ▾</span>
      </summary>
      <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--line);">
        ${c.address ? `<p style="font-size:12px;color:var(--text-dim);margin-bottom:10px;">Address: ${esc(c.address)}</p>` : ''}
        ${c.orders.map((o) => `
          <div style="padding:9px 0;border-bottom:1px solid var(--line);font-size:12px;">
            <div style="display:flex;justify-content:space-between;gap:8px;">
              <span>${fmtDate(orderTime(o))} · ${bdt(o.total)}</span>
              <span style="color:${o.status === 'fulfilled' ? 'var(--silver-bright)' : 'var(--text-dim)'};">${esc(o.status || 'pending')}</span>
            </div>
            <div style="color:var(--text-dim);margin-top:3px;">${esc((o.items || []).map((i) => `${i.name} x${i.qty}`).join(', '))}</div>
            ${o.couponCode ? `<div style="color:var(--text-dim);">Coupon ${esc(o.couponCode)} (−${bdt(o.discount)})</div>` : ''}
          </div>`).join('')}
      </div>
    </details>`).join('');
}

async function loadCustomers() {
  const list = $('custList');
  const status = $('custStatus');
  status.textContent = '';
  list.innerHTML = 'Loading...';
  try {
    const snap = await getDocs(collection(db, 'orders'));
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    customers = buildCustomers(orders);
    $('custCount').textContent = customers.length;
    $('custRepeat').textContent = customers.filter((c) => c.orders.length > 1).length;
    $('custRevenue').textContent = Math.round(customers.reduce((s, c) => s + c.spent, 0)).toLocaleString('en-US');
    $('custAvg').textContent = customers.length
      ? Math.round(orders.reduce((s, o) => s + (Number(o.total) || 0), 0) / customers.length).toLocaleString('en-US')
      : '0';
    if (!customers.length) {
      list.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px;">No customers yet — buyers appear here after their first order.</p>';
      return;
    }
    renderList();
  } catch (e) {
    console.error('Customers load failed:', e);
    list.innerHTML = '';
    status.textContent = 'Could not load customers: ' + (e && e.message ? e.message : e);
  }
}

function inject() {
  if ($('customersPanel')) return;
  const ordersTab = document.querySelector('.tab[data-panel="ordersPanel"]');
  const dash = $('dash');
  if (!ordersTab || !dash) return;

  const tab = document.createElement('div');
  tab.className = 'tab';
  tab.dataset.panel = 'customersPanel';
  tab.textContent = 'Customers';
  ordersTab.insertAdjacentElement('afterend', tab);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.id = 'customersPanel';
  panel.innerHTML = `
    <div class="card-form">
      <h3>Customers &amp; buying info</h3>
      <div class="stat-grid">
        <div class="stat-box"><div class="n" id="custCount">–</div><div class="l">Customers</div></div>
        <div class="stat-box"><div class="n" id="custRepeat">–</div><div class="l">Repeat buyers</div></div>
        <div class="stat-box"><div class="n" id="custRevenue">–</div><div class="l">Revenue, fulfilled (BDT)</div></div>
        <div class="stat-box"><div class="n" id="custAvg">–</div><div class="l">Avg. ordered per customer (BDT)</div></div>
      </div>
      <p style="font-size:11.5px;color:var(--text-dim);margin-top:12px;line-height:1.5;">Built from the Orders list. Buyers are grouped by phone number. Tap a customer to see every order they placed.</p>
      <div class="row2" style="margin-top:14px;">
        <div class="field" style="margin-bottom:0;"><label>Search name / phone / address</label><input id="custSearch" placeholder="Search..."></div>
        <div class="field" style="margin-bottom:0;"><label>Sort by</label>
          <select id="custSort">
            <option value="recent">Most recent order</option>
            <option value="spent">Highest spend</option>
            <option value="orders">Most orders</option>
          </select>
        </div>
      </div>
      <p class="status-msg" id="custStatus"></p>
    </div>
    <div class="list" id="custList"></div>`;
  dash.appendChild(panel);

  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((x) => x.classList.remove('active'));
    tab.classList.add('active');
    panel.classList.add('active');
    loadCustomers();
  });
  $('custSearch').addEventListener('input', renderList);
  $('custSort').addEventListener('change', renderList);
}

onAuthStateChanged(auth, (user) => { if (user) inject(); });
