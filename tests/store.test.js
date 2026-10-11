// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { asDeleted, createNote, currentText, visibleNotes, withText } from '../js/store.js';

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
