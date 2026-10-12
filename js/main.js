// @ts-check
import { aiEnabled, organize } from './ai.js';
import { finishReset, hasPin, isUnlocked, lock } from './lock.js';
import {
  categoriesOf,
  currentText,
  listNotes,
  needsTitle,
  updateNote,
  withCategory,
  withPrivate,
  withSuggestedCategory,
  withTitle,
} from './store.js';
import { configured, onSignedInElsewhere, signInFromUrl, signedIn, signedInEmail } from './supabase.js';
import { initSync, sync } from './sync.js';
import { currentId, focusEditor, initEditor, openNote, reloadNote, save, showsPrivate } from './ui/editor.js';
import { renderList } from './ui/list.js';
import { animate, haptic } from './ui/motion.js';
import { initPin, resetPin } from './ui/pin.js';
import { initSignIn, resetSignIn } from './ui/signin.js';

/** @typedef {{ view: 'editor', id: string, fromList?: boolean } | { view: 'list' } | { view: 'signin' } | { view: 'pin', first?: boolean }} Route */

/** Så många anteckningar får rubrik och kategori per omgång, så att en lång kö inte blir en skur av anrop. */
const TITLES_PER_ROUND = 5;

const editorView = /** @type {HTMLElement} */ (document.getElementById('editor-view'));
const listView = /** @type {HTMLElement} */ (document.getElementById('list-view'));
const signinView = /** @type {HTMLElement} */ (document.getElementById('signin-view'));
const pinView = /** @type {HTMLElement} */ (document.getElementById('pin-view'));
const showListButton = /** @type {HTMLButtonElement} */ (document.getElementById('show-list'));
const newButton = /** @type {HTMLButtonElement} */ (document.getElementById('new'));
const signinButton = /** @type {HTMLButtonElement} */ (document.getElementById('show-signin'));
const signinBackButton = /** @type {HTMLButtonElement} */ (document.getElementById('signin-back'));
const lockButton = /** @type {HTMLButtonElement} */ (document.getElementById('lock'));
const pinBackButton = /** @type {HTMLButtonElement} */ (document.getElementById('pin-back'));

/** Hur djupt in i appen varje vy ligger. Avgör åt vilket håll bytet mellan två vyer rör sig. */
const DEPTH = { list: 0, editor: 1, signin: 1, pin: 1 };

/** @type {Route['view']} */
let currentView = 'editor';
let titling = false;
/** Anteckningen som ska bli privat så snart en PIN-kod är vald. @type {string | null} */
let becomingPrivate = null;

/** @returns {Route} */
function newNoteRoute() {
  return { view: 'editor', id: crypto.randomUUID() };
}

/**
 * Uppdaterar listan medan den visas, så att rader som läggs till, tas bort eller flyttas rör sig dit.
 * @returns {Promise<void>}
 */
function showList() {
  return listView.hidden ? renderNotes() : animate('list', renderNotes);
}

/** @returns {Promise<void>} */
async function renderNotes() {
  const all = await listNotes();
  // Privata anteckningar finns inte i listan förrän låset är öppet.
  const notes = isUnlocked() ? all : all.filter((note) => !note.private);
  renderList(notes, categoriesOf(notes), {
    onOpen: (id) => go({ view: 'editor', id, fromList: true }),
    onCategory: async (id, category) => {
      await updateNote(id, (note) => note && withCategory(note, category));
      haptic();
      showList();
    },
    onPrivate: async (id, value) => {
      // Första gången något görs privat måste det finnas en PIN-kod att låsa upp med.
      if (value && !hasPin()) {
        becomingPrivate = id;
        go({ view: 'pin' });
        return;
      }
      await updateNote(id, (note) => note && withPrivate(note, value));
      haptic();
      showList();
    },
  });
  // Synk erbjuds bara tills enheten är inloggad. Sedan sköter den sig själv.
  signinButton.hidden = !configured || signedIn();
  lockButton.hidden = !hasPin() && !all.some((note) => note.private);
  lockButton.textContent = isUnlocked() ? 'Lås' : 'Privat';
}

/**
 * @param {Route} route
 * @returns {Promise<void>}
 */
async function show(route) {
  if (route.view === 'editor') {
    await openNote(route.id, isUnlocked());
  } else {
    await save();
    await renderNotes();
  }
  const change = () => {
    listView.hidden = route.view !== 'list';
    editorView.hidden = route.view !== 'editor';
    signinView.hidden = route.view !== 'signin';
    pinView.hidden = route.view !== 'pin';
    if (route.view === 'editor') focusEditor();
    if (route.view === 'signin') resetSignIn();
    if (route.view === 'pin') resetPin();
  };
  if (route.view === currentView) change();
  else await animate(DEPTH[route.view] > DEPTH[currentView] ? 'forward' : 'back', change);
  currentView = route.view;
  // Rubrik och kategori görs när man lämnat en anteckning, aldrig medan man skriver.
  refreshTitles();
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
 * Ger rubrik och kategori åt anteckningar vars text har ändrats sedan sist. Körs i bakgrunden
 * och är tyst: går det inte nu görs ett nytt försök nästa gång.
 * @returns {Promise<void>}
 */
async function refreshTitles() {
  if (!aiEnabled || titling) return;
  titling = true;
  try {
    const open = editorView.hidden ? null : currentId();
    const all = await listNotes();
    const categories = categoriesOf(all);
    const waiting = all.filter((note) => needsTitle(note) && note.id !== open);
    for (const note of waiting.slice(0, TITLES_PER_ROUND)) {
      const text = currentText(note);
      const { title, category } = await organize(text, categories);
      // Har texten hunnit ändras gäller svaret inte längre.
      await updateNote(note.id, (saved) =>
        saved && currentText(saved) === text ? withSuggestedCategory(withTitle(saved, title), category) : undefined,
      );
      // Nästa anteckning i samma omgång ska kunna hamna i en kategori som nyss skapades.
      if (category !== '' && !categories.includes(category)) categories.push(category);
    }
    if (waiting.length > 0 && !listView.hidden) await showList();
  } catch {
    // Tyst med flit.
  } finally {
    titling = false;
  }
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

/** Lämnar inloggningen för listan, där anteckningarna från andra enheter dyker upp när de hämtats. */
function signedInNow() {
  if (!signinView.hidden) history.back();
  sync();
}

initSignIn(signedInNow);
onSignedInElsewhere(signedInNow);
// Länken i mejlet kan också hamna i en app som redan är öppen.
addEventListener('hashchange', () => {
  if (!signInFromUrl()) return;
  if (finishReset(signedInEmail())) {
    go({ view: 'pin' });
    sync();
  } else {
    signedInNow();
  }
});

/** Lämnar PIN-vyn för listan. Kom man dit direkt från länken i mejlet finns inget att gå bakåt till. */
function leavePin() {
  if (!history.state?.first) {
    history.back();
    return;
  }
  /** @type {Route} */
  const route = { view: 'list' };
  history.replaceState(route, '');
  show(route);
}

initPin(async () => {
  if (becomingPrivate) {
    await updateNote(becomingPrivate, (note) => note && withPrivate(note, true));
    becomingPrivate = null;
    // PIN-koden valdes för att gömma anteckningen, så låset stängs igen direkt.
    lock();
  }
  haptic();
  leavePin();
});

lockButton.addEventListener('click', () => {
  if (!isUnlocked()) {
    go({ view: 'pin' });
    return;
  }
  lock();
  haptic();
  showList();
});

// Låset stängs så fort appen lämnas, så att den som lånar enheten efteråt inte ser något privat.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'hidden' || !isUnlocked()) return;
  lock();
  if (!listView.hidden) {
    showList();
  } else if (!editorView.hidden && showsPrivate()) {
    const route = newNoteRoute();
    history.replaceState(route, '');
    show(route);
  }
});

showListButton.addEventListener('click', () => go({ view: 'list' }));
newButton.addEventListener('click', () => go(newNoteRoute()));
signinButton.addEventListener('click', () => go({ view: 'signin' }));
signinBackButton.addEventListener('click', () => history.back());
pinBackButton.addEventListener('click', () => {
  becomingPrivate = null;
  leavePin();
});
addEventListener('popstate', (event) => show(/** @type {Route | null} */ (event.state) ?? newNoteRoute()));

/**
 * Appen öppnar alltid i en ny, tom anteckning. Utom när man kommer från länken i inloggningsmejlet:
 * då visas listan, så att man ser att anteckningarna kommer. Var länken ett svar på "Glömt koden?"
 * får man i stället välja en ny PIN-kod.
 * @returns {Route}
 */
function startRoute() {
  if (!signInFromUrl()) return newNoteRoute();
  return finishReset(signedInEmail()) ? { view: 'pin', first: true } : { view: 'list' };
}

const start = startRoute();
history.replaceState(start, '');
// Märket används för att mäta uppstartstiden (se "Uppstart" i arkitektur.md).
show(start).then(() => performance.mark('app-ready'));

// Ber webbläsaren att inte rensa anteckningarna när lagringsutrymmet tryter.
navigator.storage?.persist?.();

registerServiceWorker();

// Synken startar sist, så att den aldrig fördröjer att editorn visas.
initSync(() => {
  if (!listView.hidden) showList();
  else if (!editorView.hidden) reloadNote();
});
