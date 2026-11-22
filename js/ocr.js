// Reading a photographed list.
// Two engines:
//  - Claude (vision) — best for handwriting. Needs an Anthropic API key in Settings.
//  - Tesseract.js   — free, runs in the browser, fine for printed / very neat lists.

// ---------------- quantities ----------------
// Weights convert between each other; everything else is a "count" unit.
export const WEIGHTS = { lb: 453.592, oz: 28.3495, g: 1, kg: 1000 };
const UNIT_ALIASES = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', '#': 'lb',
  oz: 'oz', ozs: 'oz', ounce: 'oz', ounces: 'oz',
  g: 'g', gr: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  can: 'can', cans: 'can', bag: 'bag', bags: 'bag', box: 'box', boxes: 'box', bottle: 'bottle', bottles: 'bottle',
  jar: 'jar', jars: 'jar', pack: 'pack', packs: 'pack', pk: 'pack', pkg: 'pack', pkgs: 'pack', package: 'pack', packages: 'pack',
  carton: 'carton', cartons: 'carton', loaf: 'loaf', loaves: 'loaf', bunch: 'bunch', bunches: 'bunch', head: 'head', heads: 'head',
  tub: 'tub', tubs: 'tub', block: 'block', blocks: 'block', stick: 'stick', sticks: 'stick',
  gal: 'gal', gals: 'gal', gallon: 'gal', gallons: 'gal', qt: 'qt', qts: 'qt', quart: 'qt', quarts: 'qt',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', litres: 'L', ml: 'ml',
  dozen: 'dozen', doz: 'dozen', dz: 'dozen'
};
const UNIT_RE = Object.keys(UNIT_ALIASES).filter(u => u !== '#').sort((a, b) => b.length - a.length).join('|');
// 1 | 1.5 | 1,5 | 1/4 | 1 1/2 | 1-1/2 | ½ | 1½
const NUMX = '(?:\\d+(?:\\s+|-)\\d+\\/\\d+|\\d+\\/\\d+|\\d*[½¼¾⅓⅔⅛]|\\d+(?:[.,]\\d+)?)';
const UNI = { '½': .5, '¼': .25, '¾': .75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': .125 };

// "1 1/2" -> 1.5, "1/4" -> 0.25, "½" -> 0.5, "2,5" -> 2.5
export function parseAmount(t) {
  t = String(t ?? '').trim();
  let m;
  if ((m = t.match(/^(\d+)(?:\s+|-)(\d+)\/(\d+)$/))) return +m[1] + (+m[3] ? m[2] / m[3] : 0);
  if ((m = t.match(/^(\d+)\/(\d+)$/))) return +m[2] ? m[1] / m[2] : NaN;
  if ((m = t.match(/^(\d*)([½¼¾⅓⅔⅛])$/))) return (+m[1] || 0) + UNI[m[2]];
  const n = parseFloat(t.replace(',', '.'));
  return isNaN(n) ? NaN : n;
}

// Turns one list line into { raw, name, qty, unit, count }:
//   "2 ground beef" / "ground beef 1x" / "x2 milk"  -> qty 2, no unit
//   "1/4 lb ham" / "ham 1 1/2 lb" / "2# beef"       -> qty 0.25 / 1.5 / 2, unit lb
//   "12 oz cheddar" / "cheddar (12oz)"              -> qty 12, unit oz
//   "2x 1 lb ground beef"                            -> qty 2 lb (2 packs of 1 lb), count 2
//   "3 cans black beans"                             -> qty 3, unit can
//   "1 dozen eggs"                                   -> qty 12
// `count` is the number of packages, used when a weight lands on an item counted in packs.
export function parseLine(raw) {
  let s = String(raw).trim()
    .replace(/^(\[\s*[x✓✔]?\s*\]|☐|☑|[-–—•*·○◦▪●>]+)\s*/i, '')   // bullets / checkboxes
    .replace(/^\d{1,2}[.)]\s+(?=\D)/, '')                         // "1. " numbered lists
    .trim();
  if (!s || s.length < 2 || !/[a-z]{2}/i.test(s)) return null;

  // 1) multiplier: "2x", "2 x", "x2", "×3", "(2x)"
  let count = null, m;
  const mult = new RegExp(`(^|[\\s(])(?:(\\d+)\\s*[x×]|[x×]\\s*(\\d+))(?=$|[\\s),])`, 'i');
  if ((m = s.match(mult))) {
    count = +(m[2] || m[3]);
    s = (s.slice(0, m.index) + m[1] + s.slice(m.index + m[0].length)).trim();
  }

  // 2) amount (+ unit) at the start or the end: "1 1/2 lb", "12oz", "2#", "1/4", "(3)"
  let amount = null, unit = '';
  const unitPart = `(?:\\s*(#|(?:${UNIT_RE})\\b\\.?))?`;
  // a number must be followed by a unit, a space or a bracket ("7up" is a name, not 7 × "up")
  const front = new RegExp(`^\\(?(${NUMX})(?:\\s*(#|(?:${UNIT_RE})\\b\\.?)|(?=[\\s)]))\\)?\\s*(?:of\\s+)?`, 'i');
  const back = new RegExp(`(?:^|[\\s\\-–:=,(])\\(?(${NUMX})${unitPart}\\)?\\s*$`, 'i');
  if ((m = s.match(front)) && s.slice(m[0].length).match(/[a-z]{2}/i)) {
    amount = parseAmount(m[1]); unit = m[2] || ''; s = s.slice(m[0].length);
  } else if ((m = s.match(back)) && s.slice(0, m.index).match(/[a-z]{2}/i)) {
    amount = parseAmount(m[1]); unit = m[2] || ''; s = s.slice(0, m.index);
  }
  // a unit written without a number: "lb ground beef" (rare) — ignore
  unit = unit ? (UNIT_ALIASES[unit.toLowerCase().replace(/\.$/, '')] || '') : '';

  let qty;
  if (unit === 'dozen') { qty = (amount || 1) * 12 * (count || 1); unit = ''; }
  else if (amount != null && !isNaN(amount)) qty = amount * (count || 1);
  else qty = count || 1;
  // drop container words so "1 lb bag broccoli florets" / "peeled garlic bag" match "broccoli florets" / "peeled garlic"
  const CONT = '(?:bags?|box(?:es)?|cans?|jars?|packs?|packets?|packages?|bottles?|cartons?|tubs?)';
  let name = clean(s).replace(new RegExp(`^(?:a\\s+)?${CONT}\\s+(?:of\\s+)?(?=\\S)`, 'i'), '');
  const noTail = name.replace(new RegExp(`\\s+${CONT}$`, 'i'), '');
  if (/[a-z]{3}/i.test(noTail)) name = noTail;
  if (!name || !/[a-z]{2}/i.test(name)) return null;
  return { raw: String(raw).trim(), name, qty: Math.round(qty * 1000) / 1000, unit, count: count || (unit && !WEIGHTS[unit] ? qty : 1) };
}

export const normUnit = u => { u = String(u || '').trim(); return UNIT_ALIASES[u.toLowerCase().replace(/\.$/, '')] || u; };

// How much a scanned line changes an item that is tracked in `itemUnit`.
//   weight -> weight item: converted (12 oz into an item kept in lb = 0.75)
//   weight -> item counted in packs: number of packages
//   otherwise: the number as written
// How many of a stock item a scanned line adds, given what ONE of that item is
// (itemSize × itemUnit, e.g. 1 × "lb" or 12 × "oz" or 1 × "can").
//   weight line, weight item: converted, then divided by the size of one (120 oz into 12 oz bags = 10)
//   weight line, item without a weight: number of packages ("2x 1 lb" = 2)
//   same unit: divided by the size of one; no unit: the number as written
const r2 = n => Math.round(n * 100) / 100;
export function amountFor(row, itemUnit, itemSize = 1) {
  const from = row.unit, to = normUnit(itemUnit), size = +itemSize > 0 ? +itemSize : 1;
  if (WEIGHTS[from] && WEIGHTS[to]) return r2(row.qty * WEIGHTS[from] / WEIGHTS[to] / size);
  if (WEIGHTS[from] && !WEIGHTS[to]) return row.count || 1;
  if (from && from === to) return r2(row.qty / size);
  return row.qty;
}

// How many of a stock item a recipe amount uses ("1 lb" of 1 lb packs = 1, "12 oz" of 8 oz blocks = 1.5).
// null when the units can't be compared (cups, "1 large", no unit) — then the recipe's own "uses" applies.
export function usesFor(amountText, itemUnit, itemSize = 1) {
  if (!amountText || !itemUnit) return null;
  const p = parseLine(`${amountText} qqitem`);
  if (!p || !p.unit) return null;
  const to = normUnit(itemUnit), size = +itemSize > 0 ? +itemSize : 1;
  if (WEIGHTS[p.unit] && WEIGHTS[to]) return r2(p.qty * WEIGHTS[p.unit] / WEIGHTS[to] / size);
  if (p.unit === to) return r2(p.qty / size);
  return null;
}

const clean = s => s.replace(/^[\s\-–:,.;()]+|[\s\-–:,.;(]+$/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();

export function parseText(text) {
  return text.split(/\r?\n|;/).map(parseLine).filter(Boolean);
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src));
    document.head.appendChild(s);
  });
}

async function ocrData(dataUrl, onProgress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  const { data } = await window.Tesseract.recognize(dataUrl, 'eng', {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  });
  return data;
}
const ocrText = async (dataUrl, onProgress) => (await ocrData(dataUrl, onProgress)).text;

// Text that is clearly not words: "TR me ma EREBEEC", "i SE MER | = | - HE"
export function looksLikeJunk(name) {
  const compact = name.replace(/\s/g, '');
  const letters = (compact.match(/[a-z]/gi) || []).length;
  if (!compact || letters / compact.length < 0.8) return true;           // lots of | = » ) etc.
  if (/[|»«<>=~^_\\{}\[\]]/.test(name)) return true;                       // OCR noise symbols
  const words = name.split(/\s+/).filter(w => /^[a-z][a-z'-]*$/i.test(w));
  const real = words.filter(w => w.length >= 3 && /[aeiouy]/i.test(w) && !/^[A-Z]{3,}$/.test(w));
  return !real.length || words.filter(w => w.length <= 2).length > real.length;
}

// The free reader. It is built for printed text; for handwriting it mostly
// produces nonsense, so unreadable lines are dropped and the result is flagged.
export async function readWithTesseract(dataUrl, onProgress) {
  const data = await ocrData(dataUrl, onProgress);
  const lines = data.lines?.length ? data.lines : data.text.split('\n').map(text => ({ text, confidence: data.confidence }));
  const rows = [];
  let seen = 0, dropped = 0, conf = 0;
  for (const l of lines) {
    const p = parseLine(l.text || '');
    if (!p) continue;
    seen++; conf += l.confidence ?? 0;
    if ((l.confidence ?? 100) < 60 || looksLikeJunk(p.name)) { dropped++; continue; }
    rows.push(p);
  }
  return { rows, dropped, unreadable: !seen || conf / seen < 65 || dropped > rows.length };
}

export async function readWithClaude(dataUrl, { apiKey, model, knownNames = [] }) {
  const [meta, b64] = dataUrl.split(',');
  const media = meta.match(/data:(.*?);/)[1];
  const prompt = `This is a photo of a household food list (often handwritten).
The list usually has no bullets or numbers: every new line on the paper is a new item. Return exactly one entry per written line, top to bottom, in order. Never merge two lines into one item and never split one line into several, even when a line has several words or the handwriting runs close to the next line. Skip blank lines and a title/heading line (e.g. "Groceries", a date).
The list is often written in two columns: a quantity column on the left (e.g. "3x", "10x", "1x") and the item on the right, which may include its own size (e.g. "1 lb bag broccoli florets", "1/2 gallon vanilla ice cream", "12 oz steamable corn bag"). Treat each row as one item and combine both parts.
If a number or word has been crossed out, scribbled over or written over, ignore it and use the final, uncrossed one (e.g. "10 9x" where the 9 is struck through means 10x).
Read every line item. For each, return:
- "name": the item only, without quantities, sizes or container words, keeping descriptive words (e.g. "broccoli florets", "peeled garlic", "steamable corn", "vanilla ice cream", "udon noodles").
- "quantity": every quantity written on that line, copied exactly as written, including multipliers, fractions and units. Combine the quantity column and any size in the item text, multiplier first. Examples: "1x", "x2", "3", "1/4 lb", "1 1/2 lb", "12 oz", "2x 1 lb", "10x 12 oz", "1x 1/2 gal", "1x 1/2 loaf", "1x 1/4", "2#", "3 cans", "1 dozen". Use "" if no quantity is written.
- "raw": the whole line as written.
If an item clearly refers to one of these existing household items, use the existing name exactly: ${JSON.stringify(knownNames.slice(0, 300))}
Ignore titles, dates, crossed-out lines and doodles. Read handwritten fractions carefully (1/4 vs 1/2 vs 4).
Respond with ONLY a JSON array like [{"name":"ground beef","quantity":"2x 1 lb","raw":"2x 1lb grnd beef"}].`;
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5-5',
      max_tokens: 4000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: media, data: b64 } },
        { type: 'text', text: prompt }
      ] }]
    })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  const text = out.content?.map(c => c.text || '').join('') || '';
  const json = text.match(/\[[\s\S]*\]/);
  if (!json) throw new Error('Could not read a list from the reply');
  return JSON.parse(json[0]).map(x => {
    const name = String(x.name || '').trim();
    if (!name) return null;
    const q = String(x.quantity ?? x.qty ?? '').trim();
    // run the quantity through the same parser as typed lines so the rules match exactly
    const p = q ? parseLine(`${q} ${name}`) : null;
    return p && p.name ? { ...p, name, raw: x.raw || `${q} ${name}`.trim() } : { raw: x.raw || name, name, qty: 1, unit: '', count: 1 };
  }).filter(Boolean);
}

// ======================================================================
// Recipes from photos (cookbook page, recipe card, screenshot...)
// Returns { title, servings, time, ingredients:[{amount,name,uses,optional}], steps:[], notes }
// ======================================================================

async function callClaude(images, prompt, { apiKey, model, maxTokens = 4000 }) {
  const content = images.map(url => {
    const [meta, b64] = url.split(',');
    return { type: 'image', source: { type: 'base64', media_type: meta.match(/data:(.*?);/)[1], data: b64 } };
  });
  content.push({ type: 'text', text: prompt });
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({ model: model || 'claude-sonnet-5-5', max_tokens: maxTokens, messages: [{ role: 'user', content }] })
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  return out.content?.map(c => c.text || '').join('') || '';
}

function tidyRecipe(r) {
  const str = v => (v == null ? '' : String(v)).trim();
  return {
    title: str(r.title),
    servings: str(r.servings),
    time: str(r.time),
    ingredients: (r.ingredients || []).map(g => ({
      amount: str(g.amount), name: str(g.name),
      uses: Number(g.uses) > 0 ? Number(g.uses) : 1, optional: !!g.optional
    })).filter(g => g.name),
    steps: (r.steps || []).map(s => str(s).replace(/^(step\s*)?\d+[.):]\s*/i, '')).filter(Boolean),
    notes: str(r.notes)
  };
}

export async function readRecipeWithClaude(images, { apiKey, model, knownNames = [] }) {
  const prompt = `${images.length > 1 ? `These ${images.length} photos are pages of one recipe, in order.` : 'This photo shows a recipe.'}
Read it and return it in this exact JSON shape:
{"title": string, "servings": string (just the number or range, e.g. "4" or "4-6"; "" if not given), "time": string (total time, e.g. "45 min"; "" if not given),
 "ingredients": [{"amount": string, "name": string, "optional": boolean}],
 "steps": [string],
 "notes": string}
Rules:
- "name" is the plain food only, e.g. "ground beef", "yellow onion", "cheddar cheese". Put quantity, unit and preparation in "amount", e.g. {"amount":"1 lb","name":"ground beef"}, {"amount":"1 medium, diced","name":"yellow onion"}.
- If an ingredient is the same food as one of these household stock items, use the stock name exactly: ${JSON.stringify(knownNames.slice(0, 300))}
- "optional": true for pantry basics that aren't worth tracking (salt, pepper, water, cooking spray, "to taste" items) and for ingredients marked optional.
- If ingredients are grouped (e.g. "For the sauce"), keep them all in one list and keep the order.
- "steps": one entry per step, in order, without the step numbers. Keep the recipe's wording; split long paragraphs into sensible separate steps.
- "notes": tips, variations, storage advice or the source/book name, if printed; otherwise "".
- Fix obvious typos from the print, but don't invent anything that isn't there.
Respond with ONLY the JSON object.`;
  const text = await callClaude(images, prompt, { apiKey, model });
  const json = text.match(/\{[\s\S]*\}/);
  if (!json) throw new Error('Could not read a recipe from the reply');
  return tidyRecipe(JSON.parse(json[0]));
}

export async function readRecipeWithTesseract(images, onProgress) {
  let text = '';
  for (let i = 0; i < images.length; i++) {
    text += '\n' + await ocrText(images[i], p => onProgress?.(Math.round((i * 100 + p) / images.length)));
  }
  return parseRecipeText(text);
}

const R_UNITS = 'cups?|c\\.|tablespoons?|tbsps?|tbs|T|teaspoons?|tsps?|t|lbs?|pounds?|oz|ounces?|g|grams?|kg|ml|l|liters?|litres?|cloves?|pinch(?:es)?|dash(?:es)?|cans?|packages?|pkgs?|sticks?|slices?|bunch(?:es)?|heads?|sprigs?|large|medium|small|whole|quarts?|pints?';
const STAPLES = /^(salt|pepper|black pepper|kosher salt|sea salt|water|cooking spray|salt and pepper|salt & pepper)$/i;

// Plain-text recipe -> structured recipe (used when no Claude key is set).
export function parseRecipeText(text) {
  const lines = text.split(/\r?\n/).map(l => l.replace(/\s+/g, ' ').trim());
  const isIng = l => /^ingredients?\b/i.test(l);
  const isDir = l => /^(directions|instructions|method|steps|preparation|how to make( it)?)\b/i.test(l);
  const isNotes = l => /^(notes?|tips?|cook'?s notes?)\b/i.test(l);
  let title = '', servings = '', time = '';
  let mode = 'head';
  const ings = [], stepLines = [], notes = [];
  for (const l of lines) {
    if (!l) { if (mode === 'dir') stepLines.push(''); continue; }
    let m;
    if ((m = l.match(/\b(?:serves|servings|yield|makes)\s*:?\s*(\d+(?:\s*[-–to]+\s*\d+)?)/i))) servings = servings || m[1].replace(/\s+/g, '');
    if ((m = l.match(/\btotal(?:\s*time)?\s*:?\s*(.+)$/i)) || (!time && (m = l.match(/\b(?:cook|prep)?\s*time\s*:?\s*(.+)$/i)))) { time = m[1].trim(); continue; }
    if (isIng(l)) { mode = 'ing'; continue; }
    if (isDir(l)) { mode = 'dir'; continue; }
    if (isNotes(l)) { mode = 'notes'; continue; }
    if (mode === 'head') {
      if (!title && /[a-z]/i.test(l) && !/serves|servings|yield|time/i.test(l)) title = l;
      else if (looksLikeIngredient(l)) { mode = 'ing'; ings.push(l); }
      continue;
    }
    if (mode === 'ing') {
      if (/^\d+[.)]\s+\D{12,}/.test(l) && ings.length) { mode = 'dir'; stepLines.push(l); }
      else if (/^for the\b|:$/i.test(l)) continue;           // sub-headings like "For the sauce:"
      else ings.push(l);
      continue;
    }
    if (mode === 'dir') stepLines.push(l);
    else notes.push(l);
  }
  // steps: numbered lines start a new step; otherwise blank lines separate paragraphs
  const steps = [];
  let cur = '';
  for (const l of stepLines) {
    if (!l) { if (cur) { steps.push(cur); cur = ''; } continue; }
    if (/^(step\s*)?\d+[.):]\s*/i.test(l) && cur) { steps.push(cur); cur = ''; }
    cur = cur ? cur + ' ' + l : l;
  }
  if (cur) steps.push(cur);
  return tidyRecipe({ title: titleCase(title), servings, time, ingredients: ings.map(parseIngredient).filter(Boolean), steps, notes: notes.join(' ') });
}

function looksLikeIngredient(l) {
  return new RegExp(`^[-•*]?\\s*(\\d|½|¼|¾|⅓|⅔)`).test(l) && l.length < 70;
}

export function parseIngredient(raw) {
  let s = raw.replace(/^[-•*·▪●□☐]+\s*/, '').trim();
  if (!s || !/[a-z]/i.test(s)) return null;
  let amount = '', name = s, m;
  const re = new RegExp(`^((?:\\d+\\s+)?\\d+(?:[.,/]\\d+)?|[½¼¾⅓⅔⅛]|\\d+[½¼¾⅓⅔])(?:\\s*[-–]\\s*\\d+(?:[./]\\d+)?)?\\s*(?:\\([^)]*\\)\\s*)?(?:(?:${R_UNITS})\\b\\.?\\s*)*(?:of\\s+)?`, 'i');
  if ((m = s.match(re)) && m[0].trim()) { amount = m[0].trim(); name = s.slice(m[0].length).trim(); }
  // move preparation after a comma into the amount: "onion, diced" -> amount "1, diced"
  const comma = name.indexOf(',');
  if (comma > 0) { amount = [amount, name.slice(comma + 1).trim()].filter(Boolean).join(', '); name = name.slice(0, comma).trim(); }
  const toTaste = /\bto taste\b|\boptional\b/i.test(s);
  name = name.replace(/\(optional\)|\bto taste\b/gi, '').trim();
  if (!name) return null;
  return { amount, name, uses: 1, optional: toTaste || STAPLES.test(name) };
}

const titleCase = t => t && t === t.toUpperCase() ? t.toLowerCase().replace(/(^|\s)\w/g, c => c.toUpperCase()) : t;
