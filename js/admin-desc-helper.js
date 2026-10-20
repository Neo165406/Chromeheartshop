// js/admin-desc-helper.js — "Description helper" for the admin product form.
//
// Adds a collapsible box under the Description field of Add/Edit product. The
// admin ticks options (colour, design, style, what to wear it with, fit) and
// presses "Write description"; a clean plain-text description is written into
// the textarea, ready to edit. Nothing is sent anywhere: it is a template, not
// an AI call, so it never invents materials, brands or claims — it only says
// what the admin ticked (plus an optional material / extra line they type).
//
// Output follows the site's SEO rules: the first sentence starts with the
// product name and stays short (it becomes the Google snippet), plain text only
// (no emoji or symbols), no third-party brand names, no "price in Bangladesh" /
// "cash on delivery" (the product page adds those itself).
//
// Loaded from js/admin-reviews.js with a guarded dynamic import, so if this file
// ever fails the rest of the admin is unaffected. It injects its own UI after
// #pDescription, so admin.html needs no change.

const GROUPS = [
  { id: 'finish', label: 'Colour / finish', items: ['Silver-tone', 'Black', 'Gold-tone', 'White', 'Antique silver look', 'Multicolour'] },
  { id: 'design', label: 'Design details', items: ['Cross charm', 'Heart motif', 'Star motif', 'Chain-link style', 'Printed pattern', 'Graphic print', 'Plain minimal design', 'Rimless frame', 'Aviator shape', 'Round frame', 'Bold chunky look', 'Engraved detail'] },
  { id: 'style', label: 'Style', items: ['Gothic', 'Y2K', 'Streetwear', 'Retro', 'Minimal'] },
  { id: 'wear', label: 'Wear it with', items: ['a plain tee', 'an all-black outfit', 'a hoodie', 'a denim jacket', 'jeans', 'a watch', 'other accessories'] },
  { id: 'fit', label: 'Fit / size (pick one)', single: true, items: ['Adjustable', 'One size', 'Check size options', 'Oversized fit', 'Regular fit'] }
];

const TYPE_BY_SUB = {
  'bandana': 'bandana', 'bandanas': 'bandana', 'belts': 'belt', 'bracelets': 'bracelet', 'bracelet': 'bracelet',
  'chain-necklaces': 'chain necklace', 'earrings': 'pair of earrings', 'fake piercings': 'fake piercing',
  'keychains': 'keychain', 'ring watch': 'ring watch', 'rings': 'ring', 'ring': 'ring', 'sunglasses': 'pair of sunglasses',
  'tattoo': 'tattoo accessory', 'teeth-grillz': 'set of teeth grillz', 'wallet': 'wallet', 'wallet chains': 'wallet chain',
  'watches': 'watch', 'rimless': 'pair of rimless glasses', 'aviators': 'pair of aviator glasses', 'round': 'pair of round glasses',
  't-shirt': 't-shirt'
};

function typeWord(category, sub){
  const s = String(sub || '').trim().toLowerCase();
  if(s && Object.prototype.hasOwnProperty.call(TYPE_BY_SUB, s)) return TYPE_BY_SUB[s];
  if(s) return s;
  const c = String(category || '').toLowerCase();
  if(c === 'glasses') return 'pair of glasses';
  if(c === 'clothing') return 'clothing piece';
  return 'accessory';
}

function hash(str){
  let h = 0;
  for(let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}
function pick(variants, seed){ return variants[seed % variants.length]; }
function article(word){ return /^[aeiou]/i.test(word) ? 'an' : 'a'; }
function joinList(list){
  if(list.length <= 1) return list[0] || '';
  return list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}
function lowerStyle(s){ return s === 'Y2K' ? 'Y2K' : s.toLowerCase(); }
function endSentence(t){
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if(!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(t) ? t : t + '.';
}

// sel: { finish:[], design:[], style:[], wear:[], fit:'' }
function buildDescription({ name, category, sub, sel, material, extra }){
  const nm = String(name || '').trim();
  const seed = hash(nm.toLowerCase() + '|' + String(category || '') + '|' + String(sub || ''));
  const type = typeWord(category, sub);
  const finish = (sel.finish || []).slice(0, 2).map(f => f.toLowerCase());
  const design = (sel.design || []).slice(0, 2).map(d => d.toLowerCase());

  // Sentence 1: name + what it is. Kept short because Google shows it.
  let lead = type;
  if(finish.length){
    const m = type.match(/^(pair of|set of) (.+)$/);
    lead = m ? `${m[1]} ${joinList(finish)} ${m[2]}` : `${joinList(finish)} ${type}`;
  }
  const base = `${nm} is ${/^(pair|set) of /.test(lead) ? 'a' : article(lead)} ${lead}`;
  let s1 = base + '.';
  if(design.length){
    const withDesign = `${base} with ${joinList(design.map(d => article(d) + ' ' + d))}.`;
    if(withDesign.length <= 110) s1 = withDesign;
  }

  const parts = [s1];
  if((sel.style || []).length){
    const st = joinList(sel.style.map(lowerStyle));
    parts.push(pick([`It suits ${st} looks.`, `A good pick for ${st} outfits.`, `Made for ${st} styling.`], seed));
  }
  if((sel.wear || []).length){
    const w = joinList(sel.wear.slice(0, 3));
    parts.push(pick([`Wear it with ${w}.`, `Pair it with ${w}.`, `It works well with ${w}.`], seed >>> 3));
  }
  const fitText = {
    'Adjustable': 'It has an adjustable fit.',
    'One size': 'It comes in one size.',
    'Check size options': 'Check the size options on this page before ordering.',
    'Oversized fit': 'It has an oversized fit.',
    'Regular fit': 'It has a regular fit.'
  }[sel.fit];
  if(fitText) parts.push(fitText);
  const mat = String(material || '').replace(/\s+/g, ' ').trim();
  if(mat) parts.push(endSentence(`It is made of ${mat}`));
  const ex = endSentence(extra);
  if(ex) parts.push(ex);
  parts.push(pick(['Check the product photos for the exact design before you order.', 'See the photos on this page for the exact design before ordering.'], seed >>> 5));
  return parts.join(' ');
}

export { buildDescription, typeWord, GROUPS };

// ---------------------------------------------------------------- UI (browser only)
function initUI(){
  const ta = document.getElementById('pDescription');
  if(!ta || document.getElementById('descHelper')) return;
  const field = ta.closest('.field') || ta.parentElement;

  const css = document.createElement('style');
  css.textContent = `
    #descHelper{margin:-4px 0 14px;border:1px solid var(--line);border-radius:var(--radius,8px);background:var(--bg);}
    #descHelper summary{cursor:pointer;padding:10px 12px;font-size:12px;color:var(--silver-bright);}
    #descHelper .dh-body{padding:4px 12px 12px;}
    #descHelper .dh-label{font-size:11px;color:var(--text-dim);margin:10px 0 6px;}
    #descHelper .dh-chips{display:flex;flex-wrap:wrap;gap:6px;}
    #descHelper .dh-chip{padding:6px 10px;border:1px solid var(--line);border-radius:14px;background:none;color:var(--text-dim);font-size:11.5px;cursor:pointer;}
    #descHelper .dh-chip[aria-pressed="true"]{border-color:var(--silver-bright);color:var(--silver-bright);background:rgba(255,255,255,0.06);}
    #descHelper input.dh-in{width:100%;padding:8px 10px;background:var(--bg);border:1px solid var(--line);color:var(--text);border-radius:6px;font-size:12.5px;}
    #descHelper .dh-actions{display:flex;gap:8px;align-items:center;margin-top:12px;flex-wrap:wrap;}
    #descHelper .dh-btn{padding:9px 16px;border-radius:6px;border:1px solid var(--silver-bright);background:none;color:var(--silver-bright);font-size:12px;cursor:pointer;}
    #descHelper .dh-note{font-size:11px;color:var(--text-dim);}
    #descHelper .dh-tip{font-size:11px;color:var(--text-dim);margin-top:10px;line-height:1.5;}
  `;
  document.head.appendChild(css);

  const box = document.createElement('details');
  box.id = 'descHelper';
  box.innerHTML = `<summary>Description helper — tick options, then press "Write description"</summary><div class="dh-body"></div>`;
  const body = box.querySelector('.dh-body');

  GROUPS.forEach(g => {
    const lab = document.createElement('div');
    lab.className = 'dh-label';
    lab.textContent = g.label;
    const chips = document.createElement('div');
    chips.className = 'dh-chips';
    chips.dataset.group = g.id;
    g.items.forEach(it => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dh-chip';
      b.textContent = it;
      b.dataset.v = it;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        const on = b.getAttribute('aria-pressed') !== 'true';
        if(g.single) chips.querySelectorAll('.dh-chip').forEach(x => x.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      chips.appendChild(b);
    });
    body.appendChild(lab);
    body.appendChild(chips);
  });

  body.insertAdjacentHTML('beforeend', `
    <div class="dh-label">Material — only if you are sure (e.g. stainless steel)</div>
    <input class="dh-in" id="dhMaterial" placeholder="leave empty if not sure">
    <div class="dh-label">One extra line (optional)</div>
    <input class="dh-in" id="dhExtra" placeholder="e.g. A bold piece that stands out on its own.">
    <div class="dh-actions">
      <button type="button" class="dh-btn" id="dhWrite">Write description</button>
      <button type="button" class="dh-btn" id="dhClear" style="border-color:var(--line);color:var(--text-dim);">Clear ticks</button>
      <span class="dh-note" id="dhNote"></span>
    </div>
    <div class="dh-tip">The text uses the product name, category and subcategory above, so fill those first. Edit it freely afterwards. Do not add other brand names or claims you cannot prove.</div>`);

  field.insertAdjacentElement('afterend', box);

  const note = box.querySelector('#dhNote');
  function selection(){
    const sel = {};
    GROUPS.forEach(g => {
      const on = [...box.querySelectorAll(`[data-group="${g.id}"] .dh-chip[aria-pressed="true"]`)].map(b => b.dataset.v);
      sel[g.id] = g.single ? (on[0] || '') : on;
    });
    return sel;
  }
  function reset(){
    box.querySelectorAll('.dh-chip').forEach(b => b.setAttribute('aria-pressed', 'false'));
    box.querySelector('#dhMaterial').value = '';
    box.querySelector('#dhExtra').value = '';
    note.textContent = '';
  }

  box.querySelector('#dhClear').addEventListener('click', reset);
  box.querySelector('#dhWrite').addEventListener('click', () => {
    const name = document.getElementById('pName').value.trim();
    if(!name){ note.textContent = 'Enter the product name first.'; return; }
    const sel = selection();
    const anyTick = Object.values(sel).some(v => Array.isArray(v) ? v.length : v);
    if(!anyTick){ note.textContent = 'Tick at least one option.'; return; }
    if(ta.value.trim() && !confirm('Replace the current description with the new text?')) return;
    const text = buildDescription({
      name,
      category: document.getElementById('pCategory').value,
      sub: document.getElementById('pSub').value,
      sel,
      material: box.querySelector('#dhMaterial').value,
      extra: box.querySelector('#dhExtra').value
    });
    ta.value = text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const first = text.split(/(?<=[.!?])\s/)[0] || '';
    note.textContent = `Written. First sentence: ${first.length} characters` + (first.length > 110 ? ' (long — shorten the name or fewer details).' : ' (good).');
  });

  // Start from a clean helper whenever the form switches between Add / Edit or a save finishes.
  const mo = new MutationObserver(reset);
  ['productFormTitle', 'pStatus'].forEach(id => {
    const el = document.getElementById(id);
    if(el) mo.observe(el, { childList: true, characterData: true, subtree: true });
  });
}

if(typeof document !== 'undefined'){
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
  else initUI();
}
