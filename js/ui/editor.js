// @ts-check
import { AiError, aiEnabled, runAi } from '../ai.js';
import {
  asDeleted,
  createNote,
  currentText,
  getNote,
  originalText,
  restoreOriginal,
  updateNote,
  withAiVersion,
  withText,
} from '../store.js';
import { animate } from './motion.js';

/** @typedef {import('../store.js').Note} Note */
/** @typedef {import('../store.js').AiSource} AiSource */
/** @typedef {'spellcheck' | 'rewrite' | 'summarize'} EditAction */

const SAVE_DELAY = 500;
const CONFIRM_TIME = 3000;
const STATUS_TIME = 3000;

/** @type {Record<EditAction, { source: AiSource, working: string }>} */
const ACTIONS = {
  spellcheck: { source: 'spellcheck', working: 'Rättar…' },
  rewrite: { source: 'rewrite', working: 'Renskriver…' },
  summarize: { source: 'summary', working: 'Summerar…' },
};

/** @type {Record<import('../ai.js').AiErrorCode, string>} */
const ERRORS = {
  offline: 'Inget nät',
  limit: 'Dagens gräns är nådd',
  too_long: 'Texten är för lång',
  failed: 'Det gick inte just nu',
};

const textarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
const deleteButton = /** @type {HTMLButtonElement} */ (document.getElementById('delete'));
const aiButton = /** @type {HTMLButtonElement} */ (document.getElementById('ai'));
const originalButton = /** @type {HTMLButtonElement} */ (document.getElementById('original'));
const menu = /** @type {HTMLElement} */ (document.getElementById('ai-menu'));
const status = /** @type {HTMLElement} */ (document.getElementById('status'));

let id = '';
/** Null tills det finns text att spara, så att tomma anteckningar aldrig hamnar i listan. @type {Note | null} */
let note = null;
let saveTimer = 0;
let confirmTimer = 0;
let statusTimer = 0;
let confirming = false;
let busy = false;
/** Sparningar körs en i taget, i den ordning de begärdes. @type {Promise<void>} */
let queue = Promise.resolve();

/**
 * @param {() => void} onDeleted anropas när anteckningen tagits bort
 */
export function initEditor(onDeleted) {
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DELAY);
  });

  // På mobil stängs appen utan förvarning. beforeunload går inte att lita på.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') save();
  });
  addEventListener('pagehide', save);

  // Två tryck i stället för en dialog: första trycket frågar, andra tar bort.
  deleteButton.addEventListener('click', async () => {
    if (!confirming) {
      confirming = true;
      deleteButton.textContent = 'Ta bort?';
      confirmTimer = setTimeout(resetDelete, CONFIRM_TIME);
      return;
    }
    await save();
    await updateNote(id, (saved) => saved && asDeleted(saved));
    show(crypto.randomUUID(), null);
    onDeleted();
  });

  aiButton.addEventListener('click', () => setMenu(menu.hidden !== false));
  menu.addEventListener('click', (event) => {
    const action = /** @type {HTMLElement} */ (event.target).dataset.action;
    if (action && action in ACTIONS) runAction(/** @type {EditAction} */ (action));
  });
  originalButton.addEventListener('click', showOriginal);
}

/**
 * Öppnar anteckningen med det id:t. Finns den inte, eller är den privat och låset stängt,
 * blir det en ny, tom anteckning.
 * @param {string} noteId
 * @param {boolean} unlocked sant när privata anteckningar får visas
 * @returns {Promise<void>}
 */
export async function openNote(noteId, unlocked) {
  await save();
  const found = await getNote(noteId);
  if (found?.deleted || (found?.private && !unlocked)) show(crypto.randomUUID(), null);
  else show(noteId, found ?? null);
}

/**
 * Sparar det som står i editorn, om något har ändrats.
 * @returns {Promise<void>}
 */
export function save() {
  clearTimeout(saveTimer);
  queue = queue.then(write).catch((err) => console.error('Kunde inte spara anteckningen', err));
  return queue;
}

export function focusEditor() {
  textarea.focus();
}

/**
 * Visar anteckningen på nytt när den ändrats från en annan enhet.
 * Görs bara om inget osparat står i editorn, annars vinner det man håller på att skriva.
 * @returns {Promise<void>}
 */
export async function reloadNote() {
  const shown = textarea.value;
  if (busy || (note ? shown !== currentText(note) : shown !== '')) return;
  const noteId = id;
  const found = await getNote(noteId);
  if (!found || id !== noteId || textarea.value !== shown || found.updatedAt === note?.updatedAt) return;
  if (found.deleted) show(crypto.randomUUID(), null);
  else show(noteId, found);
}

/** @returns {boolean} sant när anteckningen i editorn är privat */
export function showsPrivate() {
  return note?.private === true;
}

/** @returns {string} id för anteckningen som ligger i editorn */
export function currentId() {
  return id;
}

/** @returns {Promise<void>} */
async function write() {
  const text = textarea.value;
  if (note ? text === currentText(note) : text.trim() === '') return;
  const noteId = id;
  const saved = await updateNote(noteId, (old) => (old ? withText(old, text) : createNote(noteId, text)));
  // Först nu räknas texten som sparad. Misslyckas det görs ett nytt försök vid nästa sparning.
  if (saved && id === noteId) {
    note = saved;
    refreshButtons();
  }
}

/**
 * Kör en AI-funktion på markerad text, eller på hela anteckningen om inget är markerat.
 * Resultatet blir en ny version. Går något fel är texten orörd.
 * @param {EditAction} action
 * @returns {Promise<void>}
 */
async function runAction(action) {
  if (busy) return;
  setMenu(false);
  await save();
  if (!note || note.deleted) return;

  const noteId = id;
  const before = textarea.value;
  const hasSelection = textarea.selectionEnd > textarea.selectionStart;
  const start = hasSelection ? textarea.selectionStart : 0;
  const end = hasSelection ? textarea.selectionEnd : before.length;
  // Blanktecken i kanterna skickas inte med, så att de garanterat finns kvar efteråt.
  const [, lead, input, trail] = /** @type {RegExpMatchArray} */ (before.slice(start, end).match(/^(\s*)([\s\S]*?)(\s*)$/));
  if (input === '') return;

  setBusy(true);
  showStatus(ACTIONS[action].working, true);
  try {
    const output = await runAi(action, input);
    const after = before.slice(0, start) + lead + output + trail + before.slice(end);
    if (after === before) {
      if (id === noteId) showStatus('Inget att ändra');
      return;
    }
    // Ny version bara om texten är densamma som den som skickades.
    const saved = await updateNote(noteId, (old) =>
      old && currentText(old) === before ? withAiVersion(old, after, ACTIONS[action].source) : undefined,
    );
    if (id === noteId && saved && currentText(saved) === after) {
      note = saved;
      hideStatus();
      await animate('morph', () => {
        textarea.value = after;
      });
    }
  } catch (err) {
    if (id === noteId) showStatus(ERRORS[err instanceof AiError ? err.code : 'failed']);
  } finally {
    setBusy(false);
    if (id !== noteId) hideStatus();
    refreshButtons();
  }
}

/** Originalet är alltid ett tryck bort: lägger tillbaka texten som fanns före AI. */
async function showOriginal() {
  if (busy) return;
  await save();
  const noteId = id;
  const saved = await updateNote(noteId, (old) => old && restoreOriginal(old));
  if (!saved || id !== noteId) return;
  note = saved;
  // Samma rörelse tillbaka som när AI ändrade texten.
  await animate('morph', () => {
    textarea.value = currentText(saved);
  });
  refreshButtons();
}

/**
 * @param {string} noteId
 * @param {Note | null} saved
 */
function show(noteId, saved) {
  id = noteId;
  note = saved;
  textarea.value = saved ? currentText(saved) : '';
  // En tom anteckning visar dagens datum tills man börjar skriva.
  textarea.placeholder = today();
  setMenu(false);
  if (!busy) hideStatus();
  resetDelete();
  refreshButtons();
}

/** Visar bara de knappar som går att använda just nu. */
function refreshButtons() {
  const saved = note !== null && !note.deleted;
  const original = note && saved ? originalText(note) : null;
  deleteButton.hidden = !saved;
  aiButton.hidden = !saved || !aiEnabled;
  originalButton.hidden = original === null || original === textarea.value;
  if (aiButton.hidden) setMenu(false);
}

/** @param {boolean} open */
function setMenu(open) {
  menu.hidden = !open;
  aiButton.setAttribute('aria-expanded', String(open));
  if (open) hideStatus();
}

/**
 * Medan AI arbetar går texten inte att ändra, annars skulle resultatet skriva över det nya.
 * @param {boolean} value
 */
function setBusy(value) {
  busy = value;
  textarea.readOnly = value;
  aiButton.disabled = value;
  originalButton.disabled = value;
  deleteButton.disabled = value;
}

/**
 * @param {string} text
 * @param {boolean} [stay] ligg kvar tills något annat visas
 */
function showStatus(text, stay = false) {
  clearTimeout(statusTimer);
  status.textContent = text;
  status.hidden = false;
  if (!stay) statusTimer = setTimeout(hideStatus, STATUS_TIME);
}

function hideStatus() {
  clearTimeout(statusTimer);
  status.hidden = true;
}

/** @returns {string} t.ex. "Söndag 11 oktober" */
function today() {
  const date = new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long' });
  return date.charAt(0).toUpperCase() + date.slice(1);
}

function resetDelete() {
  clearTimeout(confirmTimer);
  confirming = false;
  deleteButton.textContent = 'Ta bort';
}
