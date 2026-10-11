// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asDeleted,
  createNote,
  currentText,
  displayTitle,
  editedAt,
  needsTitle,
  originalText,
  restoreOriginal,
  visibleNotes,
  withAiVersion,
  withText,
  withTitle,
} from '../js/store.js';

const LONG = 'En anteckning som är så lång att första raden inte duger som rubrik';

test('createNote ger en anteckning med en user-version', () => {
  const note = createNote('a', 'hej', 1000);
  assert.deepEqual(note, {
    id: 'a',
    versions: [{ text: 'hej', source: 'user', at: 1000 }],
    title: '',
    category: '',
    private: false,
    createdAt: 1000,
    updatedAt: 1000,
    deleted: false,
  });
});

test('currentText är texten i senaste versionen', () => {
  const note = createNote('a', 'hej', 1000);
  note.versions.push({ text: 'Hej!', source: 'spellcheck', at: 2000 });
  assert.equal(currentText(note), 'Hej!');
});

test('withText uppdaterar senaste user-versionen i stället för att lägga till en ny', () => {
  const note = withText(createNote('a', 'hej', 1000), 'hej då', 2000);
  assert.deepEqual(note.versions, [{ text: 'hej då', source: 'user', at: 2000 }]);
  assert.equal(note.createdAt, 1000);
  assert.equal(note.updatedAt, 2000);
});

test('withText lägger till en ny version när senaste är från AI', () => {
  const original = createNote('a', 'hej', 1000);
  original.versions.push({ text: 'Hej!', source: 'spellcheck', at: 2000 });
  const note = withText(original, 'Hej! Mer text', 3000);
  assert.deepEqual(note.versions, [
    { text: 'hej', source: 'user', at: 1000 },
    { text: 'Hej!', source: 'spellcheck', at: 2000 },
    { text: 'Hej! Mer text', source: 'user', at: 3000 },
  ]);
});

test('withText och asDeleted ändrar inte originalet', () => {
  const original = createNote('a', 'hej', 1000);
  const copy = structuredClone(original);
  withText(original, 'annat', 2000);
  asDeleted(original, 3000);
  assert.deepEqual(original, copy);
});

test('en tömd anteckning räknas som borttagen, och kommer tillbaka när man skriver igen', () => {
  const emptied = withText(createNote('a', 'hej', 1000), '  \n ', 2000);
  assert.equal(emptied.deleted, true);
  const restored = withText(emptied, 'hej igen', 3000);
  assert.equal(restored.deleted, false);
  assert.equal(currentText(restored), 'hej igen');
});

test('asDeleted markerar som borttagen men behåller texten', () => {
  const note = asDeleted(createNote('a', 'hej', 1000), 2000);
  assert.equal(note.deleted, true);
  assert.equal(note.updatedAt, 2000);
  assert.equal(currentText(note), 'hej');
});

test('visibleNotes döljer borttagna och sorterar senast ändrad först', () => {
  const old = createNote('old', 'gammal', 1000);
  const edited = withText(createNote('edited', 'ändrad', 500), 'ändrad igen', 3000);
  const recent = createNote('recent', 'ny', 2000);
  const gone = asDeleted(createNote('gone', 'borta', 4000), 5000);
  const notes = [old, edited, recent, gone];
  assert.deepEqual(visibleNotes(notes).map((note) => note.id), ['edited', 'recent', 'old']);
  assert.deepEqual(notes.map((note) => note.id), ['old', 'edited', 'recent', 'gone']);
});

test('AI lägger till en version och rör inte de som finns', () => {
  const original = createNote('a', 'hej dår', 1000);
  const note = withAiVersion(original, 'Hej då!', 'spellcheck', 2000);
  assert.deepEqual(note.versions, [
    { text: 'hej dår', source: 'user', at: 1000 },
    { text: 'Hej då!', source: 'spellcheck', at: 2000 },
  ]);
  assert.equal(original.versions.length, 1);
  assert.equal(currentText(note), 'Hej då!');
});

test('originalText är texten precis före senaste AI-versionen', () => {
  const user = createNote('a', 'ett', 1000);
  assert.equal(originalText(user), null);
  const once = withAiVersion(user, 'Ett.', 'spellcheck', 2000);
  assert.equal(originalText(once), 'ett');
  const edited = withText(once, 'Ett. Två', 3000);
  assert.equal(originalText(edited), 'ett');
  const twice = withAiVersion(edited, 'Ett och två.', 'rewrite', 4000);
  assert.equal(originalText(twice), 'Ett. Två');
});

test('restoreOriginal lägger tillbaka originalet som en ny version, utan att ta bort något', () => {
  const edited = withText(withAiVersion(createNote('a', 'ett', 1000), 'Ett.', 'spellcheck', 2000), 'Ett. Två', 3000);
  const restored = restoreOriginal(edited, 4000);
  assert.deepEqual(restored.versions, [
    { text: 'ett', source: 'user', at: 1000 },
    { text: 'Ett.', source: 'spellcheck', at: 2000 },
    { text: 'Ett. Två', source: 'user', at: 3000 },
    { text: 'ett', source: 'user', at: 4000 },
  ]);
  assert.equal(restoreOriginal(restored, 5000), restored);
  assert.equal(restoreOriginal(createNote('b', 'utan AI', 1000), 2000).versions.length, 1);
});

test('rubrik behövs för långa anteckningar vars text ändrats sedan sist', () => {
  assert.equal(needsTitle(createNote('a', 'köp mjölk', 1000)), false);
  assert.equal(needsTitle(createNote('a', 'kort\nmen två rader', 1000)), true);
  const long = createNote('a', LONG, 1000);
  assert.equal(needsTitle(long), true);
  assert.equal(needsTitle(asDeleted(long, 2000)), false);
  const titled = withTitle(long, 'Rubrik', 5000);
  assert.equal(needsTitle(titled), false);
  assert.equal(needsTitle(withText(titled, LONG + ' och mer', 6000)), true);
});

test('withTitle ändrar inte när texten senast ändrades, så listan behåller ordningen', () => {
  const titled = withTitle(createNote('a', LONG, 1000), 'Rubrik', 5000);
  assert.equal(titled.title, 'Rubrik');
  assert.equal(titled.updatedAt, 5000);
  assert.equal(editedAt(titled), 1000);
  const other = createNote('b', 'nyare', 2000);
  assert.deepEqual(visibleNotes([titled, other]).map((note) => note.id), ['b', 'a']);
});

test('displayTitle: AI-rubriken om den finns, annars första raden', () => {
  assert.equal(displayTitle(createNote('a', '  köp mjölk  ', 1000)), 'köp mjölk');
  assert.equal(displayTitle(createNote('a', LONG + '\nrad två', 1000)), LONG);
  const titled = withTitle(createNote('a', LONG, 1000), 'Rubrik', 2000);
  assert.equal(displayTitle(titled), 'Rubrik');
  assert.equal(displayTitle(withText(titled, 'kort nu', 3000)), 'kort nu');
});
