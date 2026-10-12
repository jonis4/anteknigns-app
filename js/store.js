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
 * @property {number} [titledAt]  // editedAt när rubrik och kategori senast gjordes, saknas = aldrig
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
 * Sant när texten har ändrats sedan rubrik och kategori senast gjordes.
 * Gäller även korta anteckningar: de visar sin första rad som rubrik, men ska ändå få en kategori.
 * @param {Note} note
 * @returns {boolean}
 */
export function needsTitle(note) {
  return !note.deleted && editedAt(note) > (note.titledAt ?? 0);
}

/**
 * Rubriken som AI ger. updatedAt flyttas bara ett steg, inte till nu: det räcker för att rubriken ska
 * synkas, men en textändring som gjorts offline på en annan enhet under tiden är fortfarande nyare och vinner.
 * @param {Note} note
 * @param {string} title
 * @returns {Note}
 */
export function withTitle(note, title) {
  return { ...note, title, titledAt: editedAt(note), updatedAt: note.updatedAt + 1 };
}

/**
 * Kategorin som AI föreslår. Gäller bara om anteckningen saknar kategori, så att den aldrig
 * flyttas runt i efterhand och ett eget val alltid står kvar. updatedAt flyttas ett steg, som i withTitle.
 * @param {Note} note
 * @param {string} category
 * @returns {Note}
 */
export function withSuggestedCategory(note, category) {
  return note.category === '' && category !== '' ? { ...note, category, updatedAt: note.updatedAt + 1 } : note;
}

/**
 * Kategorin man själv väljer. Tom sträng = ingen kategori.
 * @param {Note} note
 * @param {string} category
 * @param {number} [now]
 * @returns {Note}
 */
export function withCategory(note, category, now = Date.now()) {
  return note.category === category ? note : { ...note, category, updatedAt: now };
}

/**
 * @param {Note} note
 * @param {boolean} value
 * @param {number} [now]
 * @returns {Note}
 */
export function withPrivate(note, value, now = Date.now()) {
  return note.private === value ? note : { ...note, private: value, updatedAt: now };
}

/**
 * Kategorierna som används, i bokstavsordning.
 * @param {Note[]} notes
 * @returns {string[]}
 */
export function categoriesOf(notes) {
  const used = new Set(notes.filter((note) => !note.deleted && note.category !== '').map((note) => note.category));
  return [...used].sort((a, b) => a.localeCompare(b, 'sv'));
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
 * En rad förhandsvisning till listan: det som står efter rubriken. När rubriken kommer från AI
 * är det början av texten, annars det som följer på första raden.
 * @param {Note} note
 * @returns {string}
 */
export function preview(note) {
  const lines = currentText(note).split('\n').map((line) => line.trim()).filter((line) => line !== '');
  const rest = lines[0] === displayTitle(note) ? lines.slice(1) : lines;
  return rest.join(' ').slice(0, 200);
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

/** Lokala ändringar som inte har skickats till molnet än: anteckningens id → dess updatedAt. */
const DIRTY = 'dirty';

/** @type {Promise<IDBDatabase> | undefined} */
let dbPromise;

/** @type {Set<() => void>} */
const listeners = new Set();

/** @returns {Promise<IDBDatabase>} */
function openDb() {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) db.createObjectStore(STORE, { keyPath: 'id' });
      if (event.oldVersion < 2) db.createObjectStore(DIRTY);
    };
    request.onsuccess = () => {
      // En nyare version av appen i en annan flik ska kunna uppgradera databasen.
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
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
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
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
 * @param {{ remote?: boolean }} [options] remote: ändringen kommer från molnet och ska inte skickas tillbaka dit
 * @returns {Promise<Note | undefined>} det som nu är sparat
 */
export async function updateNote(id, change, { remote = false } = {}) {
  const db = await openDb();
  const tx = db.transaction([STORE, DIRTY], 'readwrite');
  const store = tx.objectStore(STORE);
  const request = store.get(id);
  /** @type {Note | undefined} */
  let result;
  let changed = false;
  request.onsuccess = () => {
    result = change(request.result) ?? request.result;
    changed = result !== request.result && result !== undefined;
    if (!changed || !result) return;
    store.put(result);
    if (!remote) tx.objectStore(DIRTY).put(result.updatedAt, id);
  };
  await committed(tx);
  if (changed && !remote) for (const listener of listeners) listener();
  return result;
}

/**
 * Anropas efter varje lokal ändring som behöver skickas till molnet.
 * @param {() => void} listener
 */
export function onLocalChange(listener) {
  listeners.add(listener);
}

/** @returns {Promise<Note[]>} anteckningar med ändringar som inte har skickats till molnet */
export async function dirtyNotes() {
  const db = await openDb();
  const tx = db.transaction([STORE, DIRTY]);
  const [ids, notes] = await Promise.all([
    done(tx.objectStore(DIRTY).getAllKeys()),
    done(/** @type {IDBRequest<Note[]>} */ (tx.objectStore(STORE).getAll())),
  ]);
  const dirty = new Set(ids);
  return notes.filter((note) => dirty.has(note.id));
}

/**
 * Markerar anteckningarna som skickade. En som hunnit ändras igen sedan dess ligger kvar.
 * @param {Note[]} sent
 * @returns {Promise<void>}
 */
export async function clearDirty(sent) {
  const db = await openDb();
  const tx = db.transaction(DIRTY, 'readwrite');
  const store = tx.objectStore(DIRTY);
  for (const note of sent) {
    const request = store.get(note.id);
    request.onsuccess = () => {
      if (request.result === note.updatedAt) store.delete(note.id);
    };
  }
  await committed(tx);
}

/**
 * Köar alla anteckningar för att skickas, t.ex. första gången enheten loggar in.
 * @returns {Promise<void>}
 */
export async function markAllDirty() {
  const db = await openDb();
  const tx = db.transaction([STORE, DIRTY], 'readwrite');
  const request = /** @type {IDBRequest<Note[]>} */ (tx.objectStore(STORE).getAll());
  request.onsuccess = () => {
    for (const note of request.result) tx.objectStore(DIRTY).put(note.updatedAt, note.id);
  };
  await committed(tx);
}
