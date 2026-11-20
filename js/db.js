// Data layer: everything lives on the device in IndexedDB so the app works
// offline. js/github.js copies it to and from the GitHub repo so every phone
// sees the same list. Merging is per record: the most recently updated copy wins.

export const COLS = ['items', 'grocery', 'recipes', 'meta'];
const DB_NAME = 'pantry-pwa';

const state = Object.fromEntries(COLS.map(c => [c, new Map()]));
const photos = new Map(); // repo path -> data URL (downloaded photo cache)
const listeners = new Set();
let afterPut = null;
let idb = null;

export const onChange = fn => listeners.add(fn);
export const setAfterPut = fn => { afterPut = fn; };

let emitQueued = false;
export function emit() {
  if (emitQueued) return;
  emitQueued = true;
  queueMicrotask(() => { emitQueued = false; listeners.forEach(fn => fn()); });
}

function openIDB() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      for (const c of [...COLS, 'photos'])
        if (!r.result.objectStoreNames.contains(c)) r.result.createObjectStore(c, { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function idbGetAll(col) {
  return new Promise((res, rej) => {
    const q = idb.transaction(col).objectStore(col).getAll();
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}

function idbPut(col, doc) {
  return new Promise((res, rej) => {
    const t = idb.transaction(col, 'readwrite');
    t.objectStore(col).put(doc);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

export async function init() {
  idb = await openIDB();
  for (const c of COLS) (await idbGetAll(c)).forEach(d => state[c].set(d.id, d));
  (await idbGetAll('photos')).forEach(p => photos.set(p.id, p.url));
}

export const list = col => [...state[col].values()].filter(d => !d.deleted);
export const get = (col, id) => { const d = state[col].get(id); return d && !d.deleted ? d : null; };

// A change made on this phone.
export async function put(col, doc) {
  doc = { ...doc, updatedAt: Date.now() };
  state[col].set(doc.id, doc);
  emit();
  await idbPut(col, doc);
  afterPut?.();
  return doc;
}

// Soft delete so the deletion reaches the other phones.
export async function remove(col, id) {
  if (state[col].get(id)) await put(col, { id, deleted: true });
}

// Store without counting it as a new local change (used by the sync code).
export async function putSilent(col, doc) {
  state[col].set(doc.id, doc);
  await idbPut(col, doc);
}

// Everything including deletions, for saving to the repo.
export function snapshot() {
  return Object.fromEntries(COLS.map(c => [c, [...state[c].values()]]));
}

// Bring in records from the repo; newer copies replace older ones. Returns how many changed.
export async function mergeRemote(data) {
  let changed = 0;
  for (const c of COLS) {
    for (const d of data?.[c] || []) {
      const local = state[c].get(d.id);
      if (!local || (d.updatedAt || 0) > (local.updatedAt || 0)) {
        await putSilent(c, d);
        changed++;
      }
    }
  }
  if (changed) emit();
  return changed;
}

// ---- photo cache ----
export const photoCached = path => photos.get(path);
export async function photoPut(path, url) {
  photos.set(path, url);
  await idbPut('photos', { id: path, url });
}

// ---- backup ----
export async function exportAll() {
  return Object.fromEntries(COLS.map(c => [c, list(c)]));
}

export async function importAll(data) {
  for (const c of COLS) {
    if (!Array.isArray(data[c])) continue;
    for (const d of data[c]) await put(c, d);
  }
}
