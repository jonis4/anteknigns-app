// @ts-check

/**
 * @typedef {Object} Version
 * @property {string} text
 * @property {'user'|'spellcheck'|'rewrite'|'summary'} source
 * @property {number} at          // ms sedan 1970
 *
 * @typedef {Object} Note
 * @property {string} id          // crypto.randomUUID(), skapas lokalt
 * @property {Version[]} versions // äldst först, bara tillägg
 * @property {string} title
 * @property {string} category
 * @property {boolean} private
 * @property {number} createdAt
 * @property {number} updatedAt
 * @property {boolean} deleted    // soft delete, krävs för synk
 */

const DB_NAME = 'notes';
const STORE = 'notes';

// --- Rena funktioner (testas i tests/store.test.js) ---

/**
 * @param {string} id
 * @param {string} text
 * @param {number} [now]
 * @returns {Note}
 */
export function createNote(id, text, now = Date.now()) {
  return {
    id,
    versions: [{ text, source: 'user', at: now }],
    title: '',
    category: '',
    private: false,
    createdAt: now,
    updatedAt: now,
    deleted: isEmpty(text),
  };
}

/**
 * @param {Note} note
 * @returns {string}
 */
export function currentText(note) {
  return note.versions[note.versions.length - 1]?.text ?? '';
}

/**
 * Det man skriver uppdaterar senaste user-versionen. Är senaste versionen från AI
 * läggs en ny user-version till, så att AI-resultatet finns kvar orört.
 * En tömd anteckning räknas som borttagen, så att listan inte fylls av tomma rader.
 * @param {Note} note
 * @param {string} text
 * @param {number} [now]
 * @returns {Note}
 */
export function withText(note, text, now = Date.now()) {
  const last = note.versions[note.versions.length - 1];
  /** @type {Version} */
  const version = { text, source: 'user', at: now };
  const versions = last?.source === 'user' ? [...note.versions.slice(0, -1), version] : [...note.versions, version];
  return { ...note, versions, updatedAt: now, deleted: isEmpty(text) };
}

/**
 * @param {Note} note
 * @param {number} [now]
 * @returns {Note}
 */
export function asDeleted(note, now = Date.now()) {
  return { ...note, updatedAt: now, deleted: true };
}

/**
 * Det som ska synas i listan: inte borttagna, senast ändrad först.
 * @param {Note[]} notes
 * @returns {Note[]}
 */
export function visibleNotes(notes) {
  return notes.filter((note) => !note.deleted).sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * @param {string} text
 * @returns {boolean}
 */
function isEmpty(text) {
  return text.trim() === '';
}

// --- IndexedDB ---

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise;

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/**
 * @template T
 * @param {IDBRequest<T>} request
 * @returns {Promise<T>}
 */
function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * @param {string} id
 * @returns {Promise<Note | undefined>}
 */
export async function getNote(id) {
  const db = await openDb();
  return done(db.transaction(STORE).objectStore(STORE).get(id));
}

/** @returns {Promise<Note[]>} */
export async function listNotes() {
  const db = await openDb();
  return visibleNotes(await done(db.transaction(STORE).objectStore(STORE).getAll()));
}

/**
 * Klar först när transaktionen är genomförd, alltså när texten ligger på disk.
 * @param {Note} note
 * @returns {Promise<void>}
 */
export async function putNote(note) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(note);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
