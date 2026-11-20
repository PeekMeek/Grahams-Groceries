import * as db from './db.js';
import { DEFAULT_CATEGORIES } from './categories.js';
import { $, $$, esc, uid, fmtWhen, fmtQty, normalize, bestMatch, compressImage, toast, openSheet, confirmSheet } from './util.js';
import { readWithClaude, readWithTesseract, parseText } from './ocr.js';
import * as gh from './github.js';

const LOW = 2; // starred items at or below this quantity go on the grocery list as suggestions

// ---------------- settings (per device) ----------------
const SETTINGS_KEY = 'pantry.settings';
const S = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
const me = () => S.name || 'Someone';

// ---------------- UI state (survives re-renders) ----------------
const ui = {
  stockMode: 'all', stockCat: null, stockSub: null, stockSearch: '', starredOnly: false,
  gMode: 'all', gCat: null, gSub: null, showDone: false,
  gDraft: { name: '', qty: 1, photo: null, category: '', sub: '', note: '' },
  recipeSearch: '', canMakeOnly: false,
  scan: { stage: 'pick' },
  recipeDraft: null
};

// ---------------- categories ----------------
const cats = () => db.get('meta', 'categories')?.list || DEFAULT_CATEGORIES;
const OTHER = { id: 'other', name: 'Other', icon: '📦', subs: [] };
const cat = id => cats().find(c => c.id === id) || cats().find(c => c.id === 'other') || OTHER;

const GUESS = [
  ['meats', 'Poultry', 'chicken turkey duck wing thigh drumstick'],
  ['meats', 'Beef', 'beef steak burger brisket chuck sirloin ribeye roast meatball'],
  ['meats', 'Pork', 'pork bacon ham chop tenderloin prosciutto'],
  ['meats', 'Seafood', 'fish salmon tuna shrimp cod tilapia crab lobster scallop prawn'],
  ['meats', 'Sausage', 'sausage bratwurst chorizo hot dog kielbasa pepperoni'],
  ['meats', 'Deli meats', 'salami deli turkey slices lunch meat'],
  ['dairy', 'Eggs', 'egg eggs'],
  ['dairy', 'Milk & cream', 'milk cream half creamer'],
  ['dairy', 'Cheese', 'cheese cheddar mozzarella parmesan feta brie ricotta'],
  ['dairy', 'Yogurt', 'yogurt yoghurt'],
  ['dairy', 'Butter', 'butter'],
  ['veggies', 'Leafy greens', 'lettuce spinach kale arugula cabbage chard romaine salad'],
  ['veggies', 'Root vegetables', 'potato carrot beet sweet radish turnip parsnip'],
  ['veggies', 'Onions & garlic', 'onion garlic shallot leek scallion'],
  ['veggies', 'Peppers & tomatoes', 'pepper tomato jalapeno chili'],
  ['veggies', 'Squash', 'zucchini squash pumpkin cucumber'],
  ['veggies', 'Mushrooms', 'mushroom'],
  ['veggies', 'Herbs', 'basil cilantro parsley mint thyme rosemary dill'],
  ['veggies', '', 'broccoli cauliflower celery corn pea bean asparagus avocado'],
  ['fruit', 'Berries', 'strawberry blueberry raspberry blackberry berry grape'],
  ['fruit', 'Citrus', 'lemon lime orange grapefruit clementine'],
  ['fruit', 'Apples & pears', 'apple pear'],
  ['fruit', 'Tropical', 'banana pineapple mango kiwi papaya coconut'],
  ['fruit', 'Stone fruit', 'peach plum cherry nectarine apricot'],
  ['bakery', 'Bread', 'bread bagel loaf baguette sourdough'],
  ['bakery', 'Tortillas & wraps', 'tortilla wrap pita naan'],
  ['bakery', 'Rolls & buns', 'roll bun muffin croissant'],
  ['pantry', 'Pasta & grains', 'pasta spaghetti rice noodle quinoa oat penne macaroni couscous'],
  ['pantry', 'Baking', 'flour sugar yeast baking vanilla cocoa'],
  ['pantry', 'Oils & vinegars', 'oil vinegar'],
  ['pantry', 'Spices', 'salt cumin paprika cinnamon oregano spice seasoning'],
  ['pantry', 'Sauces & condiments', 'ketchup mustard mayo mayonnaise sauce salsa dressing soy honey jam peanut'],
  ['pantry', 'Canned goods', 'can canned soup broth stock'],
  ['pantry', 'Beans & lentils', 'lentil chickpea black beans kidney'],
  ['pantry', 'Breakfast', 'cereal granola pancake syrup'],
  ['frozen', 'Ice cream', 'ice cream gelato'],
  ['frozen', 'Meals', 'frozen pizza'],
  ['desserts', 'Cookies', 'cookie brownie'],
  ['desserts', 'Candy & chocolate', 'chocolate candy'],
  ['desserts', 'Cakes & pies', 'cake pie cupcake'],
  ['snacks', 'Chips & crackers', 'chips crackers pretzel popcorn'],
  ['snacks', 'Nuts & seeds', 'almond walnut cashew pecan nut seed'],
  ['drinks', 'Coffee & tea', 'coffee tea'],
  ['drinks', 'Juice', 'juice'],
  ['drinks', 'Soda & water', 'soda water seltzer cola sparkling'],
  ['drinks', 'Beer & wine', 'beer wine'],
  ['prepared', 'Leftovers', 'leftover leftovers'],
  ['household', 'Paper goods', 'paper towel toilet napkin foil wrap'],
  ['household', 'Cleaning', 'soap detergent bleach sponge dish']
];
function guessCategory(name) {
  const words = normalize(name).split(' ');
  for (let i = words.length - 1; i >= 0; i--) {           // last word is usually the noun
    for (const [c, sub, list] of GUESS) {
      if (list.split(' ').map(normalize).includes(words[i]) && cats().some(x => x.id === c))
        return { category: c, sub: cat(c).subs.includes(sub) ? sub : '' };
    }
  }
  return { category: 'other', sub: '' };
}

// ---------------- domain helpers ----------------
const items = () => db.list('items').sort((a, b) => a.name.localeCompare(b.name));
const isPrepared = it => it.prepared ?? !!cat(it.category).prepared;
const isLow = it => it.starred && it.qty <= LOW;
const activeGrocery = () => db.list('grocery').filter(g => !g.done);
const groceryFor = it => activeGrocery().find(g => g.itemId === it.id || normalize(g.name) === normalize(it.name));
const suggestions = () => items().filter(it => isLow(it) && !it.lowDismissed && !groceryFor(it));
const findItem = name => bestMatch(name, db.list('items'), 0.75);
const resolveIng = ing => (ing.itemId && db.get('items', ing.itemId)) || findItem(ing.name);

function recipeStatus(r) {
  const rows = (r.ingredients || []).map(ing => {
    const item = resolveIng(ing);
    const need = +ing.uses || 1;
    const ok = ing.optional || (item && item.qty >= need);
    return { ing, item, need, ok };
  });
  const missing = rows.filter(x => !x.ok);
  return { rows, missing, canMake: !missing.length };
}
const recipesUsing = it => db.list('recipes').filter(r => (r.ingredients || []).some(ing => resolveIng(ing)?.id === it.id));

async function setQty(it, qty) {
  qty = Math.max(0, Math.round(qty * 100) / 100);
  const patch = { ...it, qty };
  if (qty > LOW) patch.lowDismissed = false;
  return db.put('items', patch);
}

async function addToGrocery({ name, qty = 1, itemId = null, category, sub, note = '', photo = null }) {
  const it = itemId ? db.get('items', itemId) : findItem(name);
  const guess = it ? { category: it.category, sub: it.sub } : guessCategory(name);
  return db.put('grocery', {
    id: uid(), name: name.trim(), qty: +qty || 1, itemId: it?.id || null,
    category: category || guess.category, sub: sub ?? guess.sub, note, photo,
    addedBy: me(), addedAt: Date.now(), done: false
  });
}

// Photos are either a data URL (just taken here) or a path in the repo that is
// downloaded once and cached; <img data-photo> tags get filled in by hydratePhotos.
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const photoSrc = p => !p ? '' : p.startsWith('data:') ? `src="${p}"` : db.photoCached(p) ? `src="${db.photoCached(p)}"` : `src="${BLANK}" data-photo="${esc(p)}"`;
const pimg = (p, attrs = '') => `<img ${attrs} ${photoSrc(p)} alt="">`;
const thumb = (src, cls = 'thumb', act = '') => src
  ? pimg(src, `class="${cls}" ${act ? `data-act="${act}"` : ''}`)
  : `<span class="${cls} ph"></span>`;
function hydratePhotos(root = document) {
  const imgs = [...root.querySelectorAll('img[data-photo]')];
  if (root.matches?.('img[data-photo]')) imgs.push(root);
  for (const el of imgs) {
    const p = el.dataset.photo;
    gh.loadPhoto(p).then(url => { if (url) { el.src = url; el.removeAttribute('data-photo'); } });
  }
}
async function photoUrl(p) { return !p || p.startsWith('data:') ? p : (db.photoCached(p) || await gh.loadPhoto(p)); }

const catOptions = sel => cats().map(c => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('');
const subOptions = (cid, sel) => `<option value="">—</option>` + cat(cid).subs.map(s => `<option ${s === sel ? 'selected' : ''}>${esc(s)}</option>`).join('');
const invDatalist = () => `<datalist id="inv-names">${items().map(i => `<option value="${esc(i.name)}">`).join('')}</datalist>`;

function chipsRow(list, current, act, allLabel) {
  return `<div class="chips">
    <button class="chip ${!current ? 'on' : ''}" data-act="${act}" data-v="">${esc(allLabel)}</button>
    ${list.map(x => `<button class="chip ${current === x.v ? 'on' : ''}" data-act="${act}" data-v="${esc(x.v)}">${esc(x.label)}${x.n != null ? ` <small>${x.n}</small>` : ''}</button>`).join('')}
  </div>`;
}

// Category → subcategory filter UI shared by Stock and Grocery.
function catFilter(list, mode, cId, subId, prefix) {
  if (mode !== 'cat') return '';
  const used = cats().filter(c => list.some(x => x.category === c.id));
  let html = chipsRow(used.map(c => ({ v: c.id, label: `${c.icon} ${c.name}`, n: list.filter(x => x.category === c.id).length })), cId, `${prefix}Cat`, 'All categories');
  if (cId) {
    const inCat = list.filter(x => x.category === cId);
    const subs = cat(cId).subs.filter(s => inCat.some(x => x.sub === s));
    if (inCat.some(x => !x.sub || !cat(cId).subs.includes(x.sub))) subs.push('Unsorted');
    if (subs.length > 1 || (subs.length === 1 && subs[0] !== 'Unsorted'))
      html += chipsRow(subs.map(s => ({ v: s, label: s, n: inCat.filter(x => s === 'Unsorted' ? (!x.sub || !cat(cId).subs.includes(x.sub)) : x.sub === s).length })), subId, `${prefix}Sub`, `All ${cat(cId).name.toLowerCase()}`);
  }
  return html;
}

function applyCatFilter(list, cId, subId) {
  if (!cId) return list;
  list = list.filter(x => x.category === cId);
  if (subId === 'Unsorted') return list.filter(x => !x.sub || !cat(cId).subs.includes(x.sub));
  if (subId) return list.filter(x => x.sub === subId);
  return list;
}

function grouped(list, rowFn) {
  return cats().map(c => {
    const inC = list.filter(x => x.category === c.id);
    return inC.length ? `<h3 class="group-h">${c.icon} ${esc(c.name)}</h3>${inC.map(rowFn).join('')}` : '';
  }).join('') + (() => {
    const orphans = list.filter(x => !cats().some(c => c.id === x.category));
    return orphans.length ? `<h3 class="group-h">📦 Other</h3>${orphans.map(rowFn).join('')}` : '';
  })();
}

// ======================================================================
// VIEWS
// ======================================================================

// ---------------- Stock ----------------
function itemRow(it) {
  const c = cat(it.category);
  return `<div class="row item ${isLow(it) ? 'low' : ''} ${it.qty <= 0 ? 'out' : ''}" data-act="openItem" data-id="${it.id}">
    <button class="star ${it.starred ? 'on' : ''}" data-act="star" data-id="${it.id}" aria-label="Star">★</button>
    ${thumb(it.photo)}
    <div class="grow">
      <div class="name">${esc(it.name)}</div>
      <div class="meta">${c.icon} ${esc(it.sub || c.name)}${it.unit ? ' · ' + esc(it.unit) : ''}${isLow(it) ? ' · <b class="warn">running low</b>' : ''}</div>
    </div>
    <div class="stepper">
      <button data-act="dec" data-id="${it.id}" aria-label="Use one">−</button>
      <span class="q">${fmtQty(it.qty)}</span>
      <button data-act="inc" data-id="${it.id}" aria-label="Add one">+</button>
    </div>
  </div>`;
}

function viewStock() {
  let list = items();
  if (ui.starredOnly) list = list.filter(i => i.starred);
  const q = normalize(ui.stockSearch);
  if (q) list = list.filter(i => normalize(i.name).includes(q));
  const filterBar = catFilter(list, ui.stockMode, ui.stockCat, ui.stockSub, 'stock');
  const shown = ui.stockMode === 'cat' ? applyCatFilter(list, ui.stockCat, ui.stockSub) : list;
  const body = !db.list('items').length
    ? `<div class="empty"><p>No food in stock yet.</p><p>Add items one by one, or <a href="#/scan">scan a list</a> to add a whole haul at once.</p></div>`
    : !shown.length ? `<div class="empty"><p>Nothing matches.</p></div>`
    : ui.stockMode === 'cat' && !ui.stockCat ? grouped(shown, itemRow) : shown.map(itemRow).join('');
  return `
    <div class="toolbar">
      <input id="stock-search" type="search" placeholder="Search stock…" value="${esc(ui.stockSearch)}" data-input="stockSearch">
      <div class="toolbar-row">
        <div class="seg">
          <button class="${ui.stockMode === 'all' ? 'on' : ''}" data-act="stockMode" data-v="all">All</button>
          <button class="${ui.stockMode === 'cat' ? 'on' : ''}" data-act="stockMode" data-v="cat">By category</button>
        </div>
        <button class="chip ${ui.starredOnly ? 'on' : ''}" data-act="starredOnly">★ Starred</button>
      </div>
      ${filterBar}
    </div>
    <div class="list">${body}</div>
    <button class="fab" data-act="newItem">＋ Add item</button>`;
}

function itemSheet(it) {
  const isNew = !it;
  it = it || { id: uid(), name: '', qty: 1, unit: '', starred: false, category: ui.stockCat || 'other', sub: ui.stockSub && ui.stockSub !== 'Unsorted' ? ui.stockSub : '', photo: null, notes: '' };
  let photo = it.photo;
  const recipes = !isNew && !isPrepared(it) ? recipesUsing(it) : [];
  const recipesHtml = isNew || isPrepared(it) ? '' : `
    <h3 class="sec-h">Recipes with ${esc(it.name)}</h3>
    ${recipes.length ? recipes.map(r => {
      const st = recipeStatus(r);
      return `<div class="row recipe-mini" data-go="#/recipe/${r.id}">
        ${thumb(r.photo)}
        <div class="grow"><div class="name">${esc(r.title)}</div>
          <div class="meta">${st.canMake ? '<b class="ok">✓ You have everything</b>' : `<b class="warn">Missing:</b> ${esc(st.missing.map(m => m.ing.name).join(', '))}`}</div></div>
        ${st.canMake ? '' : `<button class="btn small" data-addmissing="${r.id}">🛒 Add missing</button>`}
      </div>`;
    }).join('') : `<p class="muted">No saved recipes use this yet. <a href="#/recipe-edit/new" data-close>Add one</a>.</p>`}`;

  openSheet(`
    <h2>${isNew ? 'Add item' : esc(it.name)}</h2>
    <div class="form">
      <div class="photo-pick">
        <div class="pp-img">${thumb(photo, 'big-thumb')}</div>
        <label class="btn small">📷 Photo<input type="file" accept="image/*" hidden data-f="photo"></label>
      </div>
      <label>Name<input data-f="name" value="${esc(it.name)}" placeholder="e.g. Ground beef" autocomplete="off"></label>
      <div class="two">
        <label>Category<select data-f="category">${catOptions(it.category)}</select></label>
        <label>Type<select data-f="sub">${subOptions(it.category, it.sub)}</select></label>
      </div>
      <div class="two">
        <label>Quantity<input data-f="qty" type="number" step="any" min="0" value="${fmtQty(it.qty)}"></label>
        <label>Unit (optional)<input data-f="unit" value="${esc(it.unit || '')}" placeholder="pack, lb, can…"></label>
      </div>
      <label class="check-line"><input type="checkbox" data-f="starred" ${it.starred ? 'checked' : ''}> ★ Starred — suggest for the grocery list when ${LOW} or fewer are left</label>
      <label class="check-line"><input type="checkbox" data-f="prepared" ${isPrepared(it) ? 'checked' : ''}> Prepared / ready-to-eat (no recipe suggestions)</label>
      <label>Notes<input data-f="notes" value="${esc(it.notes || '')}" placeholder="Where it's kept, brand…"></label>
    </div>
    <div class="row-end">
      ${isNew ? '' : `<button class="btn ghost danger" data-del>Delete</button><button class="btn ghost" data-tolist>🛒 Add to list</button>`}
      <button class="btn primary" data-save>Save</button>
    </div>
    ${recipesHtml}`, {
    onMount(s, close) {
      const f = k => s.querySelector(`[data-f="${k}"]`);
      f('category').onchange = () => { f('sub').innerHTML = subOptions(f('category').value, ''); };
      f('photo').onchange = async e => {
        if (!e.target.files[0]) return;
        photo = await compressImage(e.target.files[0], 600);
        s.querySelector('.pp-img').innerHTML = thumb(photo, 'big-thumb');
      };
      if (isNew) {
        f('name').focus();
        f('name').addEventListener('change', () => {
          if (f('category').value !== 'other') return;
          const g = guessCategory(f('name').value);
          f('category').value = g.category;
          f('sub').innerHTML = subOptions(g.category, g.sub);
          f('prepared').checked = !!cat(g.category).prepared;
        });
      }
      s.querySelector('[data-save]').onclick = async () => {
        const name = f('name').value.trim();
        if (!name) return f('name').focus();
        const category = f('category').value;
        const prepared = f('prepared').checked;
        await setQty({
          ...it, name, category, sub: f('sub').value, unit: f('unit').value.trim(), notes: f('notes').value.trim(),
          starred: f('starred').checked, photo,
          prepared: prepared === !!cat(category).prepared ? undefined : prepared
        }, parseFloat(f('qty').value) || 0);
        close();
        toast(isNew ? `Added ${name}` : `Saved ${name}`);
      };
      s.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmSheet('Delete item?', `<p>Remove <b>${esc(it.name)}</b> from stock?</p>`, 'Delete')) {
          await db.remove('items', it.id); close();
        }
      });
      s.querySelector('[data-tolist]')?.addEventListener('click', async () => {
        if (groceryFor(it)) return toast(`${it.name} is already on the list`);
        await addToGrocery({ name: it.name, itemId: it.id }); toast(`Added ${it.name} to the grocery list`);
      });
      s.addEventListener('click', async e => {
        const am = e.target.closest('[data-addmissing]');
        if (am) { e.stopPropagation(); await addMissing(db.get('recipes', am.dataset.addmissing)); return; }
        const go = e.target.closest('[data-go]');
        if (go) { close(); location.hash = go.dataset.go; }
        if (e.target.closest('[data-close]')) close();
      });
    }
  });
}

// ---------------- Scan list ----------------
function viewScan() {
  const sc = ui.scan;
  const engine = S.apiKey ? 'Claude (good with handwriting)' : 'built-in text reader (best with neat, printed lists)';
  if (sc.stage === 'pick') return `
    <div class="card">
      <h2>Update stock from a list</h2>
      <p class="muted">Take a photo of your list — one item per line, with a quantity if you like (“3 ground beef”, “milk x2”, “eggs - 12”). You'll check everything before stock changes.</p>
      <div class="big-actions">
        <label class="btn primary big">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden data-change="scanFile"></label>
        <label class="btn big">🖼 Choose photo<input type="file" accept="image/*" hidden data-change="scanFile"></label>
      </div>
      <p class="small muted">Reading with: ${engine}. ${S.apiKey ? '' : '<a href="#/settings">Add a Claude API key</a> for handwriting.'}</p>
    </div>
    <div class="card">
      <h3>Or type / paste a list</h3>
      <textarea id="scan-text" rows="5" placeholder="2 ground beef&#10;milk x2&#10;bananas"></textarea>
      <div class="row-end"><button class="btn" data-act="scanText">Read list</button></div>
    </div>`;
  if (sc.stage === 'reading') return `
    <div class="card center">
      ${sc.photo ? `<img class="scan-photo" src="${sc.photo}" alt="">` : ''}
      <p class="reading">Reading your list… ${sc.progress ? sc.progress + '%' : ''}</p>
      <div class="bar"><span style="width:${sc.progress || 5}%"></span></div>
    </div>`;
  // review
  const all = items();
  const rows = sc.rows.map((r, i) => {
    const cur = r.match === 'new' ? null : db.get('items', r.match);
    const after = !cur ? r.qty : sc.mode === 'add' ? cur.qty + r.qty : sc.mode === 'use' ? Math.max(0, cur.qty - r.qty) : r.qty;
    return `<div class="scan-row ${r.skip ? 'skipped' : ''}">
      <label class="check"><input type="checkbox" data-scan="skip" data-i="${i}" ${r.skip ? '' : 'checked'}><span></span></label>
      <div class="grow">
        <div class="two tight">
          <input data-scan="name" data-i="${i}" value="${esc(r.name)}" list="inv-names" aria-label="Name">
          <input data-scan="qty" data-i="${i}" type="number" step="any" min="0" value="${fmtQty(r.qty)}" aria-label="Quantity" class="qty-in">
        </div>
        <div class="two tight">
          <select data-scan="match" data-i="${i}" aria-label="Matches">
            <option value="new" ${r.match === 'new' ? 'selected' : ''}>➕ New item</option>
            ${all.map(it => `<option value="${it.id}" ${r.match === it.id ? 'selected' : ''}>${esc(it.name)} (${fmtQty(it.qty)})</option>`).join('')}
          </select>
          ${r.match === 'new' ? `<select data-scan="category" data-i="${i}">${catOptions(r.category)}</select>` : `<span class="after">→ <b>${fmtQty(after)}</b></span>`}
        </div>
        <div class="raw">“${esc(r.raw)}”</div>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="scan-head">
        ${sc.photo ? `<img class="scan-thumb" src="${sc.photo}" alt="" data-act="viewScanPhoto">` : ''}
        <div><h2>Check the list</h2><p class="muted small">${sc.rows.length} line${sc.rows.length === 1 ? '' : 's'} found. Fix anything that was misread, then apply.</p></div>
      </div>
      <div class="seg full">
        <button class="${sc.mode === 'add' ? 'on' : ''}" data-act="scanMode" data-v="add">Add to stock</button>
        <button class="${sc.mode === 'set' ? 'on' : ''}" data-act="scanMode" data-v="set">Set counts</button>
        <button class="${sc.mode === 'use' ? 'on' : ''}" data-act="scanMode" data-v="use">Used up</button>
      </div>
      <div class="scan-rows">${rows || '<p class="muted">No items found — try a clearer photo, or type the list.</p>'}</div>
      <button class="btn ghost small" data-act="scanAddRow">＋ Add a line</button>
      <div class="row-end">
        <button class="btn ghost" data-act="scanReset">Start over</button>
        <button class="btn primary" data-act="scanApply">Apply ${sc.rows.filter(r => !r.skip).length} items</button>
      </div>
    </div>
    ${invDatalist()}`;
}

function scanRowsFrom(parsed) {
  return parsed.map(p => {
    const m = bestMatch(p.name, db.list('items'), 0.6);
    const g = guessCategory(p.name);
    return { ...p, match: m ? m.id : 'new', category: g.category, sub: g.sub, skip: false };
  });
}

async function runScan(file) {
  const photo = await compressImage(file, 1600, 0.85);
  ui.scan = { stage: 'reading', photo, progress: 0, mode: 'add' };
  render();
  try {
    const parsed = S.apiKey
      ? await readWithClaude(photo, { apiKey: S.apiKey, model: S.model, knownNames: items().map(i => i.name) })
      : await readWithTesseract(photo, p => { ui.scan.progress = p; if (route().name === 'scan') render(); });
    ui.scan = { stage: 'review', photo: await compressImage(file, 500), rows: scanRowsFrom(parsed), mode: 'add' };
  } catch (err) {
    console.error(err);
    toast('Could not read the photo: ' + err.message, [], 8000);
    ui.scan = { stage: 'pick' };
  }
  render();
}

async function applyScan() {
  const sc = ui.scan;
  let added = 0, updated = 0;
  for (const r of sc.rows) {
    if (r.skip || !r.name.trim()) continue;
    const cur = r.match !== 'new' && db.get('items', r.match);
    if (cur) {
      const q = sc.mode === 'add' ? cur.qty + r.qty : sc.mode === 'use' ? cur.qty - r.qty : r.qty;
      await setQty(cur, q); updated++;
    } else {
      if (sc.mode === 'use') continue;
      await db.put('items', { id: uid(), name: r.name.trim(), qty: r.qty, unit: r.unit || '', category: r.category, sub: r.sub || '', starred: false, photo: null });
      added++;
    }
  }
  ui.scan = { stage: 'pick' };
  toast(`Stock updated: ${updated} changed, ${added} new`);
  location.hash = '#/stock';
}

// ---------------- Grocery ----------------
function groceryRow(g) {
  const c = cat(g.category);
  return `<div class="row g ${g.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-change="toggleDone" data-id="${g.id}" ${g.done ? 'checked' : ''}><span></span></label>
    ${g.photo ? thumb(g.photo, 'thumb', 'viewPhoto') : ''}
    <div class="grow" data-act="editGrocery" data-id="${g.id}">
      <div class="name">${esc(g.name)}${g.qty > 1 ? ` <span class="x">×${fmtQty(g.qty)}</span>` : ''}</div>
      <div class="meta">${c.icon} ${esc(g.sub || c.name)} · ${g.done ? `got by ${esc(g.doneBy || '?')} ${fmtWhen(g.doneAt)}` : `${esc(g.addedBy || '?')}, ${fmtWhen(g.addedAt)}`}${g.note ? ` · <i>${esc(g.note)}</i>` : ''}</div>
    </div>
  </div>`;
}

function suggestionRow(it) {
  return `<div class="row g ghost-row">
    <span class="ghost-dot">★</span>
    ${it.photo ? thumb(it.photo) : ''}
    <div class="grow">
      <div class="name">${esc(it.name)}</div>
      <div class="meta">Only ${fmtQty(it.qty)} left${it.unit ? ' ' + esc(it.unit) : ''}</div>
    </div>
    <button class="btn small" data-act="confirmSuggest" data-id="${it.id}">Add</button>
    <button class="btn small ghost" data-act="dismissSuggest" data-id="${it.id}" aria-label="Not now">✕</button>
  </div>`;
}

function viewGrocery() {
  const d = ui.gDraft;
  const active = activeGrocery().sort((a, b) => b.addedAt - a.addedAt);
  const done = db.list('grocery').filter(g => g.done).sort((a, b) => b.doneAt - a.doneAt);
  let sug = suggestions();
  const filterBar = catFilter([...active, ...sug], ui.gMode, ui.gCat, ui.gSub, 'g');
  const shown = ui.gMode === 'cat' ? applyCatFilter(active, ui.gCat, ui.gSub) : active;
  if (ui.gMode === 'cat') sug = applyCatFilter(sug, ui.gCat, ui.gSub);
  const listHtml = !shown.length ? (active.length ? '<div class="empty"><p>Nothing in this category.</p></div>' : '<div class="empty"><p>The list is empty. 🎉</p></div>')
    : ui.gMode === 'cat' && !ui.gCat ? grouped(shown, groceryRow) : shown.map(groceryRow).join('');
  return `
    <form class="card add-card" data-submit="addGrocery">
      <div class="add-row">
        <input id="g-name" placeholder="What do we need?" list="inv-names" value="${esc(d.name)}" data-input="gName" autocomplete="off">
        <input id="g-qty" type="number" min="1" step="any" value="${fmtQty(d.qty)}" data-input="gQty" class="qty-in" aria-label="Quantity">
        <label class="btn cam" aria-label="Add photo">📷<input type="file" accept="image/*" hidden data-change="gPhoto"></label>
        <button class="btn primary" type="submit">Add</button>
      </div>
      ${d.photo ? `<div class="draft-photo"><img src="${d.photo}" alt=""><button type="button" class="btn small ghost" data-act="gPhotoClear">Remove photo</button></div>` : ''}
      <details ${d.open ? 'open' : ''} data-toggle="gOpen"><summary>Category &amp; note</summary>
        <div class="two">
          <select id="g-cat" data-change="gCat"><option value="">Auto</option>${catOptions(d.category)}</select>
          <select id="g-sub" data-change="gSub">${d.category ? subOptions(d.category, d.sub) : '<option value="">—</option>'}</select>
        </div>
        <input id="g-note" placeholder="Note (brand, size…)" value="${esc(d.note)}" data-input="gNote">
      </details>
    </form>
    ${invDatalist()}
    <div class="toolbar">
      <div class="seg">
        <button class="${ui.gMode === 'all' ? 'on' : ''}" data-act="gMode" data-v="all">All</button>
        <button class="${ui.gMode === 'cat' ? 'on' : ''}" data-act="gMode" data-v="cat">By category</button>
      </div>
      ${filterBar}
    </div>
    ${sug.length ? `<h3 class="group-h ghost-h">Running low — add to the list?</h3>${sug.map(suggestionRow).join('')}` : ''}
    <div class="list">${listHtml}</div>
    ${done.length ? `
      <div class="done-head">
        <button class="linkish" data-act="toggleShowDone">${ui.showDone ? '▾' : '▸'} Picked up (${done.length})</button>
        <button class="btn small ghost" data-act="clearDone">Clear picked up</button>
      </div>
      ${ui.showDone ? `<div class="list">${done.map(groceryRow).join('')}</div>` : ''}` : ''}`;
}

async function toggleDone(g, checked) {
  if (checked) {
    await db.put('grocery', { ...g, done: true, doneBy: me(), doneAt: Date.now() });
    const it = (g.itemId && db.get('items', g.itemId)) || findItem(g.name);
    if (it) {
      const before = it.qty;
      const saved = await setQty(it, it.qty + (g.qty || 1));
      toast(`Picked up ${g.name} — stock now ${fmtQty(saved.qty)}`, [{
        label: 'Undo', run: async () => {
          await setQty(db.get('items', it.id), before);
          await db.put('grocery', { ...db.get('grocery', g.id), done: false, doneBy: null, doneAt: null });
        }
      }]);
    } else {
      toast(`Picked up ${g.name}`, [{
        label: 'Add to stock', run: async () => {
          const id = uid();
          await db.put('items', { id, name: g.name, qty: g.qty || 1, unit: '', category: g.category, sub: g.sub || '', starred: false, photo: g.photo || null });
          await db.put('grocery', { ...db.get('grocery', g.id), itemId: id });
        }
      }], 7000);
    }
  } else {
    await db.put('grocery', { ...g, done: false, doneBy: null, doneAt: null });
  }
}

function grocerySheet(g) {
  let photo = g.photo;
  openSheet(`
    <h2>Edit list item</h2>
    <div class="form">
      <div class="photo-pick">
        <div class="pp-img">${photo ? pimg(photo, 'class="big-thumb"') : '<span class="big-thumb ph"></span>'}</div>
        <label class="btn small">📷 Photo<input type="file" accept="image/*" hidden data-f="photo"></label>
      </div>
      <label>Name<input data-f="name" value="${esc(g.name)}"></label>
      <div class="two">
        <label>Category<select data-f="category">${catOptions(g.category)}</select></label>
        <label>Type<select data-f="sub">${subOptions(g.category, g.sub)}</select></label>
      </div>
      <div class="two">
        <label>Quantity<input data-f="qty" type="number" min="1" step="any" value="${fmtQty(g.qty)}"></label>
        <label>Note<input data-f="note" value="${esc(g.note || '')}"></label>
      </div>
      <p class="small muted">Added by ${esc(g.addedBy || '?')} · ${fmtWhen(g.addedAt)}</p>
    </div>
    <div class="row-end"><button class="btn ghost danger" data-del>Remove</button><button class="btn primary" data-save>Save</button></div>`, {
    onMount(s, close) {
      const f = k => s.querySelector(`[data-f="${k}"]`);
      f('category').onchange = () => { f('sub').innerHTML = subOptions(f('category').value, ''); };
      f('photo').onchange = async e => {
        if (!e.target.files[0]) return;
        photo = await compressImage(e.target.files[0], 900);
        s.querySelector('.pp-img').innerHTML = `<img class="big-thumb" src="${photo}" alt="">`;
      };
      s.querySelector('[data-save]').onclick = async () => {
        await db.put('grocery', { ...g, name: f('name').value.trim() || g.name, category: f('category').value, sub: f('sub').value, qty: parseFloat(f('qty').value) || 1, note: f('note').value.trim(), photo });
        close();
      };
      s.querySelector('[data-del]').onclick = async () => { await db.remove('grocery', g.id); close(); };
    }
  });
}

async function addMissing(r) {
  if (!r) return;
  const { missing } = recipeStatus(r);
  let n = 0;
  for (const m of missing) {
    const it = m.item;
    if (it ? groceryFor(it) : activeGrocery().some(g => normalize(g.name) === normalize(m.ing.name))) continue;
    const short = it ? Math.max(1, Math.ceil(m.need - it.qty)) : Math.ceil(m.need);
    await addToGrocery({ name: it ? it.name : m.ing.name, qty: short, itemId: it?.id, note: `for ${r.title}` });
    n++;
  }
  toast(n ? `Added ${n} item${n > 1 ? 's' : ''} to the grocery list` : 'Everything missing is already on the list');
}

// ---------------- Recipes ----------------
function viewRecipes() {
  let list = db.list('recipes').sort((a, b) => a.title.localeCompare(b.title));
  const q = normalize(ui.recipeSearch);
  if (q) list = list.filter(r => normalize(r.title).includes(q) || (r.ingredients || []).some(i => normalize(i.name).includes(q)));
  const withStatus = list.map(r => ({ r, st: recipeStatus(r) }));
  const shown = ui.canMakeOnly ? withStatus.filter(x => x.st.canMake) : withStatus;
  return `
    <div class="toolbar">
      <input id="recipe-search" type="search" placeholder="Search recipes or ingredients…" value="${esc(ui.recipeSearch)}" data-input="recipeSearch">
      <div class="toolbar-row"><button class="chip ${ui.canMakeOnly ? 'on' : ''}" data-act="canMakeOnly">✓ Can make now</button></div>
    </div>
    ${!db.list('recipes').length ? `<div class="empty"><p>No recipes yet.</p><p>Add your first one — photo, ingredients, steps and notes.</p></div>` : ''}
    <div class="cards">
      ${shown.map(({ r, st }) => `
        <a class="rcard" href="#/recipe/${r.id}">
          ${r.photo ? pimg(r.photo) : '<span class="rph">🍽</span>'}
          <div class="rbody">
            <div class="name">${esc(r.title)}</div>
            <span class="pill ${st.canMake ? 'ok' : 'warn'}">${st.canMake ? '✓ Ready to make' : `Missing ${st.missing.length}`}</span>
          </div>
        </a>`).join('')}
    </div>
    <a class="fab" href="#/recipe-edit/new">＋ New recipe</a>`;
}

function viewRecipe(id) {
  const r = db.get('recipes', id);
  if (!r) return `<div class="empty"><p>Recipe not found.</p><a href="#/recipes">Back to recipes</a></div>`;
  const st = recipeStatus(r);
  const notes = [...(r.notes || [])].sort((a, b) => b.at - a.at);
  return `
    <a class="back" href="#/recipes">‹ Recipes</a>
    <div class="recipe">
      ${r.photo ? pimg(r.photo, 'class="hero" data-act="viewPhoto"') : ''}
      <h2 class="rtitle">${esc(r.title)}</h2>
      <p class="meta">${[r.servings && `Serves ${esc(r.servings)}`, r.time && `⏱ ${esc(r.time)}`, r.madeCount && `Made ${r.madeCount}×, last ${fmtWhen(r.lastMade)}`].filter(Boolean).join(' · ')}</p>
      <div class="actions">
        <button class="btn primary" data-act="makeRecipe" data-id="${r.id}">✓ Made it</button>
        ${st.canMake ? '' : `<button class="btn" data-act="addMissing" data-id="${r.id}">🛒 Add missing (${st.missing.length})</button>`}
        <button class="btn" data-act="printRecipe" data-id="${r.id}">🖨 Print</button>
        <a class="btn ghost" href="#/recipe-edit/${r.id}">✎ Edit</a>
      </div>
      <div class="status-banner ${st.canMake ? 'ok' : 'warn'}">${st.canMake ? '✓ You have everything to make this.' : `You're missing ${st.missing.length}: ${esc(st.missing.map(m => m.ing.name).join(', '))}`}</div>
      <h3 class="sec-h">Ingredients</h3>
      <ul class="ings">
        ${st.rows.map(({ ing, item, need, ok }) => `<li class="${ing.optional ? 'opt' : ok ? 'ok' : 'miss'}">
          <span class="dot"></span>
          <span class="grow"><b>${esc(ing.amount || '')}</b> ${esc(ing.name)}</span>
          <span class="have">${ing.optional ? 'not tracked' : item ? `have ${fmtQty(item.qty)}${need !== 1 ? ` / need ${fmtQty(need)}` : ''}` : 'not in stock'}</span>
        </li>`).join('')}
      </ul>
      <h3 class="sec-h">Steps</h3>
      <ol class="steps">${(r.steps || []).filter(s => s.trim()).map(s => `<li>${esc(s)}</li>`).join('')}</ol>
      <h3 class="sec-h">Notes &amp; feedback</h3>
      <form class="note-add" data-submit="addNote" data-id="${r.id}">
        <textarea id="note-text" rows="2" placeholder="How did it go? Tweaks for next time…"></textarea>
        <button class="btn primary" type="submit">Add note</button>
      </form>
      <div class="notes">
        ${notes.map(n => `<div class="note">
          <div class="note-meta"><b>${esc(n.by || '?')}</b> · ${fmtWhen(n.at)}${n.kind === 'made' ? ' · <span class="pill ok">made it</span>' : ''}
            <button class="linkish small" data-act="delNote" data-id="${r.id}" data-note="${n.id}" aria-label="Delete note">✕</button></div>
          <div>${esc(n.text).replace(/\n/g, '<br>')}</div>
        </div>`).join('') || '<p class="muted">No notes yet.</p>'}
      </div>
    </div>`;
}

function makeRecipeSheet(r) {
  const st = recipeStatus(r);
  const tracked = st.rows.filter(x => !x.ing.optional && x.item);
  openSheet(`
    <h2>Made ${esc(r.title)}?</h2>
    <p class="muted">These will be taken out of stock:</p>
    <div class="deduct">
      ${tracked.map((x, i) => `<label class="check-line"><input type="checkbox" data-i="${i}" checked>
        ${esc(x.item.name)}: ${fmtQty(x.item.qty)} → <b>${fmtQty(Math.max(0, x.item.qty - x.need))}</b></label>`).join('') || '<p class="muted">No tracked ingredients are in stock.</p>'}
    </div>
    ${st.missing.length ? `<p class="small warn">Not in stock: ${esc(st.missing.map(m => m.ing.name).join(', '))}</p>` : ''}
    <label>How did it turn out? (optional)<textarea data-note rows="2"></textarea></label>
    <div class="row-end"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-ok>Update stock</button></div>`, {
    onMount(s, close) {
      s.querySelector('[data-cancel]').onclick = close;
      s.querySelector('[data-ok]').onclick = async () => {
        const undo = [];
        for (const box of s.querySelectorAll('.deduct input:checked')) {
          const x = tracked[+box.dataset.i];
          const it = db.get('items', x.item.id);
          undo.push([it.id, it.qty]);
          await setQty(it, it.qty - x.need);
        }
        const text = s.querySelector('[data-note]').value.trim();
        const fresh = db.get('recipes', r.id);
        await db.put('recipes', {
          ...fresh, madeCount: (fresh.madeCount || 0) + 1, lastMade: Date.now(),
          notes: [...(fresh.notes || []), { id: uid(), at: Date.now(), by: me(), kind: 'made', text: text || 'Made it.' }]
        });
        close();
        toast('Stock updated', [{ label: 'Undo', run: async () => { for (const [id, q] of undo) await setQty(db.get('items', id), q); } }]);
      };
    }
  });
}

// ---------------- Recipe editor ----------------
function blankRecipe() {
  return { id: uid(), title: '', photo: null, servings: '', time: '', ingredients: [{ amount: '', name: '', uses: 1, optional: false }], steps: [''], notes: [], createdAt: Date.now() };
}

function viewRecipeEdit(id) {
  if (!ui.recipeDraft || ui.recipeDraft._for !== id) {
    const src = id === 'new' ? blankRecipe() : db.get('recipes', id);
    if (!src) return `<div class="empty"><p>Recipe not found.</p></div>`;
    ui.recipeDraft = { ...structuredClone(src), _for: id };
  }
  const r = ui.recipeDraft;
  return `
    <a class="back" href="${id === 'new' ? '#/recipes' : '#/recipe/' + id}" data-act="cancelEdit">‹ Cancel</a>
    <div class="card form">
      <h2>${id === 'new' ? 'New recipe' : 'Edit recipe'}</h2>
      <div class="photo-pick">
        <div class="pp-img">${r.photo ? pimg(r.photo, 'class="big-thumb"') : '<span class="big-thumb ph">🍽</span>'}</div>
        <label class="btn small">📷 Dish photo<input type="file" accept="image/*" hidden data-change="recipePhoto"></label>
        ${r.photo ? '<button class="btn small ghost" data-act="recipePhotoClear">Remove</button>' : ''}
      </div>
      <label>Title<input data-rd="title" value="${esc(r.title)}" placeholder="e.g. Weeknight tacos"></label>
      <div class="two">
        <label>Serves<input data-rd="servings" value="${esc(r.servings)}" placeholder="4"></label>
        <label>Time<input data-rd="time" value="${esc(r.time)}" placeholder="30 min"></label>
      </div>
      <h3 class="sec-h">Ingredients</h3>
      <p class="small muted">“Uses” is how many of the stock item one batch uses up (e.g. 1 pack of ground beef). Tick “staple” for things you don't track, like salt.</p>
      <div class="ing-edit">
        ${r.ingredients.map((g, i) => {
          const m = g.name ? resolveIng(g) : null;
          return `<div class="ing-row">
          <input data-ri="amount" data-i="${i}" value="${esc(g.amount)}" placeholder="1 lb" class="amt">
          <input data-ri="name" data-i="${i}" value="${esc(g.name)}" placeholder="Ingredient" list="inv-names" class="nm">
          <input data-ri="uses" data-i="${i}" type="number" min="0" step="any" value="${fmtQty(g.uses ?? 1)}" class="qty-in" aria-label="Uses from stock" title="Uses from stock">
          <label class="mini"><input type="checkbox" data-ri="optional" data-i="${i}" ${g.optional ? 'checked' : ''}>staple</label>
          <button class="icon-btn" data-act="ingDel" data-i="${i}" aria-label="Remove">✕</button>
          ${g.name && !g.optional ? `<div class="link-hint">${m ? `↳ stock: ${esc(m.name)}` : '↳ not in stock yet'}</div>` : ''}
        </div>`; }).join('')}
      </div>
      <button class="btn small ghost" data-act="ingAdd">＋ Ingredient</button>
      <h3 class="sec-h">Steps</h3>
      <div class="step-edit">
        ${r.steps.map((s, i) => `<div class="step-row">
          <span class="num">${i + 1}</span>
          <textarea data-rs="${i}" rows="2" placeholder="Describe this step">${esc(s)}</textarea>
          <div class="step-btns">
            <button class="icon-btn" data-act="stepUp" data-i="${i}" aria-label="Move up">↑</button>
            <button class="icon-btn" data-act="stepDel" data-i="${i}" aria-label="Remove">✕</button>
          </div>
        </div>`).join('')}
      </div>
      <button class="btn small ghost" data-act="stepAdd">＋ Step</button>
      <div class="row-end">
        ${id === 'new' ? '' : '<button class="btn ghost danger" data-act="recipeDelete">Delete recipe</button>'}
        <button class="btn primary" data-act="recipeSave">Save recipe</button>
      </div>
    </div>
    ${invDatalist()}`;
}

async function saveRecipe() {
  const r = ui.recipeDraft;
  if (!r.title.trim()) { toast('Give the recipe a title'); $('[data-rd="title"]')?.focus(); return; }
  const { _for, ...doc } = r;
  doc.title = doc.title.trim();
  doc.ingredients = doc.ingredients.filter(g => g.name.trim()).map(g => ({
    ...g, name: g.name.trim(), uses: g.uses === '' || g.uses == null ? 1 : +g.uses,
    itemId: findItem(g.name)?.id || null
  }));
  doc.steps = doc.steps.map(s => s.trim()).filter(Boolean);
  await db.put('recipes', doc);
  ui.recipeDraft = null;
  location.hash = `#/recipe/${doc.id}`;
}

// ---------------- Print (A4, one page) ----------------
function printSheet(r) {
  openSheet(`<h2>Print ${esc(r.title)}</h2>
    <label class="check-line"><input type="checkbox" data-notes ${r.notes?.length ? 'checked' : 'disabled'}> Include notes &amp; feedback</label>
    <p class="small muted">Formatted for one A4 page. In the print dialog choose paper size A4 and scale “Default/100%”.</p>
    <div class="row-end"><button class="btn primary" data-go>🖨 Print</button></div>`, {
    onMount(s, close) {
      s.querySelector('[data-go]').onclick = () => { const n = s.querySelector('[data-notes]').checked; close(); printRecipe(r, n); };
    }
  });
}

async function printRecipe(r, includeNotes) {
  const root = $('#print-root');
  const photo = await photoUrl(r.photo);
  const notes = includeNotes ? [...(r.notes || [])].sort((a, b) => b.at - a.at) : [];
  root.innerHTML = `<div class="pr-page">
    <div class="pr-head">
      ${photo ? `<img class="pr-thumb" src="${photo}" alt="">` : ''}
      <div><h1>${esc(r.title)}</h1>
        <div class="pr-meta">${[r.servings && `Serves ${esc(r.servings)}`, r.time && `Time: ${esc(r.time)}`].filter(Boolean).join('   ·   ')}</div></div>
    </div>
    <div class="pr-cols">
      <section class="pr-ing"><h2>Ingredients</h2><ul>${(r.ingredients || []).map(g => `<li><b>${esc(g.amount || '')}</b> ${esc(g.name)}</li>`).join('')}</ul></section>
      <section class="pr-steps"><h2>Method</h2><ol>${(r.steps || []).map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>
    </div>
    ${notes.length ? `<section class="pr-notes"><h2>Notes</h2>${notes.map(n => `<p><b>${esc(new Date(n.at).toLocaleDateString())} — ${esc(n.by || '')}:</b> ${esc(n.text)}</p>`).join('')}</section>` : ''}
  </div>`;
  const go = () => {
    // Shrink the text until everything fits on one A4 page (273mm usable height with 12mm margins).
    root.classList.add('measuring');
    const page = root.querySelector('.pr-page');
    const maxPx = 268 * 96 / 25.4;
    let pt = 11.5;
    page.style.fontSize = pt + 'pt';
    while (page.scrollHeight > maxPx && pt > 7) { pt -= 0.25; page.style.fontSize = pt + 'pt'; }
    root.classList.remove('measuring');
    window.print();
  };
  const img = root.querySelector('img');
  if (img && !img.complete) img.onload = img.onerror = go; else go();
}

// ---------------- Settings ----------------
function viewSettings() {
  const sync = gh.getStatus();
  const c = catDraft || cats();
  return `
    <div class="card form">
      <h2>You</h2>
      <label>Your name (shown on list items and notes)<input data-set="name" value="${esc(S.name || '')}" placeholder="e.g. Miko"></label>
    </div>
    <div class="card form">
      <h2>Share the list (GitHub)</h2>
      <p class="small muted">Saves stock, the grocery list and recipes to your GitHub repo so everyone in the house sees the same thing. Each phone needs the repo name and an access token once (see the README). The token is stored only on this phone.</p>
      <label>Repository (owner/repo)<input data-set="ghRepo" value="${esc(S.ghRepo || gh.guessRepo())}" placeholder="your-name/pantry-pwa" autocomplete="off"></label>
      <label>Access token<input data-set="ghToken" type="password" value="${esc(S.ghToken || '')}" placeholder="github_pat_…" autocomplete="off"></label>
      <p class="small">Status: <b class="sync-${sync.status}">${SYNC_LABEL[sync.status]}</b> ${sync.error ? `<span class="warn">${esc(sync.error)}</span>` : ''}</p>
      <div class="row-end">
        ${sync.connected ? '<button class="btn ghost" data-act="disconnectSync">Stop sharing on this phone</button>' : ''}
        <button class="btn primary" data-act="connectSync">Save &amp; connect</button>
      </div>
    </div>
    <div class="card form">
      <h2>Reading handwritten lists</h2>
      <p class="small muted">Optional. With an Anthropic API key, photos are read by Claude, which handles handwriting well. The key is stored only on this device. Without it, a free built-in reader is used (works best on neat, printed text).</p>
      <label>Anthropic API key<input data-set="apiKey" type="password" value="${esc(S.apiKey || '')}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label>Model<input data-set="model" value="${esc(S.model || '')}" placeholder="claude-sonnet-5-5"></label>
    </div>
    <div class="card form">
      <h2>Categories</h2>
      <p class="small muted">One category per box. Types are comma separated. Changes are shared with the household.</p>
      <div class="cat-edit">
        ${c.map((x, i) => `<div class="cat-row">
          <div class="two tight"><input data-ci="icon" data-i="${i}" value="${esc(x.icon)}" class="icon-in" aria-label="Icon"><input data-ci="name" data-i="${i}" value="${esc(x.name)}" aria-label="Category name"></div>
          <textarea data-ci="subs" data-i="${i}" rows="2" aria-label="Types">${esc(x.subs.join(', '))}</textarea>
          <label class="mini"><input type="checkbox" data-ci="prepared" data-i="${i}" ${x.prepared ? 'checked' : ''}> prepared food</label>
        </div>`).join('')}
      </div>
      <div class="row-end">
        <button class="btn ghost small" data-act="catReset">Reset to defaults</button>
        <button class="btn ghost small" data-act="catAdd">＋ Category</button>
        <button class="btn primary" data-act="catSave">Save categories</button>
      </div>
    </div>
    <div class="card form">
      <h2>Backup</h2>
      <div class="row-end" style="justify-content:flex-start">
        <button class="btn" data-act="exportData">⬇ Export backup</button>
        <label class="btn">⬆ Import backup<input type="file" accept="application/json" hidden data-change="importData"></label>
      </div>
      <p class="small muted">Install: in Safari use Share → Add to Home Screen; in Chrome use ⋮ → Install app.</p>
    </div>`;
}

let catDraft = null;
function updateCatDraft(el) {
  catDraft = catDraft || structuredClone(cats());
  const c = catDraft[+el.dataset.i]; if (!c) return;
  const k = el.dataset.ci;
  if (k === 'subs') c.subs = el.value.split(',').map(s => s.trim()).filter(Boolean);
  else if (k === 'prepared') c.prepared = el.checked;
  else c[k] = el.value.trim();
}
// ======================================================================
// ROUTER + RENDER
// ======================================================================
function route() {
  const [name = 'stock', arg] = location.hash.replace(/^#\/?/, '').split('/');
  return { name: name || 'stock', arg };
}

const SYNC_LABEL = { local: 'This phone only', syncing: 'Saving / loading…', online: 'Up to date ✓', pending: 'Changes waiting to save', error: 'Problem' };
function renderSync() {
  const st = gh.getStatus();
  const dot = $('#sync-dot');
  dot.className = 'sync-dot ' + st.status;
  dot.title = SYNC_LABEL[st.status] + (st.error ? ': ' + st.error : '');
  $('#refresh-banner').hidden = !st.remoteChanged;
}

// A selector that finds "the same" input again after the view is re-drawn.
function focusKey(el) {
  if (el.id) return '#' + CSS.escape(el.id);
  for (const a of ['data-rd', 'data-ri', 'data-rs', 'data-set', 'data-ci', 'data-scan', 'data-input']) {
    if (el.hasAttribute(a)) return `[${a}="${CSS.escape(el.getAttribute(a))}"]` + (el.dataset.i != null ? `[data-i="${el.dataset.i}"]` : '');
  }
  return null;
}

const TITLES = { stock: 'Stock', scan: 'Scan a list', grocery: 'Grocery list', recipes: 'Recipes', recipe: 'Recipe', 'recipe-edit': 'Recipe', settings: 'Settings' };

function render() {
  const view = $('#view');
  const { name, arg } = route();
  // keep focus/caret when re-rendering under the user's fingers
  const ae = document.activeElement;
  const key = ae && view.contains(ae) && focusKey(ae);
  const keep = key ? { key, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const scrollY = window.scrollY;

  if (name !== 'recipe-edit') ui.recipeDraft = null;
  if (name !== 'settings') catDraft = null;
  const html = {
    stock: viewStock, scan: viewScan, grocery: viewGrocery, recipes: viewRecipes,
    recipe: () => viewRecipe(arg), 'recipe-edit': () => viewRecipeEdit(arg), settings: viewSettings
  }[name]?.() ?? viewStock();
  view.innerHTML = html;
  view.dataset.route = name;
  $('#title').textContent = TITLES[name] || 'Pantry';
  const tab = { recipe: 'recipes', 'recipe-edit': 'recipes' }[name] || name;
  $$('.tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));

  const n = activeGrocery().length + suggestions().length;
  const badge = $('#grocery-badge');
  badge.hidden = !n; badge.textContent = n;
  renderSync();

  if (keep) {
    const el = view.querySelector(keep.key);
    if (el) { el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch { } }
  }
  if (render.lastRoute === location.hash) window.scrollTo(0, scrollY); else window.scrollTo(0, 0);
  render.lastRoute = location.hash;
}

// Re-draw, but never in the middle of a tap (a redraw between touch-down and
// click would replace the button being tapped and swallow the tap).
let pointerDown = false, pendingRender = false;
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
document.addEventListener('pointerup', () => setTimeout(() => {
  pointerDown = false;
  if (pendingRender) { pendingRender = false; render(); }
}, 0), true);
function softRender() { if (pointerDown) pendingRender = true; else render(); }

// ---------------- click actions ----------------
const A = {
  // stock
  stockMode: b => { ui.stockMode = b.dataset.v; ui.stockCat = ui.stockSub = null; render(); },
  stockCat: b => { ui.stockCat = b.dataset.v || null; ui.stockSub = null; render(); },
  stockSub: b => { ui.stockSub = b.dataset.v || null; render(); },
  starredOnly: () => { ui.starredOnly = !ui.starredOnly; render(); },
  newItem: () => itemSheet(null),
  openItem: b => itemSheet(db.get('items', b.dataset.id)),
  star: b => { const it = db.get('items', b.dataset.id); db.put('items', { ...it, starred: !it.starred }); },
  inc: b => { const it = db.get('items', b.dataset.id); setQty(it, it.qty + 1); },
  dec: b => {
    const it = db.get('items', b.dataset.id);
    if (it.qty <= 0) return;
    setQty(it, it.qty - 1).then(saved => {
      if (isLow(saved) && !groceryFor(saved)) toast(`${saved.name} is running low — suggested on the grocery list`);
    });
  },
  // scan
  scanText: () => {
    const t = $('#scan-text').value;
    if (!t.trim()) return;
    ui.scan = { stage: 'review', photo: null, rows: scanRowsFrom(parseText(t)), mode: 'add' };
    render();
  },
  scanMode: b => { ui.scan.mode = b.dataset.v; render(); },
  scanReset: () => { ui.scan = { stage: 'pick' }; render(); },
  scanAddRow: () => { ui.scan.rows.push({ raw: '(added)', name: '', qty: 1, unit: '', match: 'new', category: 'other', sub: '', skip: false }); render(); },
  scanApply: () => applyScan(),
  viewScanPhoto: () => openSheet(`<img class="full-photo" src="${ui.scan.photo}" alt="">`, { wide: true }),
  // grocery
  gMode: b => { ui.gMode = b.dataset.v; ui.gCat = ui.gSub = null; render(); },
  gCat: b => { ui.gCat = b.dataset.v || null; ui.gSub = null; render(); },
  gSub: b => { ui.gSub = b.dataset.v || null; render(); },
  gPhotoClear: () => { ui.gDraft.photo = null; render(); },
  editGrocery: b => grocerySheet(db.get('grocery', b.dataset.id)),
  viewPhoto: b => openSheet(`<img class="full-photo" src="${b.src}" alt="">`, { wide: true }),
  confirmSuggest: b => { const it = db.get('items', b.dataset.id); addToGrocery({ name: it.name, itemId: it.id, qty: 1 }); },
  dismissSuggest: b => { const it = db.get('items', b.dataset.id); db.put('items', { ...it, lowDismissed: true }); },
  toggleShowDone: () => { ui.showDone = !ui.showDone; render(); },
  clearDone: async () => { for (const g of db.list('grocery').filter(g => g.done)) await db.remove('grocery', g.id); },
  // recipes
  canMakeOnly: () => { ui.canMakeOnly = !ui.canMakeOnly; render(); },
  makeRecipe: b => makeRecipeSheet(db.get('recipes', b.dataset.id)),
  addMissing: b => addMissing(db.get('recipes', b.dataset.id)),
  printRecipe: b => printSheet(db.get('recipes', b.dataset.id)),
  delNote: async b => {
    const r = db.get('recipes', b.dataset.id);
    if (await confirmSheet('Delete note?', '<p>This removes the note for everyone.</p>', 'Delete'))
      db.put('recipes', { ...r, notes: r.notes.filter(n => n.id !== b.dataset.note) });
  },
  cancelEdit: () => { ui.recipeDraft = null; },
  recipePhotoClear: () => { ui.recipeDraft.photo = null; render(); },
  ingAdd: () => { ui.recipeDraft.ingredients.push({ amount: '', name: '', uses: 1, optional: false }); render(); $$('.ing-row .amt').pop()?.focus(); },
  ingDel: b => { ui.recipeDraft.ingredients.splice(+b.dataset.i, 1); render(); },
  stepAdd: () => { ui.recipeDraft.steps.push(''); render(); $$('.step-row textarea').pop()?.focus(); },
  stepDel: b => { ui.recipeDraft.steps.splice(+b.dataset.i, 1); render(); },
  stepUp: b => { const i = +b.dataset.i, s = ui.recipeDraft.steps; if (i > 0) { [s[i - 1], s[i]] = [s[i], s[i - 1]]; render(); } },
  recipeSave: () => saveRecipe(),
  recipeDelete: async () => {
    const r = ui.recipeDraft;
    if (await confirmSheet('Delete recipe?', `<p>Delete <b>${esc(r.title)}</b> and its notes?</p>`, 'Delete')) {
      await db.remove('recipes', r.id); ui.recipeDraft = null; location.hash = '#/recipes';
    }
  },
  // settings
  connectSync: async () => {
    const [owner, repo] = (S.ghRepo || gh.guessRepo() || '').replace(/^https?:\/\/github\.com\//, '').split('/');
    if (!owner || !repo) return toast('Enter the repository as owner/repo');
    if (!S.ghToken) return toast('Paste an access token first');
    S.ghRepo = `${owner}/${repo}`; S.ghOn = true; saveSettings();
    try {
      await gh.connect({ owner, repo, token: S.ghToken, name: me(), api: S.ghApi });
      toast('Connected — the list is shared');
    } catch (e) { toast(e.message, [], 8000); }
    render();
  },
  disconnectSync: () => { S.ghOn = false; saveSettings(); gh.disconnect(); render(); },
  catAdd: () => { catDraft = catDraft || structuredClone(cats()); catDraft.push({ id: uid(), name: 'New category', icon: '🍽', subs: [] }); render(); },
  catReset: async () => {
    if (await confirmSheet('Reset categories?', '<p>Go back to the default category list? Items keep their category if it still exists.</p>', 'Reset'))
      db.put('meta', { id: 'categories', list: DEFAULT_CATEGORIES });
  },
  catSave: () => {
    $$('[data-ci]').forEach(updateCatDraft);
    const list = catDraft;
    catDraft = null;
    db.put('meta', { id: 'categories', list: list.filter(c => c.name) });
    toast('Categories saved');
  },
  exportData: async () => {
    const blob = new Blob([JSON.stringify(await db.exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `pantry-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  }
};

// ---------------- change / input / submit handlers ----------------
const C = {
  scanFile: el => el.files[0] && runScan(el.files[0]),
  gPhoto: async el => { if (el.files[0]) { ui.gDraft.photo = await compressImage(el.files[0], 900); render(); } },
  gCat: el => { ui.gDraft.category = el.value; ui.gDraft.sub = ''; render(); },
  gSub: el => { ui.gDraft.sub = el.value; },
  toggleDone: el => toggleDone(db.get('grocery', el.dataset.id), el.checked),
  recipePhoto: async el => { if (el.files[0]) { ui.recipeDraft.photo = await compressImage(el.files[0], 900); render(); } },
  importData: async el => {
    const f = el.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (await confirmSheet('Import backup?', '<p>Records in the backup will be added or will replace matching ones. Nothing else is deleted.</p>', 'Import')) {
        await db.importAll(data); toast('Backup imported');
      }
    } catch (e) { toast('Could not read that file'); }
  }
};

const I = {
  stockSearch: el => { ui.stockSearch = el.value; render(); },
  recipeSearch: el => { ui.recipeSearch = el.value; render(); },
  gName: el => { ui.gDraft.name = el.value; },
  gQty: el => { ui.gDraft.qty = parseFloat(el.value) || 1; },
  gNote: el => { ui.gDraft.note = el.value; }
};

const SUBMIT = {
  addGrocery: async () => {
    const d = ui.gDraft;
    if (!d.name.trim()) return $('#g-name').focus();
    await addToGrocery({ name: d.name, qty: d.qty, category: d.category || undefined, sub: d.category ? d.sub : undefined, note: d.note, photo: d.photo });
    ui.gDraft = { name: '', qty: 1, photo: null, category: '', sub: '', note: '', open: d.open };
    render();
    $('#g-name')?.focus();
  },
  addNote: async form => {
    const t = $('#note-text').value.trim();
    if (!t) return;
    const r = db.get('recipes', form.dataset.id);
    await db.put('recipes', { ...r, notes: [...(r.notes || []), { id: uid(), at: Date.now(), by: me(), text: t }] });
  }
};

function bind() {
  const view = $('#view');
  view.addEventListener('click', e => {
    const a = e.target.closest('[data-act]');
    if (a && A[a.dataset.act]) { if (a.tagName === 'BUTTON') e.preventDefault(); e.stopPropagation(); A[a.dataset.act](a, e); }
  });
  view.addEventListener('change', e => {
    const el = e.target;
    if (el.dataset.change && C[el.dataset.change]) return C[el.dataset.change](el);
    // scan review rows
    if (el.dataset.scan) {
      const r = ui.scan.rows[+el.dataset.i], k = el.dataset.scan;
      if (k === 'skip') r.skip = !el.checked;
      else if (k === 'qty') r.qty = parseFloat(el.value) || 0;
      else if (k === 'name') {
        r.name = el.value;
        const m = bestMatch(r.name, db.list('items'), 0.6);
        r.match = m ? m.id : 'new';
        if (!m) Object.assign(r, guessCategory(r.name));
      } else r[k] = el.value;
      softRender();
    }
    if (el.dataset.ri) {
      const g = ui.recipeDraft.ingredients[+el.dataset.i];
      if (el.dataset.ri === 'optional') g.optional = el.checked;
      // refresh the "↳ stock:" hint in place (a full re-draw here would swallow the next tap)
      const row = el.closest('.ing-row');
      let hint = row.querySelector('.link-hint');
      if (g.name.trim() && !g.optional) {
        const m = resolveIng({ name: g.name });
        if (!hint) { hint = document.createElement('div'); hint.className = 'link-hint'; row.appendChild(hint); }
        hint.textContent = m ? `↳ stock: ${m.name}` : '↳ not in stock yet';
      } else hint?.remove();
    }
  });
  view.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.input && I[el.dataset.input]) return I[el.dataset.input](el);
    if (el.dataset.set) { S[el.dataset.set] = el.value.trim(); saveSettings(); return; }
    if (el.dataset.rd) { ui.recipeDraft[el.dataset.rd] = el.value; return; }
    if (el.dataset.ri && el.dataset.ri !== 'optional') { ui.recipeDraft.ingredients[+el.dataset.i][el.dataset.ri] = el.value; return; }
    if (el.dataset.rs) { ui.recipeDraft.steps[+el.dataset.rs] = el.value; return; }
    if (el.dataset.ci) updateCatDraft(el);
  });
  view.addEventListener('toggle', e => { if (e.target.dataset.toggle === 'gOpen') ui.gDraft.open = e.target.open; }, true);
  view.addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    SUBMIT[f.dataset.submit]?.(f);
  });
}

// ---------------- first run ----------------
function askName() {
  openSheet(`<h2>Welcome to Pantry</h2>
    <p>What should we call you? Your name shows on grocery items and recipe notes so the household knows who added what.</p>
    <div class="form"><label>Your name<input data-n placeholder="e.g. Miko"></label></div>
    <div class="row-end"><button class="btn primary" data-ok>Get started</button></div>`, {
    onMount(s, close) {
      const inp = s.querySelector('[data-n]'); inp.focus();
      const ok = () => { S.name = inp.value.trim() || 'Me'; saveSettings(); close(); render(); };
      s.querySelector('[data-ok]').onclick = ok;
      inp.onkeydown = e => e.key === 'Enter' && ok();
    }
  });
}

// ---------------- boot ----------------
(async function boot() {
  await db.init();
  bind();
  db.onChange(softRender);
  window.addEventListener('hashchange', render);
  render();
  if (!S.name) askName();
  db.setAfterPut(gh.noteLocalChange);
  gh.onStatus(renderSync);
  $('#refresh-banner button').onclick = async () => {
    try { await gh.pull(); toast('List refreshed'); } catch (e) { toast(e.message, [], 8000); }
  };
  new MutationObserver(muts => muts.forEach(m => m.addedNodes.forEach(n => n.nodeType === 1 && hydratePhotos(n))))
    .observe(document.body, { childList: true, subtree: true });
  hydratePhotos();
  if (S.ghOn && S.ghRepo && S.ghToken) {
    const [owner, repo] = S.ghRepo.split('/');
    gh.connect({ owner, repo, token: S.ghToken, name: me(), api: S.ghApi }).catch(() => { });
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__pantry = { db, ui, S, gh }; // handy for debugging in the console
})();
