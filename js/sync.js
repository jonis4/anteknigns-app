// @ts-check
import { clearDirty, dirtyNotes, markAllDirty, onLocalChange, updateNote } from './store.js';
import { request, signedIn, signedInEmail } from './supabase.js';

/** @typedef {import('./store.js').Note} Note */

/**
 * En rad i tabellen notes.
 * @typedef {Object} Row
 * @property {string} id
 * @property {import('./store.js').Version[]} versions
 * @property {string} title
 * @property {string} category
 * @property {boolean} private
 * @property {number} created_at
 * @property {number} updated_at
 * @property {boolean} deleted
 * @property {number | null} titled_at
 * @property {string} [server_updated_at]  // sätts av servern, används som markör för vad som är hämtat
 */

const CURSOR_KEY = 'sync-cursor';
/** Kontot som enhetens anteckningar senast skickades upp till i sin helhet. */
const ACCOUNT_KEY = 'sync-account';
/** Hämta om den senaste minuten varje gång, ifall två enheter skrev till servern nästan samtidigt. */
const OVERLAP = 60_000;
const PAGE = 500;
const BATCH = 100;
/** Vänta så här länge efter senaste ändringen innan den skickas. */
const PUSH_DELAY = 2000;
/** Så här ofta hämtas andras ändringar medan appen är öppen. */
const POLL = 30_000;

// --- Rena funktioner (testas i tests/sync.test.js) ---

/**
 * Last-write-wins per anteckning: den med senast updatedAt vinner. Lika = den lokala står kvar.
 * @param {Note | undefined} local
 * @param {Note} remote
 * @returns {Note} vinnaren
 */
export function merge(local, remote) {
  return !local || remote.updatedAt > local.updatedAt ? remote : local;
}

/**
 * @param {Note} note
 * @returns {Row}
 */
export function toRow(note) {
  return {
    id: note.id,
    versions: note.versions,
    title: note.title,
    category: note.category,
    private: note.private,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
    deleted: note.deleted,
    titled_at: note.titledAt ?? null,
  };
}

/**
 * @param {Row} row
 * @returns {Note}
 */
export function fromRow(row) {
  /** @type {Note} */
  const note = {
    id: row.id,
    versions: row.versions,
    title: row.title,
    category: row.category,
    private: row.private,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deleted: row.deleted,
  };
  if (row.titled_at !== null) note.titledAt = row.titled_at;
  return note;
}

// --- Synk ---

/** @type {Promise<void> | null} */
let running = null;
let again = false;
let pushTimer = 0;
/** @type {(ids: string[]) => void} */
let onRemoteChange = () => {};

/**
 * Startar synken: vid start, efter ändringar, när nätet kommer tillbaka och när appen visas igen.
 * @param {(ids: string[]) => void} listener anropas med id för anteckningar som ändrats från molnet
 */
export function initSync(listener) {
  onRemoteChange = listener;
  onLocalChange(() => {
    clearTimeout(pushTimer);
    // Stängs appen finns ingen tid att vänta.
    if (document.visibilityState === 'hidden') sync();
    else pushTimer = setTimeout(sync, PUSH_DELAY);
  });
  addEventListener('online', sync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sync();
  });
  setInterval(() => {
    if (document.visibilityState === 'visible') sync();
  }, POLL);
  sync();
}

/**
 * Hämtar andras ändringar och skickar egna. Tyst: misslyckas det görs ett nytt försök nästa gång.
 * Körs aldrig dubbelt; begärs en synk medan en pågår körs en till direkt efteråt.
 * @returns {Promise<void>}
 */
export function sync() {
  if (!signedIn() || !navigator.onLine) return Promise.resolve();
  if (running) {
    again = true;
    return running;
  }
  running = run()
    .catch((err) => console.warn('Synken misslyckades', err))
    .finally(() => {
      running = null;
      if (again) {
        again = false;
        sync();
      }
    });
  return running;
}

/** @returns {Promise<void>} */
async function run() {
  // Första synken efter en inloggning: allt som finns lokalt ska upp, allt som finns i molnet ska ner.
  const account = signedInEmail() ?? '';
  if (localStorage.getItem(ACCOUNT_KEY) !== account) {
    localStorage.removeItem(CURSOR_KEY);
    await markAllDirty();
    localStorage.setItem(ACCOUNT_KEY, account);
  }
  const changed = await pull();
  await push();
  if (changed.length > 0) onRemoteChange(changed);
}

/**
 * Hämtar rader som ändrats på servern sedan sist och sparar dem som vinner över det lokala.
 * @returns {Promise<string[]>} id för anteckningar som ändrades lokalt
 */
async function pull() {
  const cursor = localStorage.getItem(CURSOR_KEY);
  const since = cursor ? `&server_updated_at=gt.${encodeURIComponent(new Date(Date.parse(cursor) - OVERLAP).toISOString())}` : '';
  let newest = cursor;
  /** @type {string[]} */
  const changed = [];

  for (let offset = 0; ; offset += PAGE) {
    const res = await request(`/rest/v1/notes?select=*&order=server_updated_at.asc,id.asc&limit=${PAGE}&offset=${offset}${since}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Hämtning svarade ${res.status}`);
    /** @type {Row[]} */
    const rows = await res.json();
    for (const row of rows) {
      const remote = fromRow(row);
      const saved = await updateNote(row.id, (local) => (merge(local, remote) === remote ? remote : undefined), { remote: true });
      if (saved === remote) changed.push(row.id);
      if (row.server_updated_at && (!newest || Date.parse(row.server_updated_at) > Date.parse(newest))) newest = row.server_updated_at;
    }
    if (rows.length < PAGE) break;
  }

  if (newest) localStorage.setItem(CURSOR_KEY, newest);
  return changed;
}

/**
 * Skickar lokala ändringar. Servern behåller sin rad om den är nyare (se 002_notes.sql).
 * @returns {Promise<void>}
 */
async function push() {
  const notes = await dirtyNotes();
  for (let i = 0; i < notes.length; i += BATCH) {
    const batch = notes.slice(i, i + BATCH);
    const res = await request('/rest/v1/notes?on_conflict=id', {
      body: batch.map(toRow),
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    });
    if (!res.ok) throw new Error(`Skickning svarade ${res.status}`);
    await clearDirty(batch);
  }
}
