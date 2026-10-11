// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { asDeleted, createNote, withAiVersion, withText, withTitle } from '../js/store.js';
import { fromRow, merge, toRow } from '../js/sync.js';

test('merge: finns inget lokalt vinner molnet', () => {
  const remote = createNote('a', 'från molnet', 1000);
  assert.equal(merge(undefined, remote), remote);
});

test('merge: senast ändrad vinner, åt båda hållen', () => {
  const older = createNote('a', 'gammal', 1000);
  const newer = withText(older, 'ny', 2000);
  assert.equal(merge(older, newer), newer);
  assert.equal(merge(newer, older), newer);
});

test('merge: lika gamla = den lokala står kvar', () => {
  const local = createNote('a', 'lokal', 1000);
  const remote = createNote('a', 'moln', 1000);
  assert.equal(merge(local, remote), local);
});

test('merge: en borttagning är en ändring som alla andra', () => {
  const note = createNote('a', 'text', 1000);
  const deleted = asDeleted(note, 2000);
  assert.equal(merge(note, deleted), deleted);
  // Skrivs det i anteckningen efter att den togs bort på en annan enhet kommer den tillbaka.
  const revived = withText(note, 'text och mer', 3000);
  assert.equal(merge(revived, deleted), revived);
  assert.equal(merge(deleted, revived), revived);
});

test('merge: vinnaren tas hel, versioner blandas aldrig', () => {
  const base = createNote('a', 'hej dår', 1000);
  const corrected = withAiVersion(base, 'Hej då!', 'spellcheck', 2000);
  const editedElsewhere = withText(base, 'hej dår, vi ses', 3000);
  assert.deepEqual(merge(corrected, editedElsewhere).versions, [{ text: 'hej dår, vi ses', source: 'user', at: 3000 }]);
});

test('toRow och fromRow är varandras motsats', () => {
  const plain = createNote('11111111-1111-4111-8111-111111111111', 'text', 1000);
  const titled = withTitle(withAiVersion(plain, 'Text.', 'spellcheck', 2000), 'Rubrik', 3000);
  for (const note of [plain, titled, asDeleted(titled, 4000)]) {
    assert.deepEqual(fromRow(toRow(note)), note);
  }
});

test('toRow använder tabellens kolumnnamn och skickar aldrig user_id', () => {
  const row = toRow(withTitle(createNote('a', 'text', 1000), 'Rubrik', 2000));
  assert.deepEqual(Object.keys(row).sort(), ['category', 'created_at', 'deleted', 'id', 'private', 'title', 'titled_at', 'updated_at', 'versions']);
  assert.equal(toRow(createNote('a', 'text', 1000)).titled_at, null);
});

test('fromRow bryr sig inte om serverns egna kolumner', () => {
  const row = { ...toRow(createNote('a', 'text', 1000)), user_id: 'u', server_updated_at: '2026-10-11T10:00:00Z' };
  assert.deepEqual(fromRow(row), createNote('a', 'text', 1000));
});
