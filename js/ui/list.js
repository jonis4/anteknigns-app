// @ts-check
import { displayTitle, editedAt } from '../store.js';

/** @typedef {import('../store.js').Note} Note */

const list = /** @type {HTMLUListElement} */ (document.getElementById('notes'));

/**
 * @param {Note[]} notes redan sorterade, senast ändrad först
 * @param {(id: string) => void} onOpen
 */
export function renderList(notes, onOpen) {
  list.replaceChildren(...notes.map((note) => row(note, onOpen)));
}

/**
 * @param {Note} note
 * @param {(id: string) => void} onOpen
 * @returns {HTMLLIElement}
 */
function row(note, onOpen) {
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = displayTitle(note);

  const time = document.createElement('time');
  time.dateTime = new Date(editedAt(note)).toISOString();
  time.textContent = formatDate(editedAt(note));

  const button = document.createElement('button');
  button.type = 'button';
  button.append(title, time);
  button.addEventListener('click', () => onOpen(note.id));

  const item = document.createElement('li');
  item.append(button);
  return item;
}

/**
 * Klockslag för i dag, annars datum. Årtal bara när det inte är i år.
 * @param {number} at
 * @param {Date} [now]
 * @returns {string}
 */
function formatDate(at, now = new Date()) {
  const date = new Date(at);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' });
  }
  /** @type {Intl.DateTimeFormatOptions} */
  const options = { day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) options.year = 'numeric';
  return date.toLocaleDateString('sv-SE', options);
}
