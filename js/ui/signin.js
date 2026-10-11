// @ts-check
import { AuthError, requestCode, verifyCode } from '../supabase.js';

/** @type {Record<import('../supabase.js').AuthErrorCode, string>} */
const ERRORS = {
  offline: 'Inget nät',
  wait: 'Vänta en stund och försök igen',
  wrong_code: 'Fel kod',
  failed: 'Det gick inte just nu',
};

const form = /** @type {HTMLFormElement} */ (document.getElementById('signin'));
const text = /** @type {HTMLElement} */ (document.getElementById('signin-text'));
const input = /** @type {HTMLInputElement} */ (document.getElementById('signin-input'));
const button = /** @type {HTMLButtonElement} */ (document.getElementById('signin-button'));
const status = /** @type {HTMLElement} */ (document.getElementById('signin-status'));

/** Tom tills mejlet har skickats. Då är det koden som ska fyllas i, om mejlet innehåller en. */
let email = '';

/**
 * @param {() => void} onSignedIn anropas när enheten är inloggad
 */
export function initSignIn(onSignedIn) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (value === '' || button.disabled) return;
    button.disabled = true;
    status.textContent = '';
    try {
      if (email === '') {
        await requestCode(value);
        askForCode(value);
      } else {
        await verifyCode(email, value);
        onSignedIn();
      }
    } catch (err) {
      status.textContent = ERRORS[err instanceof AuthError ? err.code : 'failed'];
    } finally {
      button.disabled = false;
    }
  });
}

/** Börjar om från mejladressen. */
export function resetSignIn() {
  email = '';
  text.textContent = 'Synka anteckningarna mellan dina enheter. Ange din mejladress, så skickas en länk dit.';
  input.type = 'email';
  input.inputMode = 'email';
  input.autocomplete = 'email';
  input.setAttribute('aria-label', 'Mejladress');
  input.required = true;
  input.value = '';
  button.textContent = 'Skicka';
  status.textContent = '';
  input.focus();
}

/** @param {string} address */
function askForCode(address) {
  email = address;
  text.textContent = `Öppna länken i mejlet som skickades till ${address}. Står det en kod i mejlet går den också att skriva här.`;
  input.type = 'text';
  input.inputMode = 'numeric';
  input.autocomplete = 'one-time-code';
  input.setAttribute('aria-label', 'Kod');
  input.required = false;
  input.value = '';
  button.textContent = 'Logga in';
  input.focus();
}
