// Reading a photographed list.
// Two engines:
//  - Claude (vision) — best for handwriting. Needs an Anthropic API key in Settings.
//  - Tesseract.js   — free, runs in the browser, fine for printed / very neat lists.

const UNITS = 'lbs?|pounds?|oz|ounces?|kgs?|kilos?|g|grams?|l|liters?|litres?|ml|gal|gallons?|qts?|quarts?|dozen|doz|packs?|pkgs?|pk|cans?|bags?|boxes?|bottles?|jars?|loaf|loaves|bunch(?:es)?|heads?|cartons?|tubs?|blocks?|sticks?|cups?';
const NUM = '(\\d+(?:[.,]\\d+)?|\\d+\\/\\d+|½|¼|¾)';

function toNum(s) {
  if (!s) return 1;
  if (s === '½') return 0.5; if (s === '¼') return 0.25; if (s === '¾') return 0.75;
  if (s.includes('/')) { const [a, b] = s.split('/').map(Number); return b ? a / b : 1; }
  return parseFloat(s.replace(',', '.')) || 1;
}

// "3 ground beef", "ground beef x3", "eggs - 12", "2 lb chicken", "milk (2)", "• bread"
export function parseLine(raw) {
  let s = raw.trim()
    .replace(/^(\[\s*[x✓✔]?\s*\]|☐|☑|[-–—•*·○◦▪●>]+)\s*/i, '')   // bullets / checkboxes
    .replace(/^\d{1,2}[.)]\s+(?=\D)/, '')                         // "1. " numbered lists
    .trim();
  if (!s || s.length < 2 || !/[a-z]/i.test(s)) return null;
  let m;
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:x\\s*)?(?:(${UNITS})\\b\\.?)?\\s*(?:of\\s+)?(.+)$`, 'i'))))
    return { raw, name: clean(m[3]), qty: toNum(m[1]), unit: m[2] || '' };
  if ((m = s.match(new RegExp(`^(.+?)\\s*(?:[-–:=×]|\\bx|\\(|\\s)\\s*${NUM}\\s*(${UNITS})?\\s*\\)?\\s*$`, 'i'))))
    return { raw, name: clean(m[1]), qty: toNum(m[2]), unit: m[3] || '' };
  return { raw, name: clean(s), qty: 1, unit: '' };
}

const clean = s => s.replace(/[\s\-–:,.;]+$/, '').replace(/\s+/g, ' ').trim();

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

async function ocrText(dataUrl, onProgress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  const { data } = await window.Tesseract.recognize(dataUrl, 'eng', {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  });
  return data.text;
}

export async function readWithTesseract(dataUrl, onProgress) {
  return parseText(await ocrText(dataUrl, onProgress));
}

export async function readWithClaude(dataUrl, { apiKey, model, knownNames = [] }) {
  const [meta, b64] = dataUrl.split(',');
  const media = meta.match(/data:(.*?);/)[1];
  const prompt = `This is a photo of a household food list (often handwritten).
Read every line item. For each, return the food name, the quantity (a number; default 1 when none is written) and a unit if one is written (lb, oz, can, bag, dozen...).
If an item clearly refers to one of these existing household items, use the existing name exactly: ${JSON.stringify(knownNames.slice(0, 300))}
Ignore titles, dates, crossed-out lines and doodles.
Respond with ONLY a JSON array like [{"name":"ground beef","qty":2,"unit":"lb","raw":"2 lb grnd beef"}].`;
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
      max_tokens: 2000,
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
  return JSON.parse(json[0]).map(x => ({
    raw: x.raw || x.name, name: String(x.name || '').trim(), qty: Number(x.qty) || 1, unit: x.unit || ''
  })).filter(x => x.name);
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
