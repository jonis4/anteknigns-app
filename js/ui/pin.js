// @ts-check
import { MIN_LENGTH, hasPin, resetEmail, setPin, startReset, unlock } from '../lock.js';
import { requestCode, signedInEmail } from '../supabase.js';

const form = /** @type {HTMLFormElement} */ (document.getElementById('pin'));
const text = /** @type {HTMLElement} */ (document.getElementById('pin-text'));
const input = /** @type {HTMLInputElement} */ (document.getElementById('pin-input'));
const button = /** @type {HTMLButtonElement} */ (document.getElementById('pin-button'));
const forgotButton = /** @type {HTMLButtonElement} */ (document.getElementById('pin-forgot'));
const status = /** @type {HTMLElement} */ (document.getElementById('pin-status'));

/** Koden som valdes i första steget, när en ny PIN-kod ska skrivas två gånger. */
let chosen = '';

/**
 * @param {() => void} onUnlocked anropas när låset är öppet, med en ny eller befintlig PIN-kod
 */
export function initPin(onUnlocked) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const pin = input.value;
    if (button.disabled) return;
    status.textContent = '';

    if (hasPin()) {
      button.disabled = true;
      const ok = await unlock(pin, signedInEmail());
      button.disabled = false;
      if (ok) onUnlocked();
      else ask('PIN-kod', 'Lås upp', 'Fel PIN-kod');
    } else if (!/^\d+$/.test(pin) || pin.length < MIN_LENGTH) {
      status.textContent = `Minst ${MIN_LENGTH} siffror`;
    } else if (chosen === '') {
      chosen = pin;
      ask('Skriv PIN-koden en gång till.', 'Spara');
    } else if (pin !== chosen) {
      chosen = '';
      ask(`Välj en PIN-kod för privata anteckningar, minst ${MIN_LENGTH} siffror.`, 'Fortsätt', 'Koderna var olika');
    } else {
      await setPin(pin, signedInEmail());
      onUnlocked();
    }
  });

  forgotButton.addEventListener('click', forgot);
}

/** Börjar om: fråga efter PIN-koden, eller låt användaren välja en om ingen finns. */
export function resetPin() {
  chosen = '';
  if (hasPin()) ask('PIN-kod', 'Lås upp');
  else ask(`Välj en PIN-kod för privata anteckningar, minst ${MIN_LENGTH} siffror.`, 'Fortsätt');
}

/**
 * Glömd PIN-kod: skickar en inloggningslänk till kontot som koden är knuten till.
 * När länken öppnas på enheten får man välja en ny kod (se finishReset i lock.js).
 * @returns {Promise<void>}
 */
async function forgot() {
  const email = resetEmail();
  if (!email || email !== signedInEmail()) {
    status.textContent = 'Går bara när enheten är inloggad via Synka';
    return;
  }
  forgotButton.disabled = true;
  status.textContent = '';
  try {
    await requestCode(email);
    startReset();
    text.textContent = `Öppna länken i mejlet som skickades till ${email}, på den här enheten. Sedan får du välja en ny PIN-kod.`;
  } catch {
    status.textContent = 'Det gick inte just nu';
  } finally {
    forgotButton.disabled = false;
  }
}

/**
 * @param {string} question
 * @param {string} action
 * @param {string} [message]
 */
function ask(question, action, message = '') {
  text.textContent = question;
  button.textContent = action;
  status.textContent = message;
  // Bara den som ska låsa upp kan ha glömt koden.
  forgotButton.hidden = !hasPin();
  input.value = '';
  input.focus();
}
