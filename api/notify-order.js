// api/notify-order.js — Vercel serverless function
// checkout.html calls this right after a customer places an order. It instantly sends
// the shop owner a message with the full order details (products, quantities, totals,
// customer name / phone / address) by email (Gmail inbox) and/or WhatsApp.
//
// Secrets live ONLY here as Vercel environment variables (Vercel → Project → Settings →
// Environment Variables, then redeploy). Set either channel, or both:
//
//   Email  (Resend):   RESEND_API_KEY, NOTIFY_EMAIL   (optional: NOTIFY_FROM)
//   WhatsApp (CallMeBot), up to 3 numbers. Each number must be registered with
//   CallMeBot on its own and has its own API key:
//     CALLMEBOT_PHONE,   CALLMEBOT_APIKEY     (1st number)
//     CALLMEBOT_PHONE_2, CALLMEBOT_APIKEY_2   (2nd number, optional)
//     CALLMEBOT_PHONE_3, CALLMEBOT_APIKEY_3   (3rd number, optional)
//
// The order itself is always saved to Firestore by the checkout page first — this
// function is only the "ping the owner" step, so if it fails no order is lost.

function str(v, max){ return String(v == null ? '' : v).trim().slice(0, max); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : 0; }
function esc(s){
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Only accept a sane, size-limited order payload.
function cleanOrder(body){
  if(!body || typeof body !== 'object') return null;
  const items = (Array.isArray(body.items) ? body.items.slice(0, 30) : []).map(i => ({
    name: str(i && i.name, 120),
    price: num(i && i.price),
    qty: Math.min(99, Math.max(1, Math.floor(num(i && i.qty)) || 1))
  })).filter(i => i.name);
  const name = str(body.customerName, 100);
  const phone = str(body.phone, 30);
  const address = str(body.address, 300);
  if(!items.length || !name || !phone || !address) return null;
  return {
    id: str(body.orderId, 60),
    name, phone, address,
    note: str(body.note, 300),
    items,
    subtotal: num(body.subtotal),
    deliveryZone: str(body.deliveryZone, 30),
    deliveryCharge: num(body.deliveryCharge),
    couponCode: str(body.couponCode, 40),
    discount: num(body.discount),
    total: num(body.total)
  };
}

function buildText(o){
  const head = '🛍️ New order — FASHIONISTA' + (o.id ? '\nOrder ID: ' + o.id : '');
  const lines = o.items.map(i => `• ${i.name} x${i.qty} — BDT ${i.price * i.qty}`).join('\n');
  const totals = [
    `Subtotal: BDT ${o.subtotal}`,
    `Delivery (${o.deliveryZone || 'n/a'}): BDT ${o.deliveryCharge}`,
    o.discount > 0 ? `Discount${o.couponCode ? ' (' + o.couponCode + ')' : ''}: -BDT ${o.discount}` : '',
    `Total: BDT ${o.total} (Cash on delivery)`
  ].filter(Boolean).join('\n');
  const customer = [
    `Name: ${o.name}`,
    `Phone: ${o.phone}`,
    `Address: ${o.address}`,
    o.note ? `Note: ${o.note}` : ''
  ].filter(Boolean).join('\n');
  return [head, lines, totals, customer].join('\n\n');
}

async function sendEmail(o, text){
  const key = process.env.RESEND_API_KEY;
  const to = process.env.NOTIFY_EMAIL;
  if(!key || !to) return { channel: 'email', skipped: true };
  const cell = 'padding:6px 10px;border-bottom:1px solid #eee;';
  const rows = o.items.map(i =>
    `<tr><td style="${cell}">${esc(i.name)}</td><td style="${cell}">x${i.qty}</td><td style="${cell}text-align:right;">BDT ${i.price * i.qty}</td></tr>`
  ).join('');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;">
      <h2 style="margin:0 0 4px;">New order — FASHIONISTA</h2>
      ${o.id ? `<p style="color:#777;margin:0 0 14px;">Order ID: ${esc(o.id)}</p>` : ''}
      <table style="border-collapse:collapse;width:100%;font-size:14px;">${rows}</table>
      <p style="margin:14px 0 0;font-size:14px;line-height:1.7;">
        Subtotal: BDT ${o.subtotal}<br>
        Delivery (${esc(o.deliveryZone || 'n/a')}): BDT ${o.deliveryCharge}<br>
        ${o.discount > 0 ? `Discount${o.couponCode ? ' (' + esc(o.couponCode) + ')' : ''}: -BDT ${o.discount}<br>` : ''}
        <b>Total: BDT ${o.total}</b> (Cash on delivery)
      </p>
      <p style="margin:14px 0 0;font-size:14px;line-height:1.7;">
        <b>Name:</b> ${esc(o.name)}<br>
        <b>Phone:</b> ${esc(o.phone)}<br>
        <b>Address:</b> ${esc(o.address)}<br>
        ${o.note ? `<b>Note:</b> ${esc(o.note)}` : ''}
      </p>
    </div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM || 'FASHIONISTA Orders <onboarding@resend.dev>',
      to: [to],
      subject: `New order — BDT ${o.total} — ${o.name}`,
      html,
      text
    }),
    signal: AbortSignal.timeout(8000)
  });
  if(!r.ok) throw new Error('Email failed (' + r.status + ')');
  return { channel: 'email', ok: true };
}

// Every WhatsApp number that has both a phone and an API key set in Vercel.
function waRecipients(){
  const list = [];
  ['', '_2', '_3'].forEach(sfx => {
    const phone = String(process.env['CALLMEBOT_PHONE' + sfx] || '').replace(/\D/g, '');
    const apikey = process.env['CALLMEBOT_APIKEY' + sfx];
    if(phone && apikey) list.push({ phone, apikey });
  });
  return list;
}

async function sendWhatsApp(text){
  const recipients = waRecipients();
  if(!recipients.length) return { channel: 'whatsapp', skipped: true };
  const settled = await Promise.allSettled(recipients.map(async ({ phone, apikey }) => {
    const url = 'https://api.callmebot.com/whatsapp.php?phone=' + phone +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(apikey);
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if(!r.ok) throw new Error('WhatsApp failed (' + r.status + ')');
  }));
  const sent = settled.filter(s => s.status === 'fulfilled').length;
  if(!sent) throw new Error('WhatsApp failed for all ' + recipients.length + ' number(s)');
  return { channel: 'whatsapp', ok: true, sent, total: recipients.length };
}

module.exports = async function handler(req, res){
  res.setHeader('Cache-Control', 'no-store');
  if(req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });

  const emailReady = !!(process.env.RESEND_API_KEY && process.env.NOTIFY_EMAIL);
  const waReady = waRecipients().length > 0;
  if(!emailReady && !waReady){
    return res.status(500).json({ error: 'No notification channel is set up. Add RESEND_API_KEY + NOTIFY_EMAIL (email) and/or CALLMEBOT_PHONE + CALLMEBOT_APIKEY (WhatsApp) in Vercel → Settings → Environment Variables, then redeploy.' });
  }

  let body = req.body;
  if(typeof body === 'string'){ try{ body = JSON.parse(body); }catch(e){ body = null; } }
  const order = cleanOrder(body);
  if(!order) return res.status(400).json({ error: 'Invalid order.' });

  const text = buildText(order);
  const settled = await Promise.allSettled([sendEmail(order, text), sendWhatsApp(text)]);
  const results = settled.map(s => s.status === 'fulfilled' ? s.value : { error: (s.reason && s.reason.message) || 'failed' });
  const anyOk = results.some(r => r.ok);
  return res.status(anyOk ? 200 : 502).json({ results });
};
