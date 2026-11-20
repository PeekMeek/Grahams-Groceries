// Small shared helpers.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function fmtWhen(ts) {
  if (!ts) return '';
  const d = new Date(ts), now = new Date();
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ' ' + time;
}

export function fmtQty(n) {
  if (n == null || isNaN(n)) return '0';
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

// ---------- names & matching ----------
export function normalize(name) {
  return String(name || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean)
    .map(w => w.length > 3 && w.endsWith('ies') ? w.slice(0, -3) + 'y'
      : w.length > 4 && /(ches|shes|xes|oes)$/.test(w) ? w.slice(0, -2)
      : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)
    .join(' ');
}

// Score how well two item names match (0..1).
export function nameScore(a, b) {
  const na = normalize(a), nb = normalize(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const ta = new Set(na.split(' ')), tb = new Set(nb.split(' '));
  const inter = [...ta].filter(t => tb.has(t)).length;
  if (!inter) return 0;
  const union = new Set([...ta, ...tb]).size;
  const jac = inter / union;
  // "beef" vs "ground beef": every word of the shorter name appears in the longer one
  const contained = inter === Math.min(ta.size, tb.size) ? 0.75 : 0;
  return Math.max(jac, contained);
}

export function bestMatch(name, items, threshold = 0.6) {
  let best = null, score = 0;
  for (const it of items) {
    const s = nameScore(name, it.name);
    if (s > score) { score = s; best = it; }
  }
  return score >= threshold ? best : null;
}

// ---------- images ----------
// Shrinks a photo to a JPEG data URL small enough to store and sync.
export function compressImage(file, maxSide = 900, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

// ---------- toast ----------
export function toast(msg, actions = [], ms = 5000) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(msg)}</span>` + actions.map((a, i) => `<button data-i="${i}">${esc(a.label)}</button>`).join('');
  root.appendChild(el);
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 250); };
  el.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) { actions[+b.dataset.i].run(); close(); }
  });
  setTimeout(close, ms);
}

// ---------- bottom sheet / modal ----------
export function openSheet(html, { onMount, wide } = {}) {
  const root = $('#sheet-root');
  const wrap = document.createElement('div');
  wrap.className = 'sheet-wrap';
  wrap.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <button class="sheet-x" aria-label="Close">✕</button>${html}</div>`;
  root.appendChild(wrap);
  document.body.classList.add('sheet-open');
  const close = () => {
    wrap.remove();
    if (!root.children.length) document.body.classList.remove('sheet-open');
  };
  wrap.addEventListener('click', e => {
    if (e.target === wrap || e.target.closest('.sheet-x')) close();
  });
  const sheet = wrap.querySelector('.sheet');
  onMount?.(sheet, close);
  return close;
}

export function confirmSheet(title, body, okLabel = 'OK') {
  return new Promise(resolve => {
    let done = false;
    const close = openSheet(`<h2>${esc(title)}</h2><div class="sheet-body">${body}</div>
      <div class="row-end"><button class="btn ghost" data-no>Cancel</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`, {
      onMount(s, c) {
        s.querySelector('[data-ok]').onclick = () => { done = true; c(); resolve(true); };
        s.querySelector('[data-no]').onclick = () => { done = true; c(); resolve(false); };
        new MutationObserver((_, obs) => { if (!s.isConnected) { obs.disconnect(); if (!done) resolve(false); } })
          .observe($('#sheet-root'), { childList: true });
      }
    });
    return close;
  });
}
