// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  asDeleted,
  categoriesOf,
  createNote,
  currentText,
  displayTitle,
  editedAt,
  needsTitle,
  originalText,
  preview,
  restoreOriginal,
  visibleNotes,
  withAiVersion,
  withCategory,
  withPrivate,
  withSuggestedCategory,
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

test('rubrik och kategori behövs när texten ändrats sedan sist, även för korta anteckningar', () => {
  assert.equal(needsTitle(createNote('a', 'köp mjölk', 1000)), true);
  const long = createNote('a', LONG, 1000);
  assert.equal(needsTitle(long), true);
  assert.equal(needsTitle(asDeleted(long, 2000)), false);
  const titled = withTitle(long, 'Rubrik');
  assert.equal(needsTitle(titled), false);
  assert.equal(needsTitle(withText(titled, LONG + ' och mer', 6000)), true);
});

test('withTitle ändrar inte när texten senast ändrades, så listan behåller ordningen', () => {
  const titled = withTitle(createNote('a', LONG, 1000), 'Rubrik');
  assert.equal(titled.title, 'Rubrik');
  assert.equal(titled.updatedAt, 1001);
  assert.equal(editedAt(titled), 1000);
  const other = createNote('b', 'nyare', 2000);
  assert.deepEqual(visibleNotes([titled, other]).map((note) => note.id), ['b', 'a']);
});

test('displayTitle: AI-rubriken om den finns, annars första raden', () => {
  assert.equal(displayTitle(createNote('a', '  köp mjölk  ', 1000)), 'köp mjölk');
  assert.equal(displayTitle(createNote('a', LONG + '\nrad två', 1000)), LONG);
  const titled = withTitle(createNote('a', LONG, 1000), 'Rubrik');
  assert.equal(displayTitle(titled), 'Rubrik');
  assert.equal(displayTitle(withText(titled, 'kort nu', 3000)), 'kort nu');
});

test('AI:s kategori gäller bara när anteckningen saknar kategori', () => {
  const note = createNote('a', 'köp mjölk', 1000);
  const sorted = withSuggestedCategory(note, 'Inköp');
  assert.equal(sorted.category, 'Inköp');
  assert.equal(sorted.updatedAt, 1001);
  assert.equal(withSuggestedCategory(sorted, 'Mat'), sorted);
  assert.equal(withSuggestedCategory(note, ''), note);
});

test('ett eget val av kategori står kvar när AI föreslår en annan', () => {
  const chosen = withCategory(createNote('a', 'köp mjölk', 1000), 'Hemma', 2000);
  assert.equal(chosen.category, 'Hemma');
  assert.equal(withSuggestedCategory(chosen, 'Inköp').category, 'Hemma');
  assert.equal(withCategory(chosen, 'Hemma', 3000), chosen);
});

test('kategori och privat ändrar inte när texten senast ändrades', () => {
  const note = createNote('a', 'text', 1000);
  const changed = withPrivate(withCategory(note, 'Idéer', 2000), true, 3000);
  assert.equal(changed.private, true);
  assert.equal(changed.updatedAt, 3000);
  assert.equal(editedAt(changed), 1000);
  assert.equal(note.private, false);
  assert.equal(withPrivate(changed, true, 4000), changed);
});

test('categoriesOf: unika, i bokstavsordning, utan tomma och borttagna', () => {
  const notes = [
    withCategory(createNote('a', 'ett', 1000), 'Ö-saker'),
    withCategory(createNote('b', 'två', 1000), 'Idéer'),
    withCategory(createNote('c', 'tre', 1000), 'Idéer'),
    withCategory(createNote('d', 'fyra', 1000), 'Arbete'),
    createNote('e', 'utan', 1000),
    asDeleted(withCategory(createNote('f', 'borta', 1000), 'Borttaget')),
  ];
  assert.deepEqual(categoriesOf(notes), ['Arbete', 'Idéer', 'Ö-saker']);
});

test('preview: det som följer på rubriken, på en rad', () => {
  assert.equal(preview(createNote('a', 'köp mjölk', 1000)), '');
  assert.equal(preview(createNote('a', 'Handla\n\n  mjölk  \nbröd', 1000)), 'mjölk bröd');
  // Med AI-rubrik är hela texten förhandsvisning, eftersom rubriken inte står i den.
  const titled = withTitle(createNote('a', LONG + '\nrad två', 1000), 'Rubrik');
  assert.equal(preview(titled), LONG + ' rad två');
  assert.equal(preview(createNote('a', 'x'.repeat(500) + '\ny', 1000)).length, 1);
  assert.equal(preview(withTitle(createNote('a', 'x'.repeat(500), 1000), 'Rubrik')).length, 200);
});
