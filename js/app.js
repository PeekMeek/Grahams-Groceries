import * as db from './db.js';
import { DEFAULT_CATEGORIES } from './categories.js';
import { $, $$, esc, uid, fmtWhen, fmtQty, normalize, bestMatch, compressImage, toast, openSheet, confirmSheet } from './util.js';
import { readWithClaude, readWithTesseract, parseText, readRecipeWithClaude, readRecipeWithTesseract, amountFor, usesFor, parseAmount, normUnit, WEIGHTS, VOLUMES, isMeasure, convertQty } from './ocr.js';
import * as gh from './github.js';

const LOW = 2; // default: starred items at or below this quantity are suggested for the grocery list

// ---------------- settings (per device) ----------------
const SETTINGS_KEY = 'pantry.settings';
const S = (() => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch { return {}; } })();
const saveSettings = () => localStorage.setItem(SETTINGS_KEY, JSON.stringify(S));
const me = () => S.name || 'Someone';

// ---------------- UI state (survives re-renders) ----------------
const ui = {
  stockLoc: 'fridgeunit',
  stockMode: 'all', stockCat: null, stockSub: null, stockSearch: '', starredOnly: false,
  gMode: 'all', gCat: null, gSub: null, showDone: false,
  gDraft: { name: '', qty: 1, photo: null, category: '', sub: '', note: '' },
  recipeSearch: '', canMakeOnly: false,
  spiceSort: 'used', spiceCuisine: null, spiceSearch: '',
  recipeScale: {}, scaleCustom: {}, scaleText: {},
  scan: { stage: 'pick' },
  recipeDraft: null
};

// ---------------- categories ----------------
const cats = () => {
  const saved = db.get('meta', 'categories')?.list;
  if (!saved) return DEFAULT_CATEGORIES;
  // households that saved categories before "Household goods" existed get the new version
  return saved.map(c => c.id === 'household' && c.name === 'Household' && !c.nonFood ? DEFAULT_CATEGORIES.find(d => d.id === 'household') : c);
};
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
  ['veggies', '', 'broccoli cauliflower celery corn pea asparagus avocado'],
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
  ['pantry', 'Spices', 'salt, kosher salt, sea salt, black pepper, peppercorn, cumin, ground cumin, paprika, smoked paprika, cinnamon, ground cinnamon, oregano, dried oregano, dried basil, dried thyme, dried rosemary, dried dill, dill weed, chili powder, chili flakes, red pepper flakes, crushed red pepper, cayenne, cayenne pepper, garlic powder, onion powder, turmeric, coriander, ground coriander, cardamom, clove, ground clove, nutmeg, ground ginger, allspice, bay leaf, bay leaves, sage, rubbed sage, garam masala, curry powder, five spice, chinese five spice, star anise, italian seasoning, taco seasoning, cajun seasoning, old bay, za\'atar, zaatar, sumac, saffron, fennel seed, mustard seed, cumin seed, sesame seed, celery salt, seasoning salt, seasoned salt, lemon pepper, everything bagel seasoning, spice, seasoning, rub, dry rub'],
  ['pantry', 'Sauces & condiments', 'ketchup mustard mayo mayonnaise sauce salsa dressing soy honey jam peanut'],
  ['pantry', 'Canned goods', 'can canned soup broth stock'],
  ['pantry', 'Beans & lentils', 'lentil chickpea bean beans kidney'],
  ['pantry', 'Breakfast', 'cereal granola pancake syrup'],
  ['frozen', 'Ice cream', 'ice cream gelato'],
  ['frozen', 'Meals', 'frozen pizza'],
  ['frozen', 'Vegetables', 'hashbrown, hashbrowns, hash brown, hash browns, tater tot, tater tots, french fry, french fries, fries, frozen pea, frozen corn, frozen vegetable, frozen broccoli'],
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
  ['household', 'Paper goods', 'paper towel, toilet paper, tissue, napkin, paper plate, paper cup, kleenex, bounty, charmin'],
  ['household', 'Laundry', 'laundry, detergent, laundry detergent, fabric softener, dryer sheet, bleach, stain remover, tide pod, tide'],
  ['household', 'Dish & kitchen', 'dish soap, dishwasher pod, dishwasher detergent, dish detergent, aluminum foil, foil, plastic wrap, cling wrap, parchment, parchment paper, wax paper, ziploc, sandwich bag, freezer bag, storage bag'],
  ['household', 'Cleaning', 'cleaner, all purpose cleaner, glass cleaner, disinfectant, wipe, disinfecting wipe, lysol, clorox, windex, sponge, scrub brush, mop, swiffer'],
  ['household', 'Trash bags', 'trash bag, garbage bag, bin liner, hefty'],
  ['household', 'Batteries & bulbs', 'battery, aa, aaa, aa battery, aaa battery, light bulb, bulb'],
  ['household', 'Toiletries', 'shampoo, conditioner, toothpaste, toothbrush, deodorant, body wash, soap, hand soap, razor, floss, lotion, mouthwash, sunscreen'],
  ['household', 'Medicine & first aid', 'bandage, band aid, bandaid, ibuprofen, tylenol, advil, acetaminophen, vitamin, allergy medicine, cough drop'],
  ['household', 'Pet supplies', 'dog food, cat food, cat litter, litter, pet food']
];
// split a keyword list: comma lists may contain multi-word phrases, others are space separated
const words = list => (list.includes(',') ? list.split(',') : list.split(' ')).map(w => normalize(w.trim())).filter(Boolean);
function guessCategory(name) {
  const n = normalize(name);
  const hit = (c, sub) => ({ category: c, sub: cat(c).subs.includes(sub) ? sub : '' });
  // 1) multi-word phrases first ("dish soap", "toilet paper", "plastic wrap"), longest first
  let best = null;
  for (const [c, sub, list] of GUESS) {
    if (!cats().some(x => x.id === c)) continue;
    for (const ph of words(list)) if (ph.includes(' ') && ` ${n} `.includes(` ${ph} `) && (!best || ph.length > best.len)) best = { c, sub, len: ph.length };
  }
  if (best) return hit(best.c, best.sub);
  // 2) single words, last word first (it's usually the noun)
  const ws = n.split(' ');
  for (let i = ws.length - 1; i >= 0; i--) {
    for (const [c, sub, list] of GUESS) {
      if (words(list).includes(ws[i]) && cats().some(x => x.id === c)) return hit(c, sub);
    }
  }
  return { category: 'other', sub: '' };
}

// ---------------- prices & links ----------------
const money = n => '$' + (Math.round(n * 100) / 100).toFixed(2);
const parsePrice = v => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return n >= 0 && isFinite(n) ? Math.round(n * 100) / 100 : null; };
function cleanLink(v) {
  v = String(v || '').trim();
  if (!v) return '';
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v;
  try { return new URL(v).href; } catch { return ''; }
}
const linkHost = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'link'; } };
// the stock item a grocery entry refers to (by link or by name)
const itemForGrocery = g => (g.itemId && db.get('items', g.itemId)) || findItem(g.name);
function groceryPrice(g) {
  const it = itemForGrocery(g);
  const each = it?.price ?? g.price;
  return each == null ? null : each * (g.qty || 1);
}
const groceryLink = g => itemForGrocery(g)?.link || g.link || '';

// Price + link fields shared by the item and grocery sheets.
function priceLinkFields(price, link, priceAt) {
  return `
      <label>Price paid (each)
        <span class="money-in"><span>$</span><input data-f="price" type="text" inputmode="decimal" value="${price != null ? price.toFixed(2) : ''}" placeholder="0.00" autocomplete="off"></span>
        ${priceAt ? `<span class="field-note">Last updated ${fmtWhen(priceAt)}</span>` : ''}
      </label>
      <label>Link to buy it
        <span class="link-in"><input data-f="link" type="url" inputmode="url" value="${esc(link || '')}" placeholder="https://…" autocomplete="off">
        ${link ? `<a class="btn small" href="${esc(link)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</span>
      </label>`;
}

// ---------------- domain helpers ----------------
const items = () => db.list('items').sort((a, b) => a.name.localeCompare(b.name));
const isNonFood = it => !!cat(it.category).nonFood;
const isPrepared = it => isNonFood(it) || (it.prepared ?? !!cat(it.category).prepared);
// running-low level: the item's own, else the household default from Settings, else 2
const lowDefault = () => { const v = db.get('meta', 'settings')?.lowAt; return v != null && v >= 0 ? +v : LOW; };
const lowAtOf = it => it?.lowAt != null && +it.lowAt >= 0 ? +it.lowAt : lowDefault();
const isLow = it => it.starred && it.qty <= lowAtOf(it);
// accepts 2, 0.5, 1/2, 1 1/2, ½ — returns NaN when it isn't a number
const qtyIn = v => { const n = parseAmount(v); return isNaN(n) ? NaN : Math.max(0, Math.round(n * 1000) / 1000); };
const activeGrocery = () => db.list('grocery').filter(g => !g.done);
const groceryFor = it => activeGrocery().find(g => g.itemId === it.id || normalize(g.name) === normalize(it.name));
const suggestions = () => items().filter(it => isLow(it) && !it.lowDismissed && !groceryFor(it));
const findItem = name => bestMatch(name, db.list('items').filter(i => !i.openedFrom), 0.75);
const resolveIng = ing => (ing.itemId && db.get('items', ing.itemId)) || findItem(ing.name);

// ---------------- units: size of one × how many = total ----------------
const sizeOf = it => +it?.size > 0 ? +it.size : 1;
const unitOf = it => normUnit(it?.unit || '');
const PLURAL = { box: 'boxes', bunch: 'bunches', loaf: 'loaves', pack: 'packs' };
const NO_PLURAL = ['lb', 'oz', 'g', 'kg', 'L', 'ml', 'gal', 'qt', 'pt', 'tsp', 'tbsp', 'fl oz'];
const plural = (u, n) => !u || n === 1 || NO_PLURAL.includes(u) || /s$/.test(u) ? u : (PLURAL[u] || u + 's');
const amt = (n, u) => u ? `${fmtQty(n)} ${plural(u, n)}` : fmtQty(n);
// total amount in stock, e.g. 5 × 1 lb -> "5 lb", 10 × 12 oz -> "120 oz", 3 cans -> "3 cans"
const totalText = (it, q = it.qty) => unitOf(it) ? amt(Math.round(q * sizeOf(it) * 100) / 100, unitOf(it)) : fmtQty(q);
const eachText = it => unitOf(it) ? `${amt(sizeOf(it), unitOf(it))} each` : '';
// "1 lb each · 5 lb total", or just "3 cans" when one is simply 1 of the unit
const unitSummary = it => !unitOf(it) ? '' : sizeOf(it) === 1 && !WEIGHTS[unitOf(it)] ? totalText(it) : `${eachText(it)} · ${totalText(it)} total`;
// how many of a stock item one batch of a recipe ingredient uses
const perBatch = (ing, item) => {
  const auto = item && !ing.usesManual ? usesFor(ing.amount, item.unit, sizeOf(item), densName(item)) : null;
  return auto ?? (+ing.uses > 0 ? +ing.uses : 1);
};

// ---------------- spices ----------------
const CUISINES = ['Everyday', 'American', 'Mexican', 'Italian', 'Mediterranean', 'French', 'Middle Eastern', 'Indian', 'Asian', 'Baking'];
const SPICE_CUISINES = {
  'salt': ['Everyday'], 'black pepper': ['Everyday'], 'peppercorn': ['Everyday'], 'garlic powder': ['Everyday', 'American'], 'onion powder': ['American'],
  'cumin': ['Mexican', 'Indian', 'Middle Eastern'], 'chili powder': ['Mexican', 'American'], 'paprika': ['American', 'Mediterranean'], 'smoked paprika': ['American', 'Mediterranean'],
  'oregano': ['Italian', 'Mexican', 'Mediterranean'], 'basil': ['Italian'], 'thyme': ['French', 'Mediterranean'], 'rosemary': ['Italian', 'Mediterranean'], 'dill': ['Mediterranean'],
  'turmeric': ['Indian', 'Middle Eastern'], 'coriander': ['Indian', 'Mexican', 'Middle Eastern'], 'garam masala': ['Indian'], 'curry powder': ['Indian'], 'cardamom': ['Indian', 'Middle Eastern', 'Baking'],
  'cinnamon': ['Baking', 'Middle Eastern', 'Mexican', 'Indian'], 'nutmeg': ['Baking'], 'allspice': ['Baking'], 'clove': ['Baking', 'Indian'], 'ginger': ['Asian', 'Indian', 'Baking'],
  'five spice': ['Asian'], 'star anise': ['Asian'], 'sesame seed': ['Asian'], 'cayenne': ['American', 'Mexican'], 'red pepper flake': ['Italian'], 'crushed red pepper': ['Italian'], 'chili flake': ['Italian', 'Asian'],
  'italian seasoning': ['Italian'], 'taco seasoning': ['Mexican'], 'cajun seasoning': ['American'], 'old bay': ['American'], 'za atar': ['Middle Eastern'], 'zaatar': ['Middle Eastern'], 'sumac': ['Middle Eastern'],
  'saffron': ['Indian', 'Mediterranean', 'Middle Eastern'], 'bay leaf': ['Mediterranean', 'French', 'Indian'], 'bay leaves': ['Mediterranean', 'French', 'Indian'], 'fennel seed': ['Italian', 'Indian'], 'mustard seed': ['Indian'], 'sage': ['American', 'Italian'],
  'vanilla': ['Baking'], 'lemon pepper': ['American'], 'celery salt': ['American'], 'seasoned salt': ['American']
};
const isSpice = it => it && (it.sub === 'Spices' || it.category === 'spices');
// name used to look up a typical density (spices are light and dry)
const densName = it => `${it?.name || ''}${isSpice(it) ? ' spice' : ''}`;
function guessCuisines(name) {
  const n = ` ${normalize(name)} `;
  const hit = Object.keys(SPICE_CUISINES).filter(k => n.includes(` ${normalize(k)} `)).sort((a, b) => b.length - a.length)[0];
  return hit ? SPICE_CUISINES[hit] : [];
}
const cuisinesOf = it => Array.isArray(it.cuisines) ? it.cuisines : guessCuisines(it.name);
// times used: "Used some" entries + every time a recipe containing it was made
function spiceStats(it) {
  const own = (it.usage || []).filter(u => !u.recipe);
  const recs = recipesUsing(it);
  const count = own.length + recs.reduce((a, r) => a + (r.madeCount || 0), 0);
  const last = Math.max(0, ...own.map(u => u.at), ...recs.map(r => r.lastMade || 0));
  return { count, last, recipes: recs.length };
}
// comparable amount for "most in stock": weights in grams, otherwise the count
const stockAmount = it => WEIGHTS[unitOf(it)] ? it.qty * sizeOf(it) * WEIGHTS[unitOf(it)] : it.qty;

// ---------------- usage log & opened items ----------------
// An opened item lives as its own entry in the fridge ("Milk · opened"), linked to the sealed
// item it came from. The sealed item keeps counting only what's still sealed.
const isOpenedCopy = it => !!it?.openedFrom;
const openedCopiesOf = it => it ? db.list('items').filter(x => x.openedFrom === it.id && x.qty > 0).sort((a, b) => (a.openedAt || 0) - (b.openedAt || 0)) : [];
const availableQty = it => (it?.qty || 0) + openedCopiesOf(it).reduce((a, x) => a + x.qty, 0);

// Split one (or what's left, if less than one) off the sealed item into an opened item in the fridge.
async function openOne(itemId, days) {
  const p = db.get('items', itemId);
  if (!p || p.qty <= 0) return null;
  const take = Math.min(1, p.qty);
  const od = days || openedDaysOf(p) || 7;
  const copy = {
    id: uid(), name: p.name, category: p.category, sub: p.sub, unit: p.unit || '', size: p.size, price: p.price ?? null, link: p.link || '',
    photo: p.photo || null, cuisines: p.cuisines, openedDays: od, openedAt: Date.now(), openedFrom: p.id, location: p.location === 'door' ? 'door' : 'fridge',
    qty: take, starred: false, createdAt: Date.now(), stockedAt: stockedAt(p), usage: []
  };
  await db.put('items', copy);
  await setQty({ ...p, ...(days ? { openedDays: days } : {}) }, p.qty - take);
  return copy;
}

// Snapshot a sealed item and its opened copies so any change to them can be undone.
function snapshotFamily(id) {
  const it = db.get('items', id);
  const pid = it?.openedFrom || id;
  return { pid, items: [db.get('items', pid), ...db.list('items').filter(x => x.openedFrom === pid)].filter(Boolean).map(x => ({ ...x })) };
}
async function restoreFamily(snap) {
  const keep = new Set(snap.items.map(x => x.id));
  for (const x of db.list('items').filter(x => x.openedFrom === snap.pid && !keep.has(x.id))) await db.remove('items', x.id);
  for (const x of snap.items) await db.put('items', x);
}

// Take `packs` (in "how many" terms) out of stock and remember when, who and how much.
// Items with an opened shelf life are used from the opened one first; if none is open, one is opened.
async function consume(itemId, packs, label, extra = {}) {
  const it = db.get('items', itemId);
  if (!it) return null;
  const entry = (p, l) => ({ id: uid(), at: Date.now(), by: me(), packs: p, label: l ?? useLabel(it, p), ...extra });
  if (isOpenedCopy(it) || openedDaysOf(it) <= 0) {
    return setQty({ ...it, usage: [entry(packs, label), ...(it.usage || [])].slice(0, 40) }, it.qty - packs);
  }
  let left = packs;
  while (left > 1e-9) {
    let c = openedCopiesOf(it)[0];                       // oldest opened first
    if (!c) { c = await openOne(it.id); if (!c) break; } // nothing open: open one
    const take = Math.min(left, c.qty);
    await setQty({ ...c, usage: [entry(take), ...(c.usage || [])].slice(0, 40) }, c.qty - take);
    left = Math.round((left - take) * 1000) / 1000;
  }
  const p = db.get('items', it.id);
  await db.put('items', { ...p, usage: [entry(packs, label), ...(p.usage || [])].slice(0, 40) });
  return db.get('items', it.id);
}
// units you can enter a use in: "each" (one of the item) plus weights when the item is weighed
function useUnits(it) {
  const u = unitOf(it), sz = sizeOf(it);
  const each = u ? (sz === 1 && !isMeasure(u) ? plural(u, 2) : `× ${amt(sz, u)} (whole)`) : 'each';
  const measures = isMeasure(u) ? [...new Set([u, 'oz', 'lb', 'g', 'tsp', 'tbsp', 'cup', 'fl oz', 'ml', 'L', ...(/butter/i.test(it.name) ? ['stick'] : [])])] : [];
  return [{ v: 'each', label: each }, ...measures.map(w => ({ v: w, label: w === 'tbsp' ? 'Tbsp' : w }))];
}
const WEIGHTS_ONLY = it => /butter|cheese|flour|sugar|spice/i.test(densName(it));
// sensible default for "Used some": the last unit used for this item, else a kitchen measure — never the whole container
function useDefaultUnit(it) {
  const opts = useUnits(it).map(o => o.v);
  if (it.lastUseUnit && opts.includes(it.lastUseUnit)) return it.lastUseUnit;
  const u = unitOf(it);
  if (VOLUMES[u] || (u === 'oz' && !WEIGHTS_ONLY(it))) {
    const ml = convertQty(sizeOf(it), u, 'ml', densName(it)) || 0;
    return ml >= 470 ? 'cup' : 'tbsp';                  // pints and bigger: cups; smaller bottles: Tbsp
  }
  if (WEIGHTS[u]) return /butter/i.test(it.name) ? 'tbsp' : u === 'g' || u === 'kg' ? 'g' : 'oz';
  return 'each';
}
const toPacks = (it, a, unit) => {
  if (unit === 'each' || !isMeasure(unit) || !isMeasure(unitOf(it))) return a;
  const c = convertQty(a, unit, unitOf(it), densName(it));
  return c == null ? a : Math.round(c / sizeOf(it) * 10000) / 10000;
};
const useLabel = (it, packs) => unitOf(it) ? totalText(it, packs) : fmtQty(packs);

// ---------------- batch scaling ----------------
const SCALES = [0.5, 1, 1.5, 2];
const UNI = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125, '⅜': .375, '⅝': .625, '⅞': .875 };
const QTY_RE = /(\d+\s+\d+\/\d+|\d+\/\d+|\d*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?)(\s*[-–]\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+(?:\.\d+)?))?/g;

function parseQty(t) {
  t = t.trim();
  let m;
  if ((m = t.match(/^(\d+)\s+(\d+)\/(\d+)$/))) return +m[1] + m[2] / m[3];
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return m[2] ? m[1] / m[2] : NaN;
  if ((m = t.match(/^(\d*)([½¼¾⅓⅔⅛⅜⅝⅞])$/))) return (+m[1] || 0) + UNI[m[2]];
  return parseFloat(t);
}

// 1.5 -> "1 1/2", 0.333 -> "1/3", 2.2 -> "2.2"
function niceQty(x) {
  const whole = Math.floor(x + 1e-6), frac = x - whole;
  const F = [[0, ''], [1 / 8, '1/8'], [1 / 6, '1/6'], [1 / 4, '1/4'], [1 / 3, '1/3'], [3 / 8, '3/8'], [1 / 2, '1/2'], [5 / 8, '5/8'], [2 / 3, '2/3'], [3 / 4, '3/4'], [5 / 6, '5/6'], [7 / 8, '7/8'], [1, '']];
  const [v, f] = F.reduce((a, b) => Math.abs(b[0] - frac) < Math.abs(a[0] - frac) ? b : a);
  if (Math.abs(v - frac) > 0.02) return String(Math.round(x * 100) / 100);
  const w = whole + (v === 1 ? 1 : 0);
  return f ? (w ? `${w} ${f}` : f) : String(w);
}

// Scale the first quantity in an amount ("1 1/2 cups", "2-3 cloves", "2 (15 oz) cans").
// Numbers inside brackets (package sizes) are left alone.
function scaleAmount(text, k) {
  if (!text || k === 1) return text || '';
  QTY_RE.lastIndex = 0;
  let m;
  while ((m = QTY_RE.exec(text))) {
    const before = text.slice(0, m.index);
    if ((before.match(/\(/g) || []).length > (before.match(/\)/g) || []).length) continue;
    const a = parseQty(m[1]);
    if (isNaN(a)) continue;
    let out = niceQty(a * k);
    if (m[3]) { const b = parseQty(m[3]); if (!isNaN(b)) out += '–' + niceQty(b * k); }
    return text.slice(0, m.index) + out + text.slice(m.index + m[0].length);
  }
  return text;
}

const scaleOf = id => ui.recipeScale[id] || 1;
const scaleLabel = k => `${+k.toFixed(2)}× batch`;

function recipeStatus(r, scale = 1) {
  const rows = (r.ingredients || []).map(ing => {
    const item = resolveIng(ing);
    const need = Math.round(perBatch(ing, item) * scale * 10000) / 10000;
    const ok = ing.optional || (item && availableQty(item) >= need - 1e-9);
    return { ing, item, need, ok };
  });
  const missing = rows.filter(x => !x.ok);
  return { rows, missing, canMake: !missing.length };
}
const recipesUsing = it => db.list('recipes').filter(r => (r.ingredients || []).some(ing => resolveIng(ing)?.id === it.id));

// ---------------- storage locations & time in inventory ----------------
const LOCS = [
  { id: 'door', name: 'Fridge door', short: 'Door', icon: '🚪' },
  { id: 'fridge', name: 'Fridge', short: 'Fridge', icon: '🥛' },
  { id: 'fridgefreezer', name: 'Freezer', short: 'Freezer', icon: '🧊' },
  { id: 'snacks', name: 'Snack cabinet', short: 'Snacks', icon: '🍿' },
  { id: 'pantry', name: 'Pantry', short: 'Pantry', icon: '🥫' },
  { id: 'freezer', name: 'Deep freezer', short: 'Deep freezer', icon: '❄️' },
  { id: 'stovetop', name: 'Stovetop', short: 'Stovetop', icon: '🍳' }
];
// How the Stock page is laid out: the fridge is one panel (door | fridge, freezer underneath)
const STOCK_COLS = [
  { id: 'fridgeunit', name: 'Fridge', short: 'Fridge', icon: '🥛', parts: ['door', 'fridge', 'fridgefreezer'] },
  { id: 'snacks' }, { id: 'pantry' }, { id: 'freezer' }, { id: 'stovetop' }
];
const loc = id => LOCS.find(l => l.id === id) || LOCS[1];
// Days before an item gets a yellow border (red at double). Shared by the household; editable in Settings.
const AGE_DEFAULTS = { door: 30, fridge: 14, fridgefreezer: 90, snacks: 180, pantry: 365, freezer: 180, stovetop: 365 };
const ageDays = () => ({ ...AGE_DEFAULTS, ...(db.get('meta', 'settings')?.ageDays || {}) });
// ---- Stovetop: oils, plus salt & pepper and any spice you choose ----
const isOil = it => /\boil\b|cooking spray/.test(normalize(it?.name || '')) && !isNonFood(it);
const STOVE_SPICES = /^(kosher |sea |table |black |white |flaky |fine )?(salt|pepper|peppercorn|salt and pepper|salt pepper)$/;
const isStoveStaple = it => isSpice(it) && STOVE_SPICES.test(normalize(it.name));
// shown on the stovetop: kept there, or flagged (oils, salt & pepper by default; any spice by choice)
const onStoveOf = it => locOf(it) === 'stovetop' || (it.onStove ?? (isOil(it) || isStoveStaple(it)));
function defaultLocation(category, sub, name = '') {
  if (sub === 'Oils & vinegars' && /\boil\b/i.test(name)) return 'stovetop';
  if (category === 'snacks' || ['Cookies', 'Candy & chocolate'].includes(sub)) return 'snacks';
  if (sub === 'Sauces & condiments') return 'door';
  if (category === 'frozen' || sub === 'Ice cream') return 'freezer';
  if (['meats', 'dairy', 'prepared'].includes(category)) return 'fridge';
  if (category === 'veggies') return ['Onions & garlic', 'Root vegetables'].includes(sub) ? 'pantry' : 'fridge';
  if (category === 'fruit') return sub === 'Berries' ? 'fridge' : 'pantry';
  return 'pantry';
}
const locOf = it => LOCS.some(l => l.id === it.location) ? it.location : defaultLocation(it.category, it.sub, it.name);
const DAY = 86400000;
const stockedAt = it => it.stockedAt || it.createdAt || it.updatedAt || Date.now();
const daysIn = it => Math.max(0, Math.floor((Date.now() - stockedAt(it)) / DAY));
// Leftovers from "Made it" link back to their recipe and use the leftovers shelf life.
const LEFTOVER_DEFAULT = 4;
const leftoverDays = () => +db.get('meta', 'settings')?.leftoverDays || LEFTOVER_DEFAULT;
const isLeftover = it => !!it?.recipeId;
const portionLeft = q => q >= 1 ? (q === 1 ? 'Full' : `${niceQty(q)} left`) : `${niceQty(q)} left`;
const ageLimit = it => +it.warnDays > 0 ? +it.warnDays : isLeftover(it) ? leftoverDays() : ageDays()[locOf(it)];
// '' (fine), 'aging' (past the limit: yellow) or 'old' (past double: red). Household goods and empty items don't age.
// ---- opened vs unopened ----
// Typical shelf life once opened (days). Used when an item has no "once opened" value of its own.
const OPENED_GUESS = [
  ['oat milk', 7], ['almond milk', 7], ['soy milk', 7], ['coconut milk', 4], ['buttermilk', 14], ['milk', 7],
  ['heavy cream', 10], ['whipping cream', 7], ['half and half', 7], ['sour cream', 14], ['cream cheese', 10], ['cream', 7],
  ['chicken stock', 4], ['chicken broth', 4], ['beef stock', 4], ['beef broth', 4], ['vegetable stock', 4], ['vegetable broth', 4], ['bone broth', 4], ['stock', 4], ['broth', 4],
  ['yogurt', 7], ['cottage cheese', 7], ['ricotta', 5], ['mozzarella', 5], ['shredded cheese', 5], ['hummus', 7], ['salsa', 14],
  ['juice', 7], ['orange juice', 7], ['apple juice', 7], ['wine', 5], ['pasta sauce', 5], ['marinara', 5], ['tomato sauce', 5], ['tomato paste', 5],
  ['deli ham', 5], ['deli turkey', 5], ['lunch meat', 5], ['bacon', 7], ['hot dog', 7], ['tofu', 4],
  ['mayonnaise', 60], ['mayo', 60], ['ketchup', 180], ['mustard', 365], ['jam', 180], ['jelly', 180], ['pickles', 90], ['salad dressing', 60], ['bbq sauce', 120], ['maple syrup', 365]
].map(([k, d]) => [normalize(k), d]);
function guessOpenedDays(name) {
  const n = ` ${normalize(name)} `;
  const hit = OPENED_GUESS.filter(([k]) => n.includes(` ${k} `)).sort((a, b) => b[0].length - a[0].length)[0];
  return hit ? hit[1] : 0;
}
// 0 = opening doesn't matter for this item
const openedDaysOf = it => isNonFood(it) || isLeftover(it) ? 0 : it.openedDays != null ? (+it.openedDays || 0) : guessOpenedDays(it.name);
const isOpened = it => openedDaysOf(it) > 0 && !!it.openedAt && it.qty > 0;
// what the freshness border is measured against right now
function freshness(it) {
  if (isOpened(it)) return { days: Math.max(0, Math.floor((Date.now() - it.openedAt) / DAY)), limit: openedDaysOf(it), since: it.openedAt, opened: true };
  return { days: daysIn(it), limit: ageLimit(it), since: stockedAt(it), opened: false };
}
function ageState(it) {
  if (isNonFood(it) || it.qty <= 0) return '';
  const { days, limit } = freshness(it);
  return days >= 2 * limit ? 'old' : days >= limit ? 'aging' : '';
}
const fmtDays = d => d === 0 ? 'less than a day' : d === 1 ? '1 day' : `${d} days`;
const shortDays = d => d < 1 ? 'new' : d < 60 ? `${d}d` : d < 730 ? `${Math.floor(d / 30.4)}mo` : `${Math.floor(d / 365)}y`;

async function setQty(it, qty) {
  qty = Math.max(0, Math.round(qty * 10000) / 10000);   // keep precision: 2 oz from a 64 oz jug is 0.03125 of it
  if (it.openedFrom && qty <= 0) { await db.remove('items', it.id); return { ...it, qty: 0 }; }
  const patch = { ...it, qty };
  if (qty > lowAtOf(patch)) patch.lowDismissed = false;
  if (!LOCS.some(l => l.id === patch.location)) patch.location = locOf(it);
  if (!patch.createdAt) patch.createdAt = it.updatedAt || Date.now();
  // the time-in-inventory counter restarts when an item is restocked after running out
  if ((+it.qty || 0) <= 0 && qty > 0) { patch.stockedAt = Date.now(); patch.openedAt = null; }
  if (qty <= 0) patch.openedAt = null;
  else if (!patch.stockedAt) patch.stockedAt = stockedAt(it);
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
    ${list.map(x => `<button class="chip ${current === x.v ? 'on' : ''} ${x.n === 0 ? 'dim' : ''}" data-act="${act}" data-v="${esc(x.v)}">${esc(x.label)}${x.n != null ? ` <small>${x.n}</small>` : ''}</button>`).join('')}
  </div>`;
}

// Category → subcategory filter UI shared by Stock and Grocery.
function catFilter(list, mode, cId, subId, prefix, showAll = false) {
  if (mode !== 'cat') return '';
  const used = showAll ? cats() : cats().filter(c => list.some(x => x.category === c.id));
  let html = chipsRow(used.map(c => ({ v: c.id, label: `${c.icon} ${c.name}`, n: list.filter(x => x.category === c.id).length })), cId, `${prefix}Cat`, 'All categories');
  if (cId) {
    const inCat = list.filter(x => x.category === cId);
    const subs = cat(cId).subs.filter(s => showAll || inCat.some(x => x.sub === s));
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
function itemRow(it, elsewhere = false) {
  const c = cat(it.category);
  const age = ageState(it), d = daysIn(it);
  const fr = freshness(it);
  const ageTag = it.qty <= 0 || isNonFood(it) ? ''
    : fr.opened ? ` · <span class="age ${age}" title="Opened ${fmtDays(fr.days)} ago · good for ${fr.limit} days once opened">🔓 opened ${shortDays(fr.days)}</span>`
    : ` · <span class="age ${age}" title="In inventory for ${fmtDays(d)}">⏱ ${shortDays(d)}</span>${openedDaysOf(it) > 0 && !isOpenedCopy(it) ? ` <button class="open-link" data-act="markOpened" data-id="${it.id}" title="Open one: it moves to the fridge as its own item with a ${openedDaysOf(it)}-day timer">sealed · open one</button>` : ''}`;
  const copies = isOpenedCopy(it) ? [] : openedCopiesOf(it);
  return `<div class="row item ${isLow(it) ? 'low' : ''} ${it.qty <= 0 ? 'out' : ''} ${age}" data-act="openItem" data-id="${it.id}" draggable="true">
    <button class="star ${it.starred ? 'on' : ''}" data-act="star" data-id="${it.id}" aria-label="Star">★</button>
    ${it.photo ? thumb(it.photo) : ''}
    <div class="grow">
      <div class="name">${esc(it.name)}${isOpenedCopy(it) ? ' <span class="pill op">opened</span>' : ''}${copies.length ? ` <span class="pill op-count" title="Opened ones are listed separately in the fridge">+${copies.length} open</span>` : ''}</div>
      ${elsewhere ? `<div class="kept-tag">kept in the ${esc(loc(locOf(it)).name.toLowerCase())}</div>` : ''}
      <div class="meta">${isLeftover(it)
        ? `🍱 Leftovers · made ${new Date(stockedAt(it)).toLocaleDateString([], { month: 'short', day: 'numeric' })}${ageTag}`
        : `${c.icon} ${esc(it.sub || c.name)}${unitSummary(it) ? ' · ' + esc(unitSummary(it)) : ''}${it.price != null ? ' · ' + money(it.price) : ''}${it.link ? ' · 🔗' : ''}${ageTag}${isLow(it) ? ' · <b class="warn">running low</b>' : ''}`}</div>
    </div>
    <button class="move-btn" data-act="moveMenu" data-id="${it.id}" aria-label="Move to fridge, pantry or freezer" title="Move">⇄</button>
    ${isLeftover(it) ? `<div class="portion">
      <span class="q">${portionLeft(it.qty)}</span>
      <button class="btn small" data-act="useLeftover" data-id="${it.id}">Use…</button>
    </div>` : `<div class="stepper">
      <button data-act="dec" data-id="${it.id}" aria-label="Use one">−</button>
      <span class="q">${fmtQty(it.qty)}</span>
      <button data-act="inc" data-id="${it.id}" aria-label="Add one">+</button>
    </div>`}
  </div>`;
}

function viewStock() {
  let list = items();
  if (ui.starredOnly) list = list.filter(i => i.starred);
  const q = normalize(ui.stockSearch);
  if (q) list = list.filter(i => normalize(i.name).includes(q));
  const filterBar = catFilter(list, ui.stockMode, ui.stockCat, ui.stockSub, 'stock', true);
  const shown = ui.stockMode === 'cat' ? applyCatFilter(list, ui.stockCat, ui.stockSub) : list;
  const filtering = q || ui.starredOnly || (ui.stockMode === 'cat' && ui.stockCat);
  const none = !db.list('items').length;
  const inColumn = (l, list) => l.id === 'stovetop' ? list.filter(onStoveOf) : list.filter(it => locOf(it) === l.id);
  const part = id => {
    const l = loc(id), inLoc = inColumn(l, shown);
    const body = inLoc.length
      ? (ui.stockMode === 'cat' && !ui.stockCat ? grouped(inLoc, itemRow) : inLoc.map(it => itemRow(it)).join(''))
      : `<p class="col-empty">${filtering ? 'Nothing matches.' : 'Empty'}</p>`;
    return `<div class="fridge-part drop-zone part-${id}" data-loc="${id}">
      <header class="part-h"><span>${l.icon} ${l.id === 'fridge' ? 'Main fridge' : l.name}</span><small>${inLoc.length}</small></header>
      <div class="list">${body}</div>
      <button class="btn ghost small add-here" data-act="newItemAt" data-loc="${id}">＋ Add</button>
    </div>`;
  };
  const column = c => {
    if (c.parts) {
      const n = c.parts.reduce((a, id) => a + inColumn(loc(id), shown).length, 0);
      return `<section class="loc-col fridge-unit ${ui.stockLoc === c.id ? 'on' : ''}">
        <header class="loc-h"><span>${c.icon} ${c.name}</span><small>${n}</small></header>
        <div class="fridge-grid">${c.parts.map(part).join('')}</div>
      </section>`;
    }
    const l = loc(c.id);
    const inLoc = inColumn(l, shown);
    let body;
    if (l.id === 'stovetop') {
      const oils = inLoc.filter(isOil), spices = inLoc.filter(it => !isOil(it) && isSpice(it)), other = inLoc.filter(it => !isOil(it) && !isSpice(it));
      const row = it => itemRow(it, locOf(it) !== 'stovetop');
      body = inLoc.length
        ? [['🫒 Oils', oils], ['🧂 Spices', spices], ['Other', other]].filter(([, g]) => g.length).map(([h, g]) => `<h3 class="group-h">${h}</h3>${g.map(row).join('')}`).join('')
        : `<p class="col-empty">${filtering ? 'Nothing matches here.' : 'Oils show up here automatically, plus salt and pepper. Open any spice and tick “Also show on the stovetop”.'}</p>`;
    } else body = inLoc.length
      ? (ui.stockMode === 'cat' && !ui.stockCat ? grouped(inLoc, itemRow) : inLoc.map(it => itemRow(it)).join(''))
      : `<p class="col-empty">${filtering ? 'Nothing matches here.' : 'Nothing here yet.'}</p>`;
    return `<section class="loc-col drop-zone ${ui.stockLoc === l.id ? 'on' : ''}" data-loc="${l.id}">
      <header class="loc-h"><span>${l.icon} ${l.name}</span><small>${inLoc.length}</small></header>
      <div class="list">${body}</div>
      <button class="btn ghost small add-here" data-act="newItemAt" data-loc="${l.id}">＋ Add to ${l.name.toLowerCase()}</button>
    </section>`;
  };
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
    ${none ? `<p class="stock-hint muted">Nothing in stock yet. Add items to a column below, or <a href="#/scan">scan a list</a> to add a whole haul at once.</p>` : ''}
    <div class="seg full loc-switch">
      ${STOCK_COLS.map(c => { const l = c.parts ? c : loc(c.id); const n = c.parts ? c.parts.reduce((a, id) => a + inColumn(loc(id), shown).length, 0) : inColumn(l, shown).length;
        return `<button class="${ui.stockLoc === c.id ? 'on' : ''}" data-act="stockLoc" data-v="${c.id}">${l.icon} ${c.parts ? c.short : l.short} <small>${n}</small></button>`; }).join('')}
    </div>
    <div class="loc-cols">${STOCK_COLS.map(column).join('')}</div>
    <button class="fab" data-act="newItemAt" data-loc="${ui.stockLoc === 'fridgeunit' ? 'fridge' : ui.stockLoc}">＋ Add item</button>`;
}

const isNewCopyNote = it => isOpenedCopy(it) && db.get('items', it.openedFrom)
  ? `<p class="small muted copy-note">Opened from your sealed ${esc(it.name)} (${esc(totalText(db.get('items', it.openedFrom)))} still sealed).</p>` : '';

function itemSheet(it, prefill = null) {
  const isNew = !it;
  it = it || { id: uid(), name: '', qty: 1, unit: '', starred: false, category: ui.stockCat || 'other', sub: ui.stockSub && ui.stockSub !== 'Unsorted' ? ui.stockSub : '', photo: null, notes: '' };
  if (isNew && prefill) it = { ...it, ...(prefill.name ? { qty: 0, ...guessCategory(prefill.name) } : {}), ...prefill };
  let photo = it.photo;
  let where = isNew ? (prefill?.location || defaultLocation(it.category, it.sub)) : locOf(it);
  let whereTouched = !isNew || !!prefill?.location;
  let restockedAt = null;
  // Suggested recipes: ones you can make first, then fewest missing
  const recipes = isNew || isNonFood(it) ? [] : recipesUsing(it)
    .map(r => ({ r, st: recipeStatus(r) }))
    .sort((a, b) => a.st.missing.length - b.st.missing.length || a.r.title.localeCompare(b.r.title));
  const onList = st => st.missing.every(m => m.item ? groceryFor(m.item) : activeGrocery().some(g => normalize(g.name) === normalize(m.ing.name)));
  const recipesHtml = isNew || isNonFood(it) || (isPrepared(it) && !recipes.length) ? '' : `
    <div class="suggested">
    <h3 class="sec-h">Suggested recipes</h3>
    ${recipes.length ? recipes.map(({ r, st }) => `<div class="row recipe-mini" data-go="#/recipe/${r.id}">
        ${thumb(r.photo)}
        <div class="grow"><div class="name">${esc(r.title)}</div>
          <div class="meta">${st.canMake ? '<b class="ok">✓ You have everything</b>' : `<b class="warn">Missing:</b> ${esc(st.missing.map(m => m.ing.name).join(', '))}`}</div></div>
        ${st.canMake ? '' : onList(st)
          ? '<button class="btn small" disabled>✓ On the list</button>'
          : `<button class="btn small" data-addmissing="${r.id}">🛒 Add to grocery list</button>`}
      </div>`).join('') : `<p class="muted">No saved recipes use ${esc(it.name)} yet. <a href="#/recipe-edit/new" data-close>Add one</a>.</p>`}
    </div>`;
  const d = daysIn(it), lim = ageLimit(it), age = ageState(it), fr = freshness(it), od = openedDaysOf(it);
  const day = t => new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  const ageHtml = isNew ? '' : it.qty > 0 && fr.opened
    ? `<div class="age-box ${age}">
        <div><b>🔓 Opened <span data-age-days>${fmtDays(fr.days)}</span> ago</b>
          <span class="small muted">opened ${day(it.openedAt)} · ${age === 'old' ? 'well past' : age === 'aging' ? 'past' : 'good for'} ${od} days once opened · ${fmtDays(d)} in inventory</span></div>
        <div class="age-btns">${isOpenedCopy(it)
          ? `<button type="button" class="btn small primary" data-finish-open>✓ Finished it</button>${db.get('items', it.openedFrom) ? '<button type="button" class="btn small ghost" data-put-back>Put back unopened</button>' : ''}`
          : '<button type="button" class="btn small ghost" data-unopen>Mark unopened</button>'}</div>
      </div>`
    : it.qty <= 0
    ? `<div class="age-box"><b>Out of stock.</b> The time-in-inventory counter restarts when it's restocked.</div>`
    : `<div class="age-box ${age}">
        <div><b>In inventory: <span data-age-days>${fmtDays(d)}</span></b>
          <span class="small muted">since ${day(stockedAt(it))}${isNonFood(it) ? '' : ` · ${od > 0 ? 'unopened, ' : ''}${age === 'old' ? 'well past' : age === 'aging' ? 'past' : 'warns after'} ${lim} days`}</span></div>
        <div class="age-btns">
          ${!isNonFood(it) && !isLeftover(it) ? `<button type="button" class="btn small ${od > 0 ? 'primary' : 'ghost'}" data-mark-opened>🔓 Open one</button>` : ''}
          <button type="button" class="btn small ghost" data-restock>Restocked today</button>
        </div>
      </div>`;

  openSheet(`
    <h2>${isNew ? 'Add item' : esc(it.name)}</h2>
    ${ageHtml}
    ${!isNew && !isLeftover(it) && it.qty > 0 ? (() => {
      const opts = useUnits(it), u = unitOf(it), sz = sizeOf(it);
      const defUnit = useDefaultUnit(it);
      const have = availableQty(it);
      // quick amounts in kitchen measures for liquids/weighed food, otherwise fractions of one
      const chips = (VOLUMES[u] || (u === 'oz' && !WEIGHTS_ONLY(it))) ? [['1 Tbsp', 1, 'tbsp'], ['¼ cup', 0.25, 'cup'], ['½ cup', 0.5, 'cup'], ['1 cup', 1, 'cup']]
        : WEIGHTS[u] ? (/butter/i.test(it.name) ? [['1 Tbsp', 1, 'tbsp'], ['½ stick', 0.5, 'stick'], ['1 stick', 1, 'stick']] : [['1 oz', 1, 'oz'], ['4 oz', 4, 'oz'], ['8 oz', 8, 'oz'], ['1 lb', 1, 'lb']])
        : sz !== 1 ? [['¼', 0.25, 'each'], ['½', 0.5, 'each'], ['1', 1, 'each']] : [['1', 1, 'each'], ['2', 2, 'each']];
      const okChips = chips.filter(([, a, un]) => toPacks(it, a, un) <= have + 1e-9);
      return `<div class="use-box">
        <div class="use-head"><b>Used some?</b><span class="small muted">${esc(totalText(it))} in stock</span></div>
        <div class="use-row">
          <input data-use-amt type="text" inputmode="decimal" placeholder="1" aria-label="Amount used">
          <select data-use-unit aria-label="Unit">${opts.map(o => `<option value="${o.v}" ${o.v === defUnit ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
          <button type="button" class="btn primary small" data-use-go>Mark used</button>
        </div>
        ${okChips.length ? `<div class="use-chips">${okChips.map(([l, a, un]) => `<button type="button" class="chip" data-use-quick="${a}" data-use-qunit="${un}">${esc(l)}</button>`).join('')}</div>` : ''}
        ${(it.usage || []).length ? `<details class="use-log"><summary>Recent use (${it.usage.length})</summary><ul>
          ${it.usage.slice(0, 10).map(e => `<li><span>${fmtWhen(e.at)}</span> ${esc(e.by || '?')} used <b>${esc(e.label)}</b>${e.recipe ? ` for ${esc(e.recipe)}` : ''}</li>`).join('')}
        </ul></details>` : ''}
      </div>`;
    })() : ''}
    ${!isNew && !isOpenedCopy(it) && openedCopiesOf(it).length ? `<div class="open-copies">${openedCopiesOf(it).map(c => `<button type="button" class="open-copy" data-open-copy="${c.id}">🔓 ${esc(totalText(c))} opened ${fmtDays(freshness(c).days)} ago · in the ${esc(loc(locOf(c)).name.toLowerCase())} ›</button>`).join('')}</div>` : ''}
    ${isNewCopyNote(it)}
    ${isLeftover(it) ? `<div class="leftover-box">
      <div>🍱 Leftovers from ${db.get('recipes', it.recipeId) ? `<a href="#/recipe/${it.recipeId}" data-close>${esc(db.get('recipes', it.recipeId).title)}</a>` : 'a recipe'} · <b>${portionLeft(it.qty)}</b></div>
      <button type="button" class="btn small primary" data-uselo>Use ¼ / ½ / finish…</button>
    </div>` : ''}
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
        <label>How many
          <input data-f="qty" type="text" inputmode="decimal" value="${fmtQty(it.qty)}" autocomplete="off" aria-describedby="qty-help">
          <span class="qty-quick">${[['¼', .25], ['½', .5], ['¾', .75], ['1', 1]].map(([l, v]) => `<button type="button" class="chip" data-setqty="${v}">${l}</button>`).join('')}</span>
          <span class="field-note" id="qty-help">Fractions work: 1/2, 1 1/2, ½ or 0.5</span>
        </label>
        <label>Size of one <span class="opt-tag">(optional)</span>
          <span class="size-in">
            <input data-f="size" type="text" inputmode="decimal" value="${it.unit ? fmtQty(sizeOf(it)) : ''}" placeholder="1" aria-label="Amount in one">
            <input data-f="unit" value="${esc(it.unit || '')}" placeholder="lb, oz, can…" list="unit-list-item" autocomplete="off" aria-label="Unit">
          </span>
        </label>
      </div>
      <p class="total-line" data-total></p>
      <datalist id="unit-list-item">${['lb', 'oz', 'g', 'kg', 'fl oz', 'cup', 'tbsp', 'tsp', 'L', 'ml', 'gal', 'qt', 'pt', 'stick', 'can', 'bag', 'box', 'pack', 'bottle', 'jar', 'carton', 'loaf'].map(u => `<option value="${u}">`).join('')}</datalist>
      <div class="cuisine-field" ${isSpice(it) ? '' : 'hidden'}>
        <div class="field-label">Cuisines</div>
        <div class="cuisine-pick">${[...CUISINES, ...cuisinesOf(it).filter(c => !CUISINES.includes(c))].map(c => `<button type="button" class="chip ${cuisinesOf(it).includes(c) ? 'on' : ''}" data-cuisine="${esc(c)}">${esc(c)}</button>`).join('')}</div>
        <input data-f="cuisineOther" placeholder="Other cuisines (comma separated)" autocomplete="off">
      </div>
      <label class="check-line stove-line" ${isSpice(it) || isOil(it) ? '' : 'hidden'}><input type="checkbox" data-f="onStove" ${onStoveOf(it) && locOf(it) !== 'stovetop' || it.onStove ? 'checked' : ''}> 🍳 Also show on the stovetop</label>
      <div class="field-label">Kept in</div>
      <div class="seg full loc-pick">${LOCS.map(l => `<button type="button" data-where="${l.id}" class="${where === l.id ? 'on' : ''}">${l.icon} ${l.name}</button>`).join('')}</div>
      <div class="two shelf-life warn-days" ${isNonFood(it) ? 'hidden' : ''}>
        <label>Good for, unopened (days)
          <input data-f="warnDays" type="number" min="1" step="1" inputmode="numeric" value="${+it.warnDays > 0 ? +it.warnDays : ''}" placeholder="${ageDays()[where]} — ${loc(where).name.toLowerCase()} default">
        </label>
        <label>Once opened, good for (days)
          <input data-f="openedDays" type="number" min="0" step="1" inputmode="numeric" value="${it.openedDays != null ? +it.openedDays : ''}" placeholder="${!isLeftover(it) && guessOpenedDays(it.name) ? `${guessOpenedDays(it.name)} — typical` : 'leave empty if it doesn’t matter'}">
        </label>
      </div>
      ${priceLinkFields(it.price, it.link, it.priceAt)}
      <div class="check-line star-line"><label class="inline"><input type="checkbox" data-f="starred" ${it.starred ? 'checked' : ''}> ★ Starred</label>
        <span>— suggest for the grocery list when
          <input data-f="lowAt" type="text" inputmode="decimal" class="low-in" value="${it.lowAt != null ? fmtQty(+it.lowAt) : ''}" placeholder="${fmtQty(lowDefault())}" aria-label="Running-low level">
          or fewer are left</span></div>
      <label class="check-line prep-line" ${isNonFood(it) ? 'hidden' : ''}><input type="checkbox" data-f="prepared" ${!isNonFood(it) && isPrepared(it) ? 'checked' : ''}> Prepared / ready-to-eat (no recipe suggestions)</label>
      <label>Notes<input data-f="notes" value="${esc(it.notes || '')}" placeholder="Where it's kept, brand…"></label>
    </div>
    <div class="row-end">
      ${isNew ? '' : isLeftover(it) ? `<button class="btn ghost danger" data-toss>🗑 Throw out…</button>` : `<button class="btn ghost danger" data-del>Delete</button><button class="btn ghost" data-tolist>🛒 Add to list</button>`}
      <button class="btn primary" data-save>Save</button>
    </div>
    ${recipesHtml}`, {
    onMount(s, close) {
      const f = k => s.querySelector(`[data-f="${k}"]`);
      const setWhere = w => {
        where = w;
        s.querySelectorAll('[data-where]').forEach(b => b.classList.toggle('on', b.dataset.where === w));
        f('warnDays').placeholder = `${ageDays()[w]} — ${loc(w).name.toLowerCase()} default`;
      };
      const syncPrep = () => {
        const nf = !!cat(f('category').value).nonFood;
        s.querySelector('.prep-line').hidden = nf;
        s.querySelector('.warn-days').hidden = nf;
        if (!whereTouched) setWhere(defaultLocation(f('category').value, f('sub').value, f('name').value));
      };
      s.querySelectorAll('[data-where]').forEach(b => b.onclick = () => { whereTouched = true; setWhere(b.dataset.where); });
      f('category').onchange = () => { f('sub').innerHTML = subOptions(f('category').value, ''); syncPrep(); };
      f('sub').addEventListener('change', syncPrep);
      const reopen = () => { close(); itemSheet(db.get('items', it.id)); };
      s.querySelector('[data-mark-opened]')?.addEventListener('click', async () => {
        const typed = parseInt(f('openedDays').value);
        const snap = snapshotFamily(it.id);
        const c = await openOne(it.id, typed > 0 ? typed : null);
        if (!c) return;
        toast(`Opened one ${it.name} — it's in the fridge, good for ${c.openedDays} days`, [{ label: 'Undo', run: () => restoreFamily(snap) }]);
        reopen();
      });
      s.querySelectorAll('[data-open-copy]').forEach(b => b.addEventListener('click', () => { close(); itemSheet(db.get('items', b.dataset.openCopy)); }));
      s.querySelector('[data-finish-open]')?.addEventListener('click', async () => {
        const snap = snapshotFamily(it.id);
        const cur = db.get('items', it.id);
        if (cur.qty > 0) await consume(cur.id, cur.qty, `the rest (${useLabel(cur, cur.qty)})`);
        close();
        toast(`${it.name} finished`, [{ label: 'Undo', run: () => restoreFamily(snap) }]);
      });
      s.querySelector('[data-put-back]')?.addEventListener('click', async () => {
        const cur = db.get('items', it.id), p = db.get('items', it.openedFrom);
        await db.put('items', { ...p, qty: Math.round((p.qty + cur.qty) * 1000) / 1000 });
        await db.remove('items', cur.id);
        close();
        toast(`${it.name} put back as unopened`);
      });
      s.querySelector('[data-unopen]')?.addEventListener('click', async () => {
        await db.put('items', { ...db.get('items', it.id), openedAt: null });
        reopen();
      });
      s.querySelector('[data-restock]')?.addEventListener('click', e => {
        restockedAt = Date.now();
        s.querySelector('[data-age-days]').textContent = fmtDays(0);
        s.querySelector('.age-box').className = 'age-box';
        e.target.textContent = '✓ Counter reset — tap Save';
        e.target.disabled = true;
      });
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
          syncPrep();
        });
      }
      s.querySelector('[data-save]').onclick = async () => {
        const name = f('name').value.trim();
        if (!name) return f('name').focus();
        const category = f('category').value;
        const prepared = f('prepared').checked;
        const price = parsePrice(f('price').value);
        await setQty({
          ...it, name, category, sub: f('sub').value, notes: f('notes').value.trim(),
          unit: normUnit(f('unit').value), size: normUnit(f('unit').value) && parseAmount(f('size').value) > 0 ? parseAmount(f('size').value) : 1,
          price, priceAt: price === (it.price ?? null) ? it.priceAt : (price == null ? null : Date.now()),
          link: cleanLink(f('link').value),
          starred: f('starred').checked, photo,
          lowAt: f('lowAt').value.trim() === '' || isNaN(qtyIn(f('lowAt').value)) ? null : qtyIn(f('lowAt').value),
          location: where,
          ...(isSpice({ category, sub: f('sub').value }) || isOil({ name, category }) ? { onStove: f('onStove').checked } : {}),
          ...(isSpice({ category, sub: f('sub').value }) ? { cuisines: [...new Set([...cuis, ...f('cuisineOther').value.split(',').map(x => x.trim()).filter(Boolean)])] } : {}),
          warnDays: parseInt(f('warnDays').value) > 0 ? parseInt(f('warnDays').value) : null,
          openedDays: f('openedDays').value.trim() === '' ? null : Math.max(0, parseInt(f('openedDays').value) || 0),
          ...(restockedAt ? { stockedAt: restockedAt } : {}),
          prepared: cat(category).nonFood || prepared === !!cat(category).prepared ? undefined : prepared
        }, isNaN(qtyIn(f('qty').value)) ? (+it.qty || 0) : qtyIn(f('qty').value));
        close();
        toast(isNew ? `Added ${name}` : `Saved ${name}`);
      };
      s.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (await confirmSheet('Delete item?', `<p>Remove <b>${esc(it.name)}</b> from stock?</p>`, 'Delete')) {
          await db.remove('items', it.id); close();
        }
      });
      // cuisines (spices only)
      let cuis = [...cuisinesOf(it)];
      s.querySelectorAll('[data-cuisine]').forEach(b => b.onclick = () => {
        const c = b.dataset.cuisine;
        cuis = cuis.includes(c) ? cuis.filter(x => x !== c) : [...cuis, c];
        b.classList.toggle('on', cuis.includes(c));
      });
      const syncSpice = () => {
        const sp = isSpice({ category: f('category').value, sub: f('sub').value });
        s.querySelector('.cuisine-field').hidden = !sp;
        if (sp && !cuis.length && isNew) {
          cuis = guessCuisines(f('name').value);
          s.querySelectorAll('[data-cuisine]').forEach(b => b.classList.toggle('on', cuis.includes(b.dataset.cuisine)));
        }
      };
      const syncStove = () => {
        const show = isSpice({ category: f('category').value, sub: f('sub').value }) || isOil({ name: f('name').value, category: f('category').value });
        s.querySelector('.stove-line').hidden = !show;
        if (show && isNew && it.onStove == null) f('onStove').checked = isOil({ name: f('name').value, category: f('category').value }) || STOVE_SPICES.test(normalize(f('name').value));
      };
      ['sub', 'category', 'name'].forEach(k => f(k).addEventListener('change', () => setTimeout(syncStove, 0)));
      f('sub').addEventListener('change', syncSpice);
      f('category').addEventListener('change', syncSpice);
      f('name').addEventListener('change', () => setTimeout(syncSpice, 0));
      const doUse = async (packs, typed) => {
        if (!(packs > 0)) return s.querySelector('[data-use-amt]').focus();
        const cur = db.get('items', it.id), have = availableQty(cur);
        if (packs >= have - 1e-9) {
          const what = isOpenedCopy(cur) ? `the opened ${cur.name}` : `all of your ${cur.name}`;
          const ok = await confirmSheet(packs > have + 1e-9 ? 'More than you have' : 'Use it all up?',
            `<p>${esc(typed || useLabel(cur, packs))} is ${packs > have + 1e-9 ? 'more than' : 'all of'} ${esc(what)} (${esc(totalText(cur, have))}). It will be marked as finished.</p><p class="small muted">Meant a smaller amount? Cancel and check the unit next to the number.</p>`,
            'Yes, it’s finished');
          if (!ok) return;
          packs = have;
        }
        // remember the unit for next time
        const un = s.querySelector('[data-use-unit]')?.value;
        if (un && un !== cur.lastUseUnit && !typed?.startsWith?.('the rest')) db.put('items', { ...cur, lastUseUnit: un });
        const before = db.get('items', it.id);
        const snap = snapshotFamily(it.id);
        const hadOpen = openedCopiesOf(before).length;
        const label = typed || useLabel(before, packs);
        await consume(it.id, packs, label);
        close();
        const after = db.get('items', it.id);
        const opened = !isOpenedCopy(before) && openedDaysOf(before) > 0;
        toast(`Used ${label} of ${before.name}${opened && !hadOpen ? ' — opened one, now in the fridge' : ''}`, [{ label: 'Undo', run: () => restoreFamily(snap) }]);
        const base = db.get('items', before.openedFrom || before.id);
        if (base && isLow(base) && !groceryFor(base)) setTimeout(() => toast(`${base.name} is running low — suggested on the grocery list`), 400);
        if (after) itemSheet(after);
      };
      s.querySelector('[data-use-go]')?.addEventListener('click', () => {
        const a = parseAmount(s.querySelector('[data-use-amt]').value);
        const un = s.querySelector('[data-use-unit]').value;
        doUse(isNaN(a) ? 0 : toPacks(it, a, un), isNaN(a) ? '' : un === 'each' ? useLabel(it, a) : `${fmtQty(a)} ${un === 'tbsp' ? 'Tbsp' : un}`);
      });
      s.querySelector('[data-use-amt]')?.addEventListener('keydown', e => { if (e.key === 'Enter') s.querySelector('[data-use-go]').click(); });
      s.querySelectorAll('[data-use-quick]').forEach(b => b.addEventListener('click', () => doUse(toPacks(it, +b.dataset.useQuick, b.dataset.useQunit), b.textContent)));
      const showTotal = () => {
        const q = qtyIn(f('qty').value) || 0, u = normUnit(f('unit').value), sz = parseAmount(f('size').value);
        const one = sz > 0 ? sz : 1;
        s.querySelector('[data-total]').innerHTML = u
          ? `Total: <b>${fmtQty(q)}</b> × ${esc(amt(one, u))} = <b>${esc(amt(Math.round(q * one * 100) / 100, u))}</b>`
          : `<span class="muted">Add a size (e.g. 1 lb, 12 oz, 1 can) to see the total amount.</span>`;
      };
      ['qty', 'size', 'unit'].forEach(k => f(k).addEventListener('input', showTotal));
      s.querySelectorAll('[data-setqty]').forEach(b => b.onclick = () => { f('qty').value = b.dataset.setqty; showTotal(); });
      f('qty').addEventListener('change', () => { const v = qtyIn(f('qty').value); f('qty').classList.toggle('bad', isNaN(v)); });
      f('lowAt').addEventListener('focus', () => { if (!f('starred').checked) f('starred').checked = true; });
      showTotal();
      s.querySelector('[data-uselo]')?.addEventListener('click', () => { close(); useLeftoverSheet(db.get('items', it.id)); });
      s.querySelector('[data-toss]')?.addEventListener('click', () => { close(); finishLeftover(db.get('items', it.id), 'toss'); });
      s.querySelector('[data-tolist]')?.addEventListener('click', async () => {
        if (groceryFor(it)) return toast(`${it.name} is already on the list`);
        await addToGrocery({ name: it.name, itemId: it.id }); toast(`Added ${it.name} to the grocery list`);
      });
      s.addEventListener('click', async e => {
        const am = e.target.closest('[data-addmissing]');
        if (am) {
          e.stopPropagation();
          await addMissing(db.get('recipes', am.dataset.addmissing));
          am.textContent = '✓ On the list'; am.disabled = true;
          return;
        }
        const go = e.target.closest('[data-go]');
        if (go) { close(); location.hash = go.dataset.go; }
        if (e.target.closest('[data-close]')) close();
      });
    }
  });
}

// ---------------- moving between Fridge / Pantry / Deep freezer ----------------
async function moveItem(it, to) {
  if (!it || locOf(it) === to) return;
  const from = locOf(it);
  await db.put('items', { ...it, location: to });
  toast(`Moved ${it.name} to the ${loc(to).name.toLowerCase()}`, [{
    label: 'Undo', run: () => db.put('items', { ...db.get('items', it.id), location: from })
  }]);
}

function moveSheet(it) {
  if (!it) return;
  const here = locOf(it);
  openSheet(`<h2>Move ${esc(it.name)}</h2>
    <p class="muted small">Now in the ${esc(loc(here).name.toLowerCase())}. The time-in-inventory counter keeps running; tap “Restocked today” on the item if you want it to start over.</p>
    <div class="move-opts">
      ${LOCS.map(l => `<button class="btn big ${l.id === here ? 'here' : ''}" data-to="${l.id}" ${l.id === here ? 'disabled' : ''}>
        <span class="mo-icon">${l.icon}</span>${l.name}${l.id === here ? '<small>here now</small>' : ''}</button>`).join('')}
    </div>`, {
    onMount(s, close) {
      s.querySelectorAll('[data-to]').forEach(b => b.onclick = async () => { close(); await moveItem(db.get('items', it.id), b.dataset.to); });
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
      <p class="muted">Take a photo of your list — one item per line, with a quantity if you like: “2x milk”, “ground beef 1x”, “1/4 lb deli ham”, “1 1/2 lb chicken”, “12 oz cheddar”, “3 cans beans”. You'll check everything before stock changes.</p>
      <div class="big-actions">
        <label class="btn primary big">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden data-change="scanFile"></label>
        <label class="btn big">🖼 Choose photo<input type="file" accept="image/*" hidden data-change="scanFile"></label>
      </div>
      ${S.apiKey ? `<p class="small muted">Reading with: ${engine}.</p>` : `<p class="scan-note"><b>Handwritten list?</b> The free reader only handles neat printed text. <a href="#/settings">Add a Claude API key</a> to read handwriting.</p>`}
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
    const delta = cur ? amountFor(r, cur.unit, sizeOf(cur)) : r.qty;
    const after = !cur ? r.qty : sc.mode === 'add' ? cur.qty + delta : sc.mode === 'use' ? Math.max(0, cur.qty - delta) : delta;
    // explain units: "120 oz = 10 × 12 oz", "2 lb → 2 (no size set)", "new: 10 × 12 oz"
    const nw = newItemUnits(r);
    const conv = !cur ? (nw.unit ? `new: ${fmtQty(nw.qty)} × ${amt(nw.size, nw.unit)}` : '')
      : r.unit ? (unitOf(cur) ? `${amt(r.qty, r.unit)} = ${fmtQty(delta)} × ${amt(sizeOf(cur), unitOf(cur))}` : `counted as ${fmtQty(delta)}`) : '';
    return `<div class="scan-row ${r.skip ? 'skipped' : ''}">
      <label class="check"><input type="checkbox" data-scan="skip" data-i="${i}" ${r.skip ? '' : 'checked'}><span></span></label>
      <div class="grow">
        <div class="scan-qty-row">
          <input data-scan="name" data-i="${i}" value="${esc(r.name)}" list="inv-names" aria-label="Name">
          <input data-scan="qty" data-i="${i}" type="text" inputmode="decimal" value="${fmtQty(r.qty)}" aria-label="Quantity" class="qty-in">
          <input data-scan="unit" data-i="${i}" value="${esc(r.unit || '')}" placeholder="unit" list="unit-list" aria-label="Unit" class="unit-in" autocomplete="off">
        </div>
        <div class="two tight">
          <select data-scan="match" data-i="${i}" aria-label="Matches">
            <option value="new" ${r.match === 'new' ? 'selected' : ''}>➕ New item</option>
            ${all.map(it => `<option value="${it.id}" ${r.match === it.id ? 'selected' : ''}>${esc(it.name)} (${fmtQty(it.qty)}${it.unit ? ' ' + esc(it.unit) : ''})</option>`).join('')}
          </select>
          ${r.match === 'new' ? `<select data-scan="category" data-i="${i}">${catOptions(r.category)}</select>` : `<span class="after">→ <b>${fmtQty(after)}</b>${unitOf(cur) ? ` <small>(${esc(totalText(cur, after))})</small>` : ''}</span>`}
        </div>
        <div class="raw">“${esc(r.raw)}”${conv ? ` <span class="conv">${esc(conv)}</span>` : ''}</div>
      </div>
    </div>`;
  }).join('');
  return `
    <div class="card">
      <div class="scan-head">
        ${sc.photo ? `<img class="scan-thumb" src="${sc.photo}" alt="" data-act="viewScanPhoto">` : ''}
        <div><h2>Check the list</h2><p class="muted small">${sc.rows.length} line${sc.rows.length === 1 ? '' : 's'} found. Fix anything that was misread, then apply.</p></div>
      </div>
      ${sc.unreadable ? `<div class="scan-warn">
        <b>⚠️ The free reader couldn't read this photo${sc.dropped ? ` — ${sc.dropped} unreadable line${sc.dropped > 1 ? 's were' : ' was'} skipped` : ''}.</b>
        <p>It only reads neat printed text, not handwriting. For handwritten lists, add a Claude API key in Settings (a few cents per photo), or type the list instead.</p>
        <div class="row-end"><a class="btn small" href="#/settings">Open Settings</a><button class="btn small ghost" data-act="scanReset">Type the list</button></div>
      </div>` : ''}
      <div class="seg full">
        <button class="${sc.mode === 'add' ? 'on' : ''}" data-act="scanMode" data-v="add">Add to stock</button>
        <button class="${sc.mode === 'set' ? 'on' : ''}" data-act="scanMode" data-v="set">Set counts</button>
        <button class="${sc.mode === 'use' ? 'on' : ''}" data-act="scanMode" data-v="use">Used up</button>
      </div>
      <div class="scan-rows">${rows || '<p class="muted">No items found — try a clearer photo, or type the list.</p>'}</div>
      <button class="btn ghost small" data-act="scanAddRow">＋ Add a line</button>
      <datalist id="unit-list">${['lb', 'oz', 'g', 'kg', 'fl oz', 'cup', 'tbsp', 'tsp', 'L', 'ml', 'gal', 'qt', 'stick', 'can', 'bag', 'box', 'pack', 'bottle', 'jar', 'carton'].map(u => `<option value="${u}">`).join('')}</datalist>
      <div class="row-end">
        <button class="btn ghost" data-act="scanReset">Start over</button>
        <button class="btn primary" data-act="scanApply">Apply ${sc.rows.filter(r => !r.skip).length} items</button>
      </div>
    </div>
    ${invDatalist()}`;
}

// A scanned line becomes "how many × size of one": "10x 12 oz corn" = 10 × 12 oz, "1/2 lb hazelnuts" = 1 × ½ lb
function newItemUnits(r) {
  if (isMeasure(r.unit)) { const n = r.count > 0 ? r.count : 1; return { qty: n, size: Math.round(r.qty / n * 1000) / 1000, unit: r.unit }; }
  return { qty: r.qty, size: 1, unit: r.unit || '' };
}

function scanRowsFrom(parsed) {
  return parsed.map(p => {
    const m = bestMatch(p.name, db.list('items').filter(i => !i.openedFrom), 0.6);
    const g = guessCategory(p.name);
    return { ...p, match: m ? m.id : 'new', category: g.category, sub: g.sub, skip: false };
  });
}

async function runScan(file) {
  const photo = await compressImage(file, 1600, 0.85);
  ui.scan = { stage: 'reading', photo, progress: 0, mode: 'add' };
  render();
  try {
    let parsed, unreadable = false, dropped = 0;
    if (S.apiKey) parsed = await readWithClaude(photo, { apiKey: S.apiKey, model: S.model, knownNames: items().map(i => i.name) });
    else ({ rows: parsed, unreadable, dropped } = await readWithTesseract(photo, p => { ui.scan.progress = p; if (route().name === 'scan') render(); }));
    ui.scan = { stage: 'review', photo: await compressImage(file, 500), rows: scanRowsFrom(parsed), mode: 'add', unreadable, dropped };
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
      const d = amountFor(r, cur.unit, sizeOf(cur));
      const q = sc.mode === 'add' ? cur.qty + d : sc.mode === 'use' ? cur.qty - d : d;
      await setQty(cur, q); updated++;
    } else {
      if (sc.mode === 'use') continue;
      await db.put('items', { id: uid(), name: r.name.trim(), ...newItemUnits(r), category: r.category, sub: r.sub || '', location: defaultLocation(r.category, r.sub, r.name), starred: false, photo: null, createdAt: Date.now(), stockedAt: Date.now() });
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
  const price = groceryPrice(g), link = groceryLink(g);
  return `<div class="row g ${g.done ? 'done' : ''}">
    <label class="check"><input type="checkbox" data-change="toggleDone" data-id="${g.id}" ${g.done ? 'checked' : ''}><span></span></label>
    ${g.photo ? thumb(g.photo, 'thumb', 'viewPhoto') : ''}
    <div class="grow" data-act="editGrocery" data-id="${g.id}">
      <div class="name">${esc(g.name)}${g.qty > 1 ? ` <span class="x">×${fmtQty(g.qty)}</span>` : ''}${price != null ? ` <span class="price">~${money(price)}</span>` : ''}</div>
      <div class="meta">${c.icon} ${esc(g.sub || c.name)} · ${g.done ? `got by ${esc(g.doneBy || '?')} ${fmtWhen(g.doneAt)}` : `${esc(g.addedBy || '?')}, ${fmtWhen(g.addedAt)}`}${g.note ? ` · <i>${esc(g.note)}</i>` : ''}</div>
    </div>
    ${link ? `<a class="buy-link" href="${esc(link)}" target="_blank" rel="noopener" title="Buy at ${esc(linkHost(link))}" aria-label="Open buy link">🔗</a>` : ''}
  </div>`;
}

function suggestionRow(it) {
  return `<div class="row g ghost-row">
    <span class="ghost-dot">★</span>
    <div class="ghost-open" data-act="openItem" data-id="${it.id}" title="See details">
      ${it.photo ? thumb(it.photo) : ''}
      <div class="grow">
        <div class="name">${esc(it.name)} <span class="chev">›</span></div>
        <div class="meta">Only ${esc(totalText(it))} left${unitOf(it) && !(sizeOf(it) === 1 && !WEIGHTS[unitOf(it)]) ? ` (${esc(eachText(it))})` : ''} · ${esc(loc(locOf(it)).name)}</div>
      </div>
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
      ${ui.showDone ? `<div class="list">${done.map(groceryRow).join('')}</div>` : ''}` : ''}
    ${totalBar(active)}`;
}

function totalBar(active) {
  const prices = active.map(groceryPrice);
  const priced = prices.filter(p => p != null);
  if (!priced.length) return '';
  const missing = prices.length - priced.length;
  const total = priced.reduce((a, b) => a + b, 0);
  return `<div class="total-bar">
    <span>Estimated total${missing ? `<small>${missing} item${missing > 1 ? 's' : ''} without a price</small>` : ''}</span>
    <b>${money(total)}</b>
  </div>`;
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
          await db.put('items', { id, name: g.name, qty: g.qty || 1, unit: '', category: g.category, sub: g.sub || '', location: defaultLocation(g.category, g.sub, g.name), createdAt: Date.now(), stockedAt: Date.now(), starred: false, photo: g.photo || null, price: g.price ?? null, priceAt: g.price != null ? Date.now() : null, link: g.link || '' });
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
  const it = itemForGrocery(g);
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
        <label>Quantity<input data-f="qty" type="text" inputmode="decimal" value="${fmtQty(g.qty)}"></label>
        <label>Note<input data-f="note" value="${esc(g.note || '')}"></label>
      </div>
      ${priceLinkFields(it ? it.price : g.price, it ? it.link : g.link, it ? it.priceAt : g.priceAt)}
      <p class="small muted">${it ? `Price and link are saved on <b>${esc(it.name)}</b> in Stock, so they're remembered next time. ` : ''}Added by ${esc(g.addedBy || '?')} · ${fmtWhen(g.addedAt)}</p>
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
        const price = parsePrice(f('price').value), link = cleanLink(f('link').value);
        const upd = { ...g, name: f('name').value.trim() || g.name, category: f('category').value, sub: f('sub').value, qty: qtyIn(f('qty').value) || 1, note: f('note').value.trim(), photo };
        if (it) {
          const cur = db.get('items', it.id);
          if (price !== (cur.price ?? null) || link !== (cur.link || ''))
            await db.put('items', { ...cur, price, link, priceAt: price === (cur.price ?? null) ? cur.priceAt : (price == null ? null : Date.now()) });
        } else Object.assign(upd, { price, link, priceAt: price === (g.price ?? null) ? g.priceAt : Date.now() });
        await db.put('grocery', upd);
        close();
      };
      s.querySelector('[data-del]').onclick = async () => { await db.remove('grocery', g.id); close(); };
    }
  });
}

async function addMissing(r, scale = 1) {
  if (!r) return;
  const { missing } = recipeStatus(r, scale);
  let n = 0;
  for (const m of missing) {
    const it = m.item;
    if (it ? groceryFor(it) : activeGrocery().some(g => normalize(g.name) === normalize(m.ing.name))) continue;
    const short = it ? Math.max(1, Math.ceil(m.need - it.qty)) : Math.ceil(m.need);
    await addToGrocery({ name: it ? it.name : m.ing.name, qty: short, itemId: it?.id, note: `for ${r.title}${scale !== 1 ? ` (${scaleLabel(scale)})` : ''}` });
    n++;
  }
  toast(n ? `Added ${n} item${n > 1 ? 's' : ''} to the grocery list` : 'Everything missing is already on the list');
}

// ---------------- Spices ----------------
function spiceRow(it) {
  const st = spiceStats(it), cu = cuisinesOf(it);
  return `<div class="row item spice ${it.qty <= 0 ? 'out' : ''}" data-act="openItem" data-id="${it.id}">
    ${thumb(it.photo)}
    <div class="grow">
      <div class="name">${esc(it.name)}</div>
      <div class="meta">${cu.length ? cu.map(c => `<span class="tag">${esc(c)}</span>`).join(' ') : '<span class="muted">no cuisine set</span>'}</div>
      <div class="meta">${st.count ? `used ${st.count}×${st.last ? `, last ${fmtWhen(st.last).replace(/ \d+:\d+.*/, '')}` : ''}` : 'not used yet'}${st.recipes ? ` · in ${st.recipes} recipe${st.recipes > 1 ? 's' : ''}` : ''}</div>
    </div>
    <div class="spice-side">
      <div class="spice-amt">${it.qty <= 0 ? '<b class="warn">out</b>' : esc(totalText(it))}</div>
      <button class="stove-btn ${onStoveOf(it) ? 'on' : ''}" data-act="toggleStove" data-id="${it.id}" title="${onStoveOf(it) ? 'Shown on the stovetop — tap to remove' : 'Show on the stovetop'}">🍳 ${onStoveOf(it) ? 'on stovetop' : 'stovetop?'}</button>
    </div>
  </div>`;
}

function viewSpices() {
  const q = normalize(ui.spiceSearch);
  let list = items().filter(isSpice);
  if (q) list = list.filter(i => normalize(i.name).includes(q) || cuisinesOf(i).some(c => normalize(c).includes(q)));
  const sort = ui.spiceSort;
  let body;
  if (!items().some(isSpice)) body = `<div class="empty"><p>No spices yet.</p><p>Add them here, or any item in Pantry → Spices shows up on this tab.</p></div>`;
  else if (!list.length) body = `<div class="empty"><p>Nothing matches.</p></div>`;
  else if (sort === 'cuisine') {
    const used = [...CUISINES, ...new Set(list.flatMap(cuisinesOf).filter(c => !CUISINES.includes(c)))].filter(c => list.some(i => cuisinesOf(i).includes(c)));
    const none = list.filter(i => !cuisinesOf(i).length);
    const chips = chipsRow(used.map(c => ({ v: c, label: c, n: list.filter(i => cuisinesOf(i).includes(c)).length })), ui.spiceCuisine, 'spiceCuisine', 'All cuisines');
    const groups = (ui.spiceCuisine ? [ui.spiceCuisine] : used).map(c => {
      const inC = list.filter(i => cuisinesOf(i).includes(c)).sort((a, b) => spiceStats(b).count - spiceStats(a).count || a.name.localeCompare(b.name));
      return inC.length ? `<h3 class="group-h">${esc(c)}</h3>${inC.map(spiceRow).join('')}` : '';
    }).join('') + (!ui.spiceCuisine && none.length ? `<h3 class="group-h">No cuisine set</h3>${none.map(spiceRow).join('')}` : '');
    body = chips + groups;
  } else {
    const sorted = [...list].sort(sort === 'qty'
      ? (a, b) => stockAmount(b) - stockAmount(a) || a.name.localeCompare(b.name)
      : (a, b) => spiceStats(b).count - spiceStats(a).count || spiceStats(b).last - spiceStats(a).last || a.name.localeCompare(b.name));
    body = sorted.map(spiceRow).join('');
  }
  return `
    <div class="toolbar">
      <input id="spice-search" type="search" placeholder="Search spices or cuisines…" value="${esc(ui.spiceSearch)}" data-input="spiceSearch">
      <div class="seg full">
        <button class="${sort === 'used' ? 'on' : ''}" data-act="spiceSort" data-v="used">Most used</button>
        <button class="${sort === 'cuisine' ? 'on' : ''}" data-act="spiceSort" data-v="cuisine">Cuisine</button>
        <button class="${sort === 'qty' ? 'on' : ''}" data-act="spiceSort" data-v="qty">Most in stock</button>
      </div>
    </div>
    <div class="list">${body}</div>
    <button class="fab" data-act="newSpice">＋ Add spice</button>`;
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
      <div class="toolbar-row">
        <button class="chip ${ui.canMakeOnly ? 'on' : ''}" data-act="canMakeOnly">✓ Can make now</button>
        <label class="chip scan-chip">📷 Scan a recipe<input type="file" accept="image/*" multiple hidden data-change="recipeScanNew"></label>
      </div>
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
  const k = scaleOf(r.id);
  const custom = !!ui.scaleCustom[r.id];
  const st = recipeStatus(r, k);
  const notes = [...(r.notes || [])].sort((a, b) => b.at - a.at);
  return `
    <a class="back" href="#/recipes">‹ Recipes</a>
    <div class="recipe">
      ${r.photo ? pimg(r.photo, 'class="hero" data-act="viewPhoto"') : ''}
      <h2 class="rtitle">${esc(r.title)}</h2>
      <p class="meta">${[r.servings && `Serves ${esc(scaleAmount(r.servings, k))}`, r.time && `⏱ ${esc(r.time)}`, r.madeCount && `Made ${r.madeCount}×, last ${fmtWhen(r.lastMade)}`].filter(Boolean).join(' · ')}</p>
      ${db.list('items').filter(i => i.recipeId === r.id && i.qty > 0).map(i => `<button class="leftover-line" data-act="openItem" data-id="${i.id}">🍱 Leftovers in the ${esc(loc(locOf(i)).name.toLowerCase())}: <b>${portionLeft(i.qty)}</b> · made ${fmtWhen(stockedAt(i))}${ageState(i) ? ` · <span class="age ${ageState(i)}">${fmtDays(daysIn(i))} old</span>` : ''}</button>`).join('')}
      <div class="scale-bar">
        <span class="scale-lbl">Batch</span>
        <div class="seg">
          ${SCALES.map(v => `<button class="${!custom && k === v ? 'on' : ''}" data-act="setScale" data-id="${r.id}" data-v="${v}">${v}×</button>`).join('')}
          <button class="${custom ? 'on' : ''}" data-act="customScale" data-id="${r.id}">Custom</button>
        </div>
        ${custom ? `<label class="custom-scale"><input type="number" inputmode="decimal" min="0.05" step="0.25" value="${esc(ui.scaleText[r.id] ?? k)}" data-input="scaleText" data-id="${r.id}" aria-label="Custom batch size">×</label>` : ''}
      </div>
      ${k !== 1 ? `<p class="small muted scale-note">Showing a <b>${scaleLabel(k)}</b>. Amounts, servings and the stock check are adjusted; step text isn't, so check pan sizes and cooking times.</p>` : ''}
      <div class="actions">
        <button class="btn primary" data-act="makeRecipe" data-id="${r.id}">✓ Made it</button>
        ${st.canMake ? '' : `<button class="btn" data-act="addMissing" data-id="${r.id}">🛒 Add missing (${st.missing.length})</button>`}
        <button class="btn" data-act="printRecipe" data-id="${r.id}">🖨 Print</button>
        <a class="btn ghost" href="#/recipe-edit/${r.id}">✎ Edit</a>
      </div>
      <div class="status-banner ${st.canMake ? 'ok' : 'warn'}">${st.canMake ? '✓ You have everything to make this.' : `You're missing ${st.missing.length}: ${esc(st.missing.map(m => m.ing.name).join(', '))}`}</div>
      <h3 class="sec-h">Ingredients</h3>
      <ul class="ings">
        ${st.rows.map(({ ing, item, need, ok }, i) => `<li class="${ing.optional ? 'opt' : ok ? 'ok' : 'miss'}" data-act="ingInfo" data-id="${r.id}" data-i="${i}">
          <span class="dot"></span>
          <span class="grow"><b ${k !== 1 && ing.amount ? `title="1× batch: ${esc(ing.amount)}"` : ''}>${esc(scaleAmount(ing.amount, k))}</b> ${esc(ing.name)}</span>
          <span class="have">${ing.optional ? 'not tracked' : item ? `have ${esc(totalText(item, availableQty(item)))}${openedCopiesOf(item).length ? ' (1 open)' : ''} · need ${esc(!ing.usesManual && usesFor(ing.amount, item.unit, sizeOf(item), densName(item)) != null ? scaleAmount(ing.amount, k) : totalText(item, need))}` : 'not in stock'}${item?.price != null ? `<br>${money(item.price)}${item.link ? ' 🔗' : ''}` : item?.link ? '<br>🔗' : ''}</span>
          <span class="chev">›</span>
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
          <div class="note-meta"><b>${esc(n.by || '?')}</b> · ${fmtWhen(n.at)}${n.kind === 'made' ? ' · <span class="pill ok">made it</span>' : n.kind === 'leftover' ? ' · <span class="pill lo">leftovers</span>' : ''}
            <button class="linkish small" data-act="delNote" data-id="${r.id}" data-note="${n.id}" aria-label="Delete note">✕</button></div>
          ${n.info ? `<div class="note-info">${esc(n.info)}</div>` : ''}
          <div>${esc(n.text).replace(/\n/g, '<br>')}</div>
        </div>`).join('') || '<p class="muted">No notes yet.</p>'}
      </div>
    </div>`;
}

function makeRecipeSheet(r) {
  const k = scaleOf(r.id);
  const st = recipeStatus(r, k);
  const tracked = st.rows.filter(x => !x.ing.optional && x.item);
  openSheet(`
    <h2>Made ${esc(r.title)}${k !== 1 ? ` (${scaleLabel(k)})` : ''}?</h2>
    <p class="muted">These will be taken out of stock:</p>
    <div class="deduct">
      ${tracked.map((x, i) => `<label class="check-line"><input type="checkbox" data-i="${i}" checked>
        ${esc(x.item.name)}: ${esc(totalText(x.item, availableQty(x.item)))} → <b>${esc(totalText(x.item, Math.max(0, availableQty(x.item) - x.need)))}</b>${openedCopiesOf(x.item).length ? ' <span class="small muted">(opened one used first)</span>' : ''}</label>`).join('') || '<p class="muted">No tracked ingredients are in stock.</p>'}
    </div>
    ${st.missing.length ? `<p class="small warn">Not in stock: ${esc(st.missing.map(m => m.ing.name).join(', '))}</p>` : ''}
    <label class="check-line leftover-opt"><input type="checkbox" data-leftover checked> 🍱 Put the leftovers in the fridge <span class="muted">(shelf life ${leftoverDays()} days)</span></label>
    <label>How did it turn out? (optional)<textarea data-note rows="2"></textarea></label>
    <div class="row-end"><button class="btn ghost" data-cancel>Cancel</button><button class="btn primary" data-ok>Update stock</button></div>`, {
    onMount(s, close) {
      s.querySelector('[data-cancel]').onclick = close;
      s.querySelector('[data-ok]').onclick = async () => {
        const undo = [];
        for (const box of s.querySelectorAll('.deduct input:checked')) {
          const x = tracked[+box.dataset.i];
          const it = db.get('items', x.item.id);
          undo.push(snapshotFamily(it.id));
          await consume(it.id, x.need, useLabel(it, x.need), { recipe: r.title });
        }
        const text = s.querySelector('[data-note]').value.trim();
        let leftoverId = null;
        if (s.querySelector('[data-leftover]').checked) {
          leftoverId = uid();
          const pc = cats().some(c => c.id === 'prepared') ? 'prepared' : 'other';
          await db.put('items', {
            id: leftoverId, name: r.title + (k !== 1 ? ` (${scaleLabel(k)})` : ''), qty: 1, unit: '',
            category: pc, sub: cat(pc).subs.includes('Leftovers') ? 'Leftovers' : '', location: 'fridge',
            recipeId: r.id, photo: r.photo || null, starred: false, createdAt: Date.now(), stockedAt: Date.now()
          });
        }
        const fresh = db.get('recipes', r.id);
        await db.put('recipes', {
          ...fresh, madeCount: (fresh.madeCount || 0) + 1, lastMade: Date.now(),
          notes: [...(fresh.notes || []), { id: uid(), at: Date.now(), by: me(), kind: 'made', text: (text || 'Made it.') + (k !== 1 ? ` [${scaleLabel(k)}]` : '') }]
        });
        close();
        toast(leftoverId ? 'Stock updated · leftovers in the fridge' : 'Stock updated', [{ label: 'Undo', run: async () => {
          for (const snap of undo) await restoreFamily(snap);
          if (leftoverId) await db.remove('items', leftoverId);
        } }]);
      };
    }
  });
}

// ---------------- leftovers ----------------
function useLeftoverSheet(it) {
  if (!it) return;
  const q = it.qty;
  const opt = (p, label) => `<button class="btn big" data-use="${p}" ${p > q + 1e-6 ? 'disabled' : ''}>${label}${Math.abs(p - q) < 1e-6 ? '<small>finishes it</small>' : ''}</button>`;
  openSheet(`<h2>${esc(it.name)}</h2>
    <p class="muted small">${portionLeft(q)} · made ${fmtWhen(stockedAt(it))} · ${fmtDays(daysIn(it))} in the ${esc(loc(locOf(it)).name.toLowerCase())}</p>
    <div class="move-opts">
      ${opt(0.25, '<span class="mo-icon">🍽</span>Use ¼')}
      ${opt(0.5, '<span class="mo-icon">🍽</span>Use ½')}
      <button class="btn big" data-use="all"><span class="mo-icon">✓</span>Finished it</button>
      <button class="btn big danger-soft" data-use="toss"><span class="mo-icon">🗑</span>Throw out the rest</button>
    </div>`, {
    onMount(s, close) {
      s.querySelectorAll('[data-use]').forEach(b => b.onclick = async () => {
        close();
        const cur = db.get('items', it.id);
        const v = b.dataset.use;
        if (v === 'toss') return finishLeftover(cur, 'toss');
        if (v === 'all') return finishLeftover(cur, 'finished');
        const left = Math.round((cur.qty - +v) * 1000) / 1000;
        if (left <= 0.001) return finishLeftover(cur, 'finished');
        const before = cur.qty;
        await db.put('items', { ...cur, qty: left });
        toast(`${cur.name}: ${portionLeft(left)}`, [{ label: 'Undo', run: () => db.put('items', { ...db.get('items', cur.id), qty: before }) }]);
      });
    }
  });
}

// Finished or thrown out: ask for notes for next time, add them to the recipe, then remove the leftovers.
function finishLeftover(it, how) {
  if (!it) return;
  const r = db.get('recipes', it.recipeId);
  const days = fmtDays(daysIn(it));
  const info = how === 'finished' ? `Leftovers finished after ${days}` : `Leftovers thrown out after ${days}${it.qty < 1 ? ` (${niceQty(it.qty)} left)` : ''}`;
  let done = false;
  openSheet(`<h2>${how === 'finished' ? `All eaten 🎉` : `Throw out ${esc(it.name)}?`}</h2>
    ${r ? `<p>Any notes for next time? They'll be added to the <b>${esc(r.title)}</b> recipe.</p>
    <textarea data-n rows="3" placeholder="${how === 'finished' ? 'e.g. Even better on day 2 / made just the right amount' : 'e.g. Made too much — try a ½× batch / didn\'t reheat well'}"></textarea>` : '<p class="muted">The recipe for this has been deleted, so there\'s nowhere to save notes.</p>'}
    <div class="row-end">
      <button class="btn ghost" data-cancel>Cancel</button>
      ${r ? '<button class="btn" data-skip>No notes</button>' : ''}
      <button class="btn primary" data-ok>${r ? 'Save note' : how === 'finished' ? 'Done' : 'Throw out'}</button>
    </div>`, {
    onMount(s, close) {
      const finish = async withNote => {
        if (done) return; done = true;
        const text = withNote ? s.querySelector('[data-n]')?.value.trim() : '';
        close();
        await db.remove('items', it.id);
        if (r && text) {
          const fresh = db.get('recipes', r.id);
          await db.put('recipes', { ...fresh, notes: [...(fresh.notes || []), { id: uid(), at: Date.now(), by: me(), kind: 'leftover', info, text }] });
        }
        toast(text ? `Note added to ${r.title}` : how === 'finished' ? `${it.name} finished` : `${it.name} thrown out`, [{
          label: 'Undo', run: async () => {
            await db.put('items', { ...it });
            if (r && text) { const f = db.get('recipes', r.id); await db.put('recipes', { ...f, notes: (f.notes || []).filter(n => !(n.kind === 'leftover' && n.text === text && n.info === info)) }); }
          }
        }]);
      };
      s.querySelector('[data-cancel]').onclick = close;
      s.querySelector('[data-skip]')?.addEventListener('click', () => finish(false));
      s.querySelector('[data-ok]').onclick = () => finish(true);
      s.querySelector('[data-n]')?.focus();
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
    ${ui.recipeScan ? `<div class="card scan-recipe busy">
        <p class="reading">Reading the recipe${ui.recipeScan.n > 1 ? ` (${ui.recipeScan.n} photos)` : ''}… ${ui.recipeScan.progress ? ui.recipeScan.progress + '%' : ''}</p>
        <div class="bar"><span style="width:${ui.recipeScan.progress || 8}%"></span></div>
      </div>` : `<div class="card scan-recipe">
        <div><b>Have it on paper or a screenshot?</b>
          <p class="small muted">Take or choose a photo (several for multi-page recipes) and the form below fills itself in. ${S.apiKey ? '' : '<a href="#/settings">Add a Claude API key</a> for handwritten cards and tricky layouts.'}</p></div>
        <div class="scan-recipe-btns">
          <label class="btn primary small">📷 Take photo<input type="file" accept="image/*" capture="environment" hidden data-change="recipeScan"></label>
          <label class="btn small">🖼 Choose photos<input type="file" accept="image/*" multiple hidden data-change="recipeScan"></label>
        </div>
      </div>`}
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
      <p class="small muted"><b>Amount in recipe</b> is what the recipe says. It's what gets shown, printed and scaled. <b>Uses from stock</b> is how many of <i>your</i> stocked item one batch takes. It's worked out for you when the units line up (6 oz from a 64 oz jug = 0.09 of a jug). Otherwise, type it in. Tick <b>staple</b> for things you don't track, like salt.</p>
      <div class="ing-edit">
        <div class="ing-row ing-head" aria-hidden="true"><span>Amount in recipe</span><span>Ingredient</span><span>Uses from stock</span><span>Untracked</span><span></span></div>
        ${r.ingredients.map((g, i) => {
          const m = g.name ? resolveIng(g) : null;
          return `<div class="ing-row">
          <input data-ri="amount" data-i="${i}" value="${esc(g.amount)}" placeholder="1 lb" class="amt">
          <input data-ri="name" data-i="${i}" value="${esc(g.name)}" placeholder="Ingredient" list="inv-names" class="nm">
          <input data-ri="uses" data-i="${i}" type="text" inputmode="decimal" value="${fmtQty(m && !g.usesManual ? perBatch(g, m) : (g.uses ?? 1))}" class="qty-in uses-in ${m && !g.usesManual && usesFor(g.amount, m.unit, sizeOf(m), densName(m)) != null ? 'auto' : ''}" aria-label="Uses from stock" title="How many of your stocked item one batch uses (fractions OK)">
          <label class="mini"><input type="checkbox" data-ri="optional" data-i="${i}" ${g.optional ? 'checked' : ''}>staple</label>
          <button class="icon-btn" data-act="ingDel" data-i="${i}" aria-label="Remove">✕</button>
          ${g.name && !g.optional ? `<div class="link-hint">${esc(ingHint(g))}</div>` : ''}
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

// "↳ stock: ground beef (1 lb each) · uses 1 (= 1 lb, from “1 lb”)"
function ingHint(g) {
  const m = resolveIng({ name: g.name });
  if (!m) return '↳ not in stock yet';
  const per = perBatch(g, m), auto = !g.usesManual && usesFor(g.amount, m.unit, sizeOf(m), densName(m)) != null;
  const each = eachText(m);
  return `↳ stock: ${m.name}${each ? ` (${each})` : ''} · uses ${fmtQty(per)}${unitOf(m) ? ` = ${totalText(m, per)}` : ''}${auto ? ' · auto' : g.usesManual ? ' · set by you (clear the box to go back to auto)' : unitOf(m) ? ' · can’t compare these units, so type it in' : ` · give ${m.name} a size on its stock screen to work this out automatically`}`;
}

async function saveRecipe() {
  const r = ui.recipeDraft;
  if (!r.title.trim()) { toast('Give the recipe a title'); $('[data-rd="title"]')?.focus(); return; }
  const { _for, ...doc } = r;
  doc.title = doc.title.trim();
  doc.ingredients = doc.ingredients.filter(g => g.name.trim()).map(g => ({
    ...g, name: g.name.trim(), uses: g.uses === '' || g.uses == null ? 1 : +g.uses, usesManual: !!g.usesManual,
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
    ${scaleOf(r.id) !== 1 ? `<p>Amounts will print for a <b>${scaleLabel(scaleOf(r.id))}</b>.</p>` : ''}
    <p class="small muted">Formatted for one A4 page. In the print dialog choose paper size A4 and scale “Default/100%”.</p>
    <div class="row-end"><button class="btn primary" data-go>🖨 Print</button></div>`, {
    onMount(s, close) {
      s.querySelector('[data-go]').onclick = () => { const n = s.querySelector('[data-notes]').checked; close(); printRecipe(r, n, scaleOf(r.id)); };
    }
  });
}

async function printRecipe(r, includeNotes, k = 1) {
  const root = $('#print-root');
  const photo = await photoUrl(r.photo);
  const notes = includeNotes ? [...(r.notes || [])].sort((a, b) => b.at - a.at) : [];
  root.innerHTML = `<div class="pr-page">
    <div class="pr-head">
      ${photo ? `<img class="pr-thumb" src="${photo}" alt="">` : ''}
      <div><h1>${esc(r.title)}</h1>
        <div class="pr-meta">${[r.servings && `Serves ${esc(scaleAmount(r.servings, k))}`, r.time && `Time: ${esc(r.time)}`, k !== 1 && scaleLabel(k)].filter(Boolean).join('   ·   ')}</div></div>
    </div>
    <div class="pr-cols">
      <section class="pr-ing"><h2>Ingredients</h2><ul>${(r.ingredients || []).map(g => `<li><b>${esc(scaleAmount(g.amount, k))}</b> ${esc(g.name)}</li>`).join('')}</ul></section>
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
      <h2>Freshness &amp; running low</h2>
      <p class="small muted">Food gets a <b class="age-sample aging">yellow border</b> after this many days in inventory and a <b class="age-sample old">red border</b> after double. Individual items can have their own limit (“Warn after” on the item). Shared with the household.</p>
      <div class="age-set">
        ${LOCS.map(l => `<label>${l.icon} ${l.name}<span class="days-in"><input type="number" min="1" step="1" inputmode="numeric" value="${ageDays()[l.id]}" data-change="ageDays" data-loc="${l.id}"> days</span></label>`).join('')}
        <label>★ Running low at<span class="days-in"><input type="text" inputmode="decimal" value="${fmtQty(lowDefault())}" data-change="lowDefault"> or fewer</span></label>
        <label>🍱 Leftovers (from “Made it”)<span class="days-in"><input type="number" min="1" step="1" inputmode="numeric" value="${leftoverDays()}" data-change="leftoverDays"> days</span></label>
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
          <div class="cat-flags"><label class="mini"><input type="checkbox" data-ci="prepared" data-i="${i}" ${x.prepared ? 'checked' : ''}> prepared food</label>
          <label class="mini"><input type="checkbox" data-ci="nonFood" data-i="${i}" ${x.nonFood ? 'checked' : ''}> not food (household goods)</label></div>
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
  else if (k === 'prepared' || k === 'nonFood') c[k] = el.checked;
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

const TITLES = { spices: 'Spices', stock: 'Stock', scan: 'Scan a list', grocery: 'Grocery list', recipes: 'Recipes', recipe: 'Recipe', 'recipe-edit': 'Recipe', settings: 'Settings' };

function render() {
  const view = $('#view');
  const { name, arg } = route();
  // keep focus/caret when re-rendering under the user's fingers
  const ae = document.activeElement;
  const key = ae && view.contains(ae) && focusKey(ae);
  const keep = key ? { key, s: ae.selectionStart, e: ae.selectionEnd } : null;
  const scrollY = window.scrollY;

  if (name !== 'recipe-edit') { ui.recipeDraft = null; ui.recipeScan = null; }
  if (name !== 'settings') catDraft = null;
  const html = {
    stock: viewStock, scan: viewScan, grocery: viewGrocery, recipes: viewRecipes, spices: viewSpices,
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
const pointerReleased = () => setTimeout(() => {
  pointerDown = false;
  if (pendingRender) { pendingRender = false; render(); }
}, 0);
// a drag ends with dragend/pointercancel instead of pointerup
['pointerup', 'pointercancel', 'dragend'].forEach(t => document.addEventListener(t, pointerReleased, true));
function softRender() { if (pointerDown) pendingRender = true; else render(); }

// ---------------- click actions ----------------
const A = {
  // stock
  stockMode: b => { ui.stockMode = b.dataset.v; ui.stockCat = ui.stockSub = null; render(); },
  stockCat: b => { ui.stockCat = b.dataset.v || null; ui.stockSub = null; render(); },
  stockSub: b => { ui.stockSub = b.dataset.v || null; render(); },
  starredOnly: () => { ui.starredOnly = !ui.starredOnly; render(); },
  newItem: () => itemSheet(null),
  newItemAt: b => itemSheet(null, { location: b.dataset.loc }),
  stockLoc: b => { ui.stockLoc = b.dataset.v; render(); },
  moveMenu: b => moveSheet(db.get('items', b.dataset.id)),
  toggleStove: b => {
    const it = db.get('items', b.dataset.id);
    const on = !onStoveOf(it);
    db.put('items', { ...it, onStove: on, ...(!on && locOf(it) === 'stovetop' ? { location: 'pantry' } : {}) });
    toast(on ? `${it.name} shows on the stovetop` : `${it.name} removed from the stovetop`);
  },
  spiceSort: b => { ui.spiceSort = b.dataset.v; ui.spiceCuisine = null; render(); },
  spiceCuisine: b => { ui.spiceCuisine = b.dataset.v || null; render(); },
  newSpice: () => itemSheet(null, { category: 'pantry', sub: 'Spices', location: 'pantry', qty: 1 }),
  useLeftover: b => useLeftoverSheet(db.get('items', b.dataset.id)),
  markOpened: async b => {
    const it = db.get('items', b.dataset.id);
    const snap = snapshotFamily(it.id);
    const c = await openOne(it.id);
    if (c) toast(`Opened one ${it.name} — it's in the fridge, good for ${c.openedDays} days`, [{ label: 'Undo', run: () => restoreFamily(snap) }]);
  },
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
  scanAddRow: () => { ui.scan.rows.push({ raw: '(added)', name: '', qty: 1, unit: '', count: 1, match: 'new', category: 'other', sub: '', skip: false }); render(); },
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
  addMissing: b => addMissing(db.get('recipes', b.dataset.id), scaleOf(b.dataset.id)),
  ingInfo: b => {
    const r = db.get('recipes', b.dataset.id);
    const ing = r?.ingredients?.[+b.dataset.i];
    if (!ing) return;
    const item = resolveIng(ing);
    if (item) return itemSheet(item);
    // not in stock yet: open a new stock item (quantity 0) so price and link can be saved
    itemSheet(null, { name: ing.name });
  },
  setScale: b => { const id = b.dataset.id; ui.recipeScale[id] = +b.dataset.v; ui.scaleCustom[id] = false; delete ui.scaleText[id]; render(); },
  customScale: b => {
    const id = b.dataset.id; ui.scaleCustom[id] = true; render();
    const inp = $('.custom-scale input'); inp?.focus(); inp?.select();
  },
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
async function runRecipeScan(files) {
  files = [...files].slice(0, 6);
  if (!files.length || !ui.recipeDraft) return;
  const d = ui.recipeDraft;
  const hasContent = d.ingredients.some(g => g.name.trim()) || d.steps.some(x => x.trim());
  if (hasContent && !await confirmSheet('Replace with the photo?', '<p>The ingredients and steps already typed in will be replaced by what is read from the photo.</p>', 'Replace')) return;
  ui.recipeScan = { n: files.length, progress: 0 };
  render();
  try {
    const imgs = [];
    for (const f of files) imgs.push(await compressImage(f, 1800, 0.85));
    const rec = S.apiKey
      ? await readRecipeWithClaude(imgs, { apiKey: S.apiKey, model: S.model, knownNames: items().map(i => i.name) })
      : await readRecipeWithTesseract(imgs, p => { if (ui.recipeScan) { ui.recipeScan.progress = p; softRender(); } });
    if (!rec.ingredients.length && !rec.steps.length) throw new Error('no ingredients or steps found — try a sharper, straight-on photo');
    Object.assign(d, {
      title: rec.title || d.title,
      servings: rec.servings || d.servings,
      time: rec.time || d.time,
      ingredients: rec.ingredients.length ? rec.ingredients : d.ingredients,
      steps: rec.steps.length ? rec.steps : d.steps
    });
    if (rec.notes) d.notes = [...(d.notes || []), { id: uid(), at: Date.now(), by: me(), text: rec.notes }];
    toast(`Filled in ${rec.ingredients.length} ingredients and ${rec.steps.length} steps — check it over, then save`, [], 7000);
  } catch (e) {
    console.error(e);
    toast('Could not read the recipe: ' + e.message, [], 9000);
  }
  ui.recipeScan = null;
  render();
}

const C = {
  ageDays: el => {
    const v = parseInt(el.value);
    if (!(v > 0)) return toast('Enter a number of days');
    const cur = db.get('meta', 'settings') || { id: 'settings' };
    db.put('meta', { ...cur, ageDays: { ...ageDays(), [el.dataset.loc]: v } });
    toast(`${loc(el.dataset.loc).name}: warn after ${v} days`);
  },
  lowDefault: el => {
    const v = qtyIn(el.value);
    if (isNaN(v)) return toast('Enter a number, e.g. 2 or 1/2');
    const cur = db.get('meta', 'settings') || { id: 'settings' };
    db.put('meta', { ...cur, lowAt: v });
    toast(`Starred items are suggested at ${fmtQty(v)} or fewer (unless an item has its own level)`);
  },
  leftoverDays: el => {
    const v = parseInt(el.value);
    if (!(v > 0)) return toast('Enter a number of days');
    const cur = db.get('meta', 'settings') || { id: 'settings' };
    db.put('meta', { ...cur, leftoverDays: v });
    toast(`Leftovers: warn after ${v} days`);
  },
  recipeScan: el => runRecipeScan(el.files),
  recipeScanNew: el => {
    const files = [...el.files];
    if (!files.length) return;
    ui.recipeDraft = { ...blankRecipe(), _for: 'new' };
    location.hash = '#/recipe-edit/new';
    setTimeout(() => runRecipeScan(files), 0);
  },
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
  spiceSearch: el => { ui.spiceSearch = el.value; render(); },
  scaleText: el => {
    const id = el.dataset.id, v = parseFloat(el.value);
    ui.scaleText[id] = el.value;
    if (v > 0 && v <= 100) { ui.recipeScale[id] = v; render(); }
  },
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
      else if (k === 'qty') { const v = parseAmount(el.value); r.qty = isNaN(v) ? 0 : v; if (!WEIGHTS[r.unit]) r.count = r.qty; }
      else if (k === 'unit') { r.unit = normUnit(el.value); if (!WEIGHTS[r.unit]) r.count = r.qty; }
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
      if (el.dataset.ri === 'uses') { const v = qtyIn(el.value); g.usesManual = el.value.trim() !== '' && !isNaN(v); if (g.usesManual) g.uses = v; }
      const m = g.name.trim() ? resolveIng({ name: g.name }) : null;
      const usesEl = row.querySelector('[data-ri="uses"]');
      if (m && !g.usesManual) usesEl.value = fmtQty(perBatch(g, m));
      usesEl.classList.toggle('auto', !!m && !g.usesManual && usesFor(g.amount, m.unit, sizeOf(m), densName(m)) != null);
      if (g.name.trim() && !g.optional) {
        if (!hint) { hint = document.createElement('div'); hint.className = 'link-hint'; row.appendChild(hint); }
        hint.textContent = ingHint(g);
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
  // drag an item row onto another column to move it
  let dragId = null;
  view.addEventListener('dragstart', e => {
    const row = e.target.closest?.('.row.item[draggable]');
    if (!row) return;
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragId);
    row.classList.add('dragging');
    view.querySelectorAll('.drop-zone').forEach(c => c.classList.add('drop-ready'));
  });
  view.addEventListener('dragend', () => {
    dragId = null;
    view.querySelectorAll('.dragging, .drop-ready, .drop-over').forEach(el => el.classList.remove('dragging', 'drop-ready', 'drop-over'));
  });
  view.addEventListener('dragover', e => {
    const col = e.target.closest?.('.drop-zone');
    if (!col || !dragId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    view.querySelectorAll('.drop-over').forEach(c => c !== col && c.classList.remove('drop-over'));
    col.classList.add('drop-over');
  });
  view.addEventListener('drop', e => {
    const col = e.target.closest?.('.drop-zone');
    if (!col || !dragId) return;
    e.preventDefault();
    const it = db.get('items', dragId);
    view.querySelectorAll('.dragging, .drop-ready, .drop-over').forEach(el => el.classList.remove('dragging', 'drop-ready', 'drop-over'));
    dragId = null;
    moveItem(it, col.dataset.loc);
  });
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
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
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
  // one-time: snacks move to the new snack cabinet, condiments in the fridge to the door
  if (!localStorage.getItem('pantry.mig.fridgeSplit')) {
    for (const it of db.list('items')) {
      if (isOpenedCopy(it) || isLeftover(it)) continue;
      if ((it.category === 'snacks' || ['Cookies', 'Candy & chocolate'].includes(it.sub)) && (!it.location || it.location === 'pantry')) await db.put('items', { ...it, location: 'snacks' });
      else if (it.sub === 'Sauces & condiments' && it.location === 'fridge') await db.put('items', { ...it, location: 'door' });
    }
    localStorage.setItem('pantry.mig.fridgeSplit', '1');
  }
  // one-time: oils now live on the stovetop (they used to be kept in the pantry)
  if (!localStorage.getItem('pantry.mig.stoveOils')) {
    for (const it of db.list('items')) if (isOil(it) && !isOpenedCopy(it) && (!it.location || it.location === 'pantry')) await db.put('items', { ...it, location: 'stovetop' });
    localStorage.setItem('pantry.mig.stoveOils', '1');
  }
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
