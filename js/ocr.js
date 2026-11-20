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

export async function readWithTesseract(dataUrl, onProgress) {
  if (!window.Tesseract) await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js');
  const { data } = await window.Tesseract.recognize(dataUrl, 'eng', {
    logger: m => m.status === 'recognizing text' && onProgress?.(Math.round(m.progress * 100))
  });
  return parseText(data.text);
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
