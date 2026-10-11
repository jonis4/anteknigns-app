// @ts-check
import { asDeleted, createNote, currentText, getNote, putNote, withText } from '../store.js';

/** @typedef {import('../store.js').Note} Note */

const SAVE_DELAY = 500;
const CONFIRM_TIME = 3000;

const textarea = /** @type {HTMLTextAreaElement} */ (document.getElementById('editor'));
const deleteButton = /** @type {HTMLButtonElement} */ (document.getElementById('delete'));

let id = '';
/** Null tills det finns text att spara, så att tomma anteckningar aldrig hamnar i listan. @type {Note | null} */
let note = null;
let saveTimer = 0;
let confirmTimer = 0;
let confirming = false;
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
    if (note) await putNote(asDeleted(note));
    show(crypto.randomUUID(), null);
    onDeleted();
  });
}

/**
 * Öppnar anteckningen med det id:t. Finns den inte blir det en ny, tom anteckning.
 * @param {string} noteId
 * @returns {Promise<void>}
 */
export async function openNote(noteId) {
  await save();
  const found = await getNote(noteId);
  if (found?.deleted) show(crypto.randomUUID(), null);
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

/** @returns {Promise<void>} */
async function write() {
  const text = textarea.value;
  if (note ? text === currentText(note) : text.trim() === '') return;
  const next = note ? withText(note, text) : createNote(id, text);
  await putNote(next);
  // Först nu räknas texten som sparad. Misslyckas putNote görs ett nytt försök vid nästa sparning.
  note = next;
  deleteButton.hidden = note.deleted;
}

/**
 * @param {string} noteId
 * @param {Note | null} saved
 */
function show(noteId, saved) {
  id = noteId;
  note = saved;
  textarea.value = saved ? currentText(saved) : '';
  deleteButton.hidden = !saved;
  resetDelete();
}

function resetDelete() {
  clearTimeout(confirmTimer);
  confirming = false;
  deleteButton.textContent = 'Ta bort';
}
