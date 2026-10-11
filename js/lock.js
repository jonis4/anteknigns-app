// @ts-check

// Lås för privata anteckningar. PIN-koden döljer dem för den som lånar enheten.
// Det är inget skydd mot den som kommer åt enhetens lagring: anteckningarna är inte krypterade.
// PIN-koden sparas bara på den här enheten, som ett saltat hashvärde.

const PIN_KEY = 'pin';
const ITERATIONS = 100_000;
export const MIN_LENGTH = 4;

/** Låset är alltid stängt när appen startar. */
let unlocked = false;

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function toBase64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}

/**
 * @param {string} text
 * @returns {Uint8Array<ArrayBuffer>}
 */
function fromBase64(text) {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/**
 * @param {string} pin
 * @param {Uint8Array<ArrayBuffer>} salt
 * @returns {Promise<string>} hashvärdet som base64
 */
export async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256);
  return toBase64(new Uint8Array(bits));
}

/** @returns {{ salt: string, hash: string } | null} */
function savedPin() {
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? 'null');
    return saved && typeof saved.salt === 'string' && typeof saved.hash === 'string' ? saved : null;
  } catch {
    return null;
  }
}

/** @returns {boolean} sant när en PIN-kod är vald på den här enheten */
export function hasPin() {
  return savedPin() !== null;
}

/**
 * Väljer PIN-kod och öppnar låset.
 * @param {string} pin
 * @returns {Promise<void>}
 */
export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  localStorage.setItem(PIN_KEY, JSON.stringify({ salt: toBase64(salt), hash: await hashPin(pin, salt) }));
  unlocked = true;
}

/**
 * @param {string} pin
 * @returns {Promise<boolean>} sant om koden var rätt och låset nu är öppet
 */
export async function unlock(pin) {
  const saved = savedPin();
  if (saved && (await hashPin(pin, fromBase64(saved.salt))) === saved.hash) unlocked = true;
  return unlocked;
}

export function lock() {
  unlocked = false;
}

/** @returns {boolean} */
export function isUnlocked() {
  return unlocked;
}
