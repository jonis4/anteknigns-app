// @ts-check

// Lås för privata anteckningar. PIN-koden döljer dem för den som lånar enheten.
// Det är inget skydd mot den som kommer åt enhetens lagring: anteckningarna är inte krypterade.
// PIN-koden sparas bara på den här enheten, som ett saltat hashvärde.

const PIN_KEY = 'pin';
const RESET_KEY = 'pin-reset';
const ITERATIONS = 100_000;
/** Så länge gäller en begärd återställning. Samma tid som länken i mejlet. */
const RESET_TIME = 60 * 60 * 1000;
export const MIN_LENGTH = 4;

/**
 * @typedef {Object} SavedPin
 * @property {string} salt
 * @property {string} hash
 * @property {string} [email]  // kontot som får återställa koden. Sätts bara av den som kan koden.
 */

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

/** @returns {SavedPin | null} */
function savedPin() {
  try {
    const saved = JSON.parse(localStorage.getItem(PIN_KEY) ?? 'null');
    return saved && typeof saved.salt === 'string' && typeof saved.hash === 'string' ? saved : null;
  } catch {
    return null;
  }
}

/** @param {SavedPin} saved */
function savePin(saved) {
  localStorage.setItem(PIN_KEY, JSON.stringify(saved));
}

/** @returns {boolean} sant när en PIN-kod är vald på den här enheten */
export function hasPin() {
  return savedPin() !== null;
}

/**
 * Väljer PIN-kod och öppnar låset.
 * @param {string} pin
 * @param {string} [email] kontot enheten är inloggad med, om något. Det får återställa koden.
 * @returns {Promise<void>}
 */
export async function setPin(pin, email) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  /** @type {SavedPin} */
  const saved = { salt: toBase64(salt), hash: await hashPin(pin, salt) };
  if (email) saved.email = email;
  savePin(saved);
  unlocked = true;
}

/**
 * @param {string} pin
 * @param {string} [email] kontot enheten är inloggad med, om något
 * @returns {Promise<boolean>} sant om koden var rätt och låset nu är öppet
 */
export async function unlock(pin, email) {
  const saved = savedPin();
  if (!saved || (await hashPin(pin, fromBase64(saved.salt))) !== saved.hash) return false;
  // Den som kan koden får knyta den till sitt konto, t.ex. om enheten loggades in efter att koden valdes.
  if (email && saved.email !== email) savePin({ ...saved, email });
  unlocked = true;
  return true;
}

export function lock() {
  unlocked = false;
}

/** @returns {boolean} */
export function isUnlocked() {
  return unlocked;
}

// --- Glömd PIN-kod ---
// Koden går att välja om av den som kan logga in på kontot den är knuten till.
// Kontot är det som var inloggat när koden valdes eller senast användes, aldrig ett som anges i efterhand:
// annars kunde den som lånar enheten logga in med sin egen mejl och återställa.

/** @returns {string | undefined} kontot som får återställa PIN-koden */
export function resetEmail() {
  return savedPin()?.email;
}

/** Noterar att en återställning har begärts, så att nästa inloggning med rätt konto får välja ny kod. */
export function startReset() {
  localStorage.setItem(RESET_KEY, String(Date.now()));
}

/**
 * Anropas när enheten precis har loggat in via länken i mejlet. Har en återställning begärts nyligen
 * och inloggningen gäller rätt konto tas PIN-koden bort, så att en ny kan väljas.
 * @param {string | undefined} email kontot som just loggade in
 * @param {number} [now]
 * @returns {boolean} sant om PIN-koden togs bort
 */
export function finishReset(email, now = Date.now()) {
  const requested = Number(localStorage.getItem(RESET_KEY));
  localStorage.removeItem(RESET_KEY);
  const saved = savedPin();
  if (!requested || now - requested > RESET_TIME || !saved?.email || saved.email !== email) return false;
  localStorage.removeItem(PIN_KEY);
  unlocked = false;
  return true;
}
