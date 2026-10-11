// @ts-check
import test from 'node:test';
import assert from 'node:assert/strict';
import { finishReset, hasPin, hashPin, isUnlocked, lock, resetEmail, setPin, startReset, unlock } from '../js/lock.js';

// Node saknar localStorage, så testet får en enkel egen.
const storage = new Map();
/** @type {any} */ (globalThis).localStorage = {
  getItem: (/** @type {string} */ key) => storage.get(key) ?? null,
  setItem: (/** @type {string} */ key, /** @type {string} */ value) => storage.set(key, value),
  removeItem: (/** @type {string} */ key) => storage.delete(key),
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

test('glömd kod: kontot knyts till koden av den som kan den, aldrig av någon annan', async () => {
  storage.clear();
  await setPin('1234');
  assert.equal(resetEmail(), undefined);
  // Fel kod får inte knyta ett konto till låset.
  assert.equal(await unlock('0000', 'lanare@example.com'), false);
  assert.equal(resetEmail(), undefined);
  assert.equal(await unlock('1234', 'jag@example.com'), true);
  assert.equal(resetEmail(), 'jag@example.com');

  storage.clear();
  await setPin('1234', 'jag@example.com');
  assert.equal(resetEmail(), 'jag@example.com');
});

test('glömd kod: återställs bara efter begäran, i tid, och av rätt konto', async () => {
  const fresh = async () => { storage.clear(); await setPin('1234', 'jag@example.com'); lock(); };

  await fresh();
  assert.equal(finishReset('jag@example.com'), false, 'ingen begäran: en vanlig inloggning rör inte koden');
  assert.equal(hasPin(), true);

  await fresh(); startReset();
  assert.equal(finishReset('lanare@example.com'), false, 'fel konto');
  assert.equal(hasPin(), true);
  assert.equal(finishReset('jag@example.com'), false, 'begäran gäller bara ett försök');

  await fresh(); startReset();
  assert.equal(finishReset('jag@example.com', Date.now() + 2 * 60 * 60 * 1000), false, 'för gammal begäran');
  assert.equal(hasPin(), true);

  storage.clear(); await setPin('1234'); lock(); startReset();
  assert.equal(finishReset(undefined), false, 'kod utan konto går inte att återställa');
  assert.equal(finishReset('jag@example.com'), false);
  assert.equal(hasPin(), true);

  await fresh(); startReset();
  assert.equal(finishReset('jag@example.com'), true);
  assert.equal(hasPin(), false);
  assert.equal(isUnlocked(), false);
  await setPin('5678', 'jag@example.com'); lock();
  assert.equal(await unlock('1234'), false);
  assert.equal(await unlock('5678'), true);
});
