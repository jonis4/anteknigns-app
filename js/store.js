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
 * @property {number} [titledAt]  // editedAt när rubriken gjordes, saknas = aldrig
 */

/** @typedef {Exclude<Version['source'], 'user'>} AiSource */

const DB_NAME = 'notes';
const STORE = 'notes';
/** Kortare än så här på en rad: första raden duger som rubrik. */
const SHORT = 40;

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
 * AI skriver aldrig över: resultatet läggs till som en ny version.
 * @param {Note} note
 * @param {string} text
 * @param {AiSource} source
 * @param {number} [now]
 * @returns {Note}
 */
export function withAiVersion(note, text, source, now = Date.now()) {
  return { ...note, versions: [...note.versions, { text, source, at: now }], updatedAt: now };
}

/**
 * Texten som fanns precis innan AI senast ändrade något. Null om AI aldrig har rört anteckningen.
 * @param {Note} note
 * @returns {string | null}
 */
export function originalText(note) {
  for (let i = note.versions.length - 1; i > 0; i--) {
    if (note.versions[i].source !== 'user') return note.versions[i - 1].text;
  }
  return null;
}

/**
 * Går tillbaka till originalet genom att lägga till det som en ny version. Inget tas bort.
 * @param {Note} note
 * @param {number} [now]
 * @returns {Note}
 */
export function restoreOriginal(note, now = Date.now()) {
  const text = originalText(note);
  if (text === null || text === currentText(note)) return note;
  /** @type {Version} */
  const version = { text, source: 'user', at: now };
  return { ...note, versions: [...note.versions, version], updatedAt: now, deleted: isEmpty(text) };
}

/**
 * När texten senast ändrades. Till skillnad från updatedAt ändras den inte av rubrik och liknande.
 * @param {Note} note
 * @returns {number}
 */
export function editedAt(note) {
  return note.versions[note.versions.length - 1]?.at ?? note.createdAt;
}

/**
 * @param {Note} note
 * @returns {boolean}
 */
function isShort(note) {
  const text = currentText(note).trim();
  return text.length <= SHORT && !text.includes('\n');
}

/**
 * Sant när anteckningen är lång nog för en egen rubrik och texten har ändrats sedan den senaste gjordes.
 * @param {Note} note
 * @returns {boolean}
 */
export function needsTitle(note) {
  return !note.deleted && !isShort(note) && editedAt(note) > (note.titledAt ?? 0);
}

/**
 * @param {Note} note
 * @param {string} title
 * @param {number} [now]
 * @returns {Note}
 */
export function withTitle(note, title, now = Date.now()) {
  return { ...note, title, titledAt: editedAt(note), updatedAt: now };
}

/**
 * Det som visas i listan: AI-rubriken om den finns, annars första raden.
 * @param {Note} note
 * @returns {string}
 */
export function displayTitle(note) {
  const firstLine = currentText(note).trim().split('\n', 1)[0].trim();
  return isShort(note) ? firstLine : note.title || firstLine;
}

/**
 * Det som ska synas i listan: inte borttagna, senast ändrad text först.
 * @param {Note[]} notes
 * @returns {Note[]}
 */
export function visibleNotes(notes) {
  return notes.filter((note) => !note.deleted).sort((a, b) => editedAt(b) - editedAt(a));
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
 * Läser, ändrar och skriver en anteckning i en och samma transaktion, så att två ändringar
 * samtidigt (t.ex. text och rubrik) aldrig skriver över varandra.
 * Klar först när transaktionen är genomförd, alltså när ändringen ligger på disk.
 * @param {string} id
 * @param {(saved: Note | undefined) => Note | undefined} change ger den nya anteckningen, eller undefined för att låta bli
 * @returns {Promise<Note | undefined>} det som nu är sparat
 */
export async function updateNote(id, change) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const request = store.get(id);
    /** @type {Note | undefined} */
    let result;
    request.onsuccess = () => {
      result = change(request.result) ?? request.result;
      if (result !== request.result && result) store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
