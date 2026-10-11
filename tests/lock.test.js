// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { hasPin, hashPin, isUnlocked, lock, setPin, unlock } from '../js/lock.js';

// Node saknar localStorage, så testet får en enkel egen.
const storage = new Map();
/** @type {any} */ (globalThis).localStorage = {
  getItem: (/** @type {string} */ key) => storage.get(key) ?? null,
  setItem: (/** @type {string} */ key, /** @type {string} */ value) => storage.set(key, value),
};

test('hashPin: samma kod och salt ger samma värde, annat salt ger ett annat', async () => {
  const salt = new Uint8Array(16).fill(1);
  const other = new Uint8Array(16).fill(2);
  assert.equal(await hashPin('1234', salt), await hashPin('1234', salt));
  assert.notEqual(await hashPin('1234', salt), await hashPin('1234', other));
  assert.notEqual(await hashPin('1234', salt), await hashPin('1235', salt));
});

test('låset: stängt från start, öppnas bara med rätt kod, och koden sparas aldrig i klartext', async () => {
  assert.equal(hasPin(), false);
  assert.equal(isUnlocked(), false);
  assert.equal(await unlock('1234'), false);

  await setPin('1234');
  assert.equal(hasPin(), true);
  assert.equal(isUnlocked(), true);
  assert.equal([...storage.values()].some((value) => value.includes('1234')), false);

  lock();
  assert.equal(isUnlocked(), false);
  assert.equal(await unlock('0000'), false);
  assert.equal(isUnlocked(), false);
  assert.equal(await unlock('1234'), true);
  assert.equal(isUnlocked(), true);
});
