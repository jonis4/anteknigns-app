// @ts-check
import { listNotes } from './store.js';
import { focusEditor, initEditor, openNote, save } from './ui/editor.js';
import { renderList } from './ui/list.js';

/** @typedef {{ view: 'editor', id: string, fromList?: boolean } | { view: 'list' }} Route */

const editorView = /** @type {HTMLElement} */ (document.getElementById('editor-view'));
const listView = /** @type {HTMLElement} */ (document.getElementById('list-view'));
const showListButton = /** @type {HTMLButtonElement} */ (document.getElementById('show-list'));
const newButton = /** @type {HTMLButtonElement} */ (document.getElementById('new'));

/** @returns {Route} */
function newNoteRoute() {
  return { view: 'editor', id: crypto.randomUUID() };
}

/**
 * @param {Route} route
 * @returns {Promise<void>}
 */
async function show(route) {
  if (route.view === 'list') {
    await save();
    renderList(await listNotes(), (id) => go({ view: 'editor', id, fromList: true }));
  } else {
    await openNote(route.id);
  }
  listView.hidden = route.view !== 'list';
  editorView.hidden = route.view !== 'editor';
  if (route.view === 'editor') focusEditor();
}

/**
 * Byter vy och lägger den i historiken, så att bakåtknappen går till förra vyn.
 * @param {Route} route
 */
function go(route) {
  history.pushState(route, '');
  show(route);
}

/**
 * Registrerar service workern så att appen går att installera och öppnar offline.
 * @returns {Promise<void>}
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.error('Service workern kunde inte registreras', err);
  }
}

initEditor(() => {
  // Öppnades anteckningen från listan ligger listan redan närmast bakåt i historiken.
  if (history.state?.fromList) {
    history.back();
    return;
  }
  /** @type {Route} */
  const route = { view: 'list' };
  history.replaceState(route, '');
  show(route);
});

showListButton.addEventListener('click', () => go({ view: 'list' }));
newButton.addEventListener('click', () => go(newNoteRoute()));
addEventListener('popstate', (event) => show(/** @type {Route | null} */ (event.state) ?? newNoteRoute()));

// Appen öppnar alltid i en ny, tom anteckning.
const start = newNoteRoute();
history.replaceState(start, '');
show(start);

// Ber webbläsaren att inte rensa anteckningarna när lagringsutrymmet tryter.
navigator.storage?.persist?.();

registerServiceWorker();
