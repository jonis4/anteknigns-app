// @ts-check
import { displayTitle, editedAt, preview } from '../store.js';

/** @typedef {import('../store.js').Note} Note */

/**
 * @typedef {Object} ListActions
 * @property {(id: string) => void} onOpen
 * @property {(id: string, category: string) => void} onCategory
 * @property {(id: string, value: boolean) => void} onPrivate
 */

const list = /** @type {HTMLUListElement} */ (document.getElementById('notes'));
const suggestions = /** @type {HTMLDataListElement} */ (document.getElementById('categories'));

/** Så många rader får ett eget namn för animering. Fler än så märks inte och kostar bara. */
const ANIMATED_ROWS = 40;

/**
 * @param {Note[]} notes redan sorterade, senast ändrad först
 * @param {string[]} categories kategorierna som föreslås när man byter
 * @param {ListActions} actions
 */
export function renderList(notes, categories, actions) {
  suggestions.replaceChildren(...categories.map((category) => new Option(category)));
  list.replaceChildren(
    ...notes.map((note, index) => {
      const item = row(note, actions);
      // Namnet låter webbläsaren följa raden när listan ändras (se "Rörelse" i app.css).
      if (index < ANIMATED_ROWS) item.style.setProperty('--row', `row-${note.id}`);
      return item;
    }),
  );
}

/**
 * @param {Note} note
 * @param {ListActions} actions
 * @returns {HTMLLIElement}
 */
function row(note, actions) {
  const title = document.createElement('span');
  title.className = 'title';
  title.textContent = displayTitle(note);

  const time = document.createElement('time');
  time.dateTime = new Date(editedAt(note)).toISOString();
  time.textContent = formatDate(editedAt(note));

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'row';
  const text = document.createElement('span');
  text.className = 'preview';
  text.textContent = preview(note);

  const meta = document.createElement('span');
  meta.className = 'meta';
  meta.textContent = [note.private ? 'Privat' : '', note.category].filter(Boolean).join(' · ');

  button.append(title, time, text, meta);
  button.addEventListener('click', () => actions.onOpen(note.id));

  const item = document.createElement('li');
  item.append(button);

  // Långtryck på mobil och högerklick på dator ger samma händelse.
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    const open = item.querySelector('.options');
    for (const other of list.querySelectorAll('.options')) other.remove();
    if (!open) item.append(rowOptions(note, actions));
  });
  return item;
}

/**
 * Radens val: byt kategori, gör privat.
 * @param {Note} note
 * @param {ListActions} actions
 * @returns {HTMLElement}
 */
function rowOptions(note, actions) {
  const category = document.createElement('input');
  category.value = note.category;
  category.placeholder = 'Kategori';
  category.setAttribute('aria-label', 'Kategori');
  category.setAttribute('list', 'categories');
  category.autocomplete = 'off';
  category.enterKeyHint = 'done';
  category.addEventListener('change', () => actions.onCategory(note.id, category.value.trim()));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.textContent = note.private ? 'Inte privat' : 'Privat';
  toggle.addEventListener('click', () => actions.onPrivate(note.id, !note.private));

  const panel = document.createElement('div');
  panel.className = 'options';
  panel.append(category, toggle);
  return panel;
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
