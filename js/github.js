// Shared household data, stored in your GitHub repo.
//
// The data is saved on a separate branch (default "pantry-data") so list
// changes don't rebuild the GitHub Pages site:
//   pantry.json        all stock, grocery and recipe records
//   photos/<id>.jpg    photos
//
// Flow:
//   * A change on this phone is saved to the repo a couple of seconds later.
//     Before saving, the app reads the repo copy and merges it, so changes from
//     other phones are never overwritten.
//   * Every 30 s (and when the app comes back to the screen) it checks whether
//     someone else saved. If so, it shows the "refresh" banner.
//   * Offline changes are kept and saved when the connection comes back.

import * as db from './db.js';
import { uid } from './util.js';

const DATA = 'pantry.json';
let cfg = null;                  // { owner, repo, token, branch, api, name }
let lastSeen = null;             // commit we last read or wrote
let status = 'local';            // local | syncing | online | pending | error
let error = '';
let remoteChanged = false;
let pushing = false, pushAgain = false, timer = null, changeSeq = 0;
const statusListeners = new Set();
const UNPUSHED = 'pantry.unpushed';

export const onStatus = fn => statusListeners.add(fn);
export const getStatus = () => ({ status, error, remoteChanged, connected: !!cfg });
function setStatus(s, e = '') { status = s; error = e; statusListeners.forEach(fn => fn()); }
const unpushed = () => localStorage.getItem(UNPUSHED) === '1';
const setUnpushed = v => v ? localStorage.setItem(UNPUSHED, '1') : localStorage.removeItem(UNPUSHED);

// Work out owner/repo from a GitHub Pages address like miko.github.io/pantry-pwa
export function guessRepo() {
  const h = location.hostname;
  if (!h.endsWith('.github.io')) return '';
  const owner = h.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  return `${owner}/${repo}`;
}

// ---------------- low-level API ----------------
async function gh(path, { method = 'GET', body, accept, raw } = {}) {
  const res = await fetch((cfg.api || 'https://api.github.com') + `/repos/${cfg.owner}/${cfg.repo}` + path, {
    method,
    cache: 'no-cache',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!res.ok) {
    const err = new Error(explain(res.status, await res.text()));
    err.status = res.status;
    throw err;
  }
  return raw ? res : res.json();
}

function explain(code, text) {
  if (code === 401) return 'GitHub rejected the token (expired or mistyped?)';
  if (code === 403 && /rate limit/i.test(text)) return 'GitHub rate limit hit — try again in a few minutes';
  if (code === 403) return 'The token is not allowed to write to this repo (needs Contents: Read and write)';
  if (code === 404) return 'Repo not found — check owner/repo and that the token includes this repo';
  return `GitHub ${code}: ${text.slice(0, 120)}`;
}

const enc = str => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const dec = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));
const path = p => p.split('/').map(encodeURIComponent).join('/');

async function headCommit() {
  return (await gh(`/git/ref/heads/${path(cfg.branch)}`)).object.sha;
}

async function ensureBranch() {
  try { await headCommit(); return; } catch (e) { if (e.status !== 404) throw e; }
  const repo = await gh('');
  const base = await gh(`/git/ref/heads/${path(repo.default_branch)}`);
  await gh('/git/refs', { method: 'POST', body: { ref: `refs/heads/${cfg.branch}`, sha: base.object.sha } });
}

async function readData(ref) {
  try {
    const f = await gh(`/contents/${DATA}?ref=${ref}`);
    let text = f.content ? dec(f.content) : '';
    if (!text && f.size) text = await (await gh(`/contents/${DATA}?ref=${ref}`, { accept: 'application/vnd.github.raw+json', raw: true })).text();
    return { sha: f.sha, data: text ? JSON.parse(text) : {} };
  } catch (e) {
    if (e.status === 404) return { sha: null, data: {} };
    throw e;
  }
}

async function writeFile(p, base64, message, sha) {
  return gh(`/contents/${path(p)}`, { method: 'PUT', body: { message, content: base64, branch: cfg.branch, ...(sha ? { sha } : {}) } });
}

// ---------------- photos ----------------
// Photos taken on this phone start as data URLs in the record; before saving,
// each is uploaded as its own file and the record keeps just the file path.
async function uploadPhotos() {
  for (const col of ['items', 'grocery', 'recipes']) {
    for (const doc of db.list(col)) {
      if (!doc.photo?.startsWith('data:')) continue;
      const p = `photos/${uid()}.jpg`;
      await writeFile(p, doc.photo.split(',')[1], `Photo for ${doc.name || doc.title || 'item'}`);
      await db.photoPut(p, doc.photo);
      const now = db.get(col, doc.id);
      if (now && now.photo === doc.photo) await db.putSilent(col, { ...now, photo: p });
    }
  }
}

const loading = new Map();
export function loadPhoto(p) {
  if (db.photoCached(p)) return Promise.resolve(db.photoCached(p));
  if (!cfg) return Promise.resolve(null);
  if (!loading.has(p)) {
    loading.set(p, (async () => {
      const res = await gh(`/contents/${path(p)}?ref=${cfg.branch}`, { accept: 'application/vnd.github.raw+json', raw: true });
      const blob = new Blob([await res.blob()], { type: "image/jpeg" });
      const url = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      await db.photoPut(p, url);
      return url;
    })().catch(() => null).finally(() => setTimeout(() => loading.delete(p), 30000)));
  }
  return loading.get(p);
}

// ---------------- sync ----------------
export async function connect(c) {
  cfg = { branch: 'pantry-data', ...c };
  setStatus('syncing');
  try {
    await ensureBranch();
    await pull();
    if (unpushed()) schedulePush(0);
  } catch (e) {
    console.error(e);
    setStatus('error', e.message);
    throw e;
  }
}

export function disconnect() { cfg = null; setStatus('local'); }

// Read the repo copy and merge it in (the "Refresh" button).
export async function pull() {
  if (!cfg) return;
  setStatus('syncing');
  try {
    const head = await headCommit();
    const { data } = await readData(head);
    await db.mergeRemote(data);
    lastSeen = head;
    remoteChanged = false;
    setStatus(unpushed() ? 'pending' : 'online');
  } catch (e) {
    setStatus('error', e.message);
    throw e;
  }
}

export function noteLocalChange() {
  changeSeq++;
  setUnpushed(true);
  if (cfg) { setStatus('pending'); schedulePush(); }
}

function schedulePush(ms = 2000) {
  clearTimeout(timer);
  timer = setTimeout(push, ms);
}

async function push() {
  if (!cfg) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  const seq = changeSeq;
  setStatus('syncing');
  try {
    await uploadPhotos();
    for (let attempt = 0; ; attempt++) {
      const head = await headCommit();
      const remote = await readData(head);
      await db.mergeRemote(remote.data);           // pick up anything newer from other phones
      const out = { app: 'pantry', savedBy: cfg.name || '', savedAt: Date.now(), ...db.snapshot() };
      try {
        const res = await writeFile(DATA, enc(JSON.stringify(out)), `${cfg.name || 'Someone'} updated the pantry`, remote.sha);
        lastSeen = res.commit.sha;
        remoteChanged = false;
        break;
      } catch (e) {
        // 409/422: someone else saved in between — read again and retry
        if ((e.status === 409 || e.status === 422) && attempt < 4) continue;
        throw e;
      }
    }
    if (seq === changeSeq) setUnpushed(false);
    setStatus(unpushed() ? 'pending' : 'online');
  } catch (e) {
    console.error(e);
    setStatus(navigator.onLine ? 'error' : 'pending', navigator.onLine ? e.message : 'Offline — will save when back online');
  } finally {
    pushing = false;
    if (pushAgain || (seq !== changeSeq)) { pushAgain = false; schedulePush(500); }
  }
}

// Has someone else saved since we last looked?
export async function check() {
  if (!cfg || pushing || document.hidden) return;
  try {
    const head = await headCommit();
    if (lastSeen && head !== lastSeen && !remoteChanged) { remoteChanged = true; setStatus(status); }
    if (unpushed() && status !== 'syncing') schedulePush(0);
    else if (status === 'error') setStatus(unpushed() ? 'pending' : 'online');
  } catch (e) { /* offline or rate limited — try again next time */ }
}

setInterval(check, 30000);
document.addEventListener('visibilitychange', check);
window.addEventListener('online', () => { if (cfg && unpushed()) schedulePush(0); });
