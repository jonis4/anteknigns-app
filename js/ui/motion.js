// @ts-check

// Rörelse: en enda väg in för alla animerade ändringar, så att de rör sig på samma sätt.
// Själva animationerna står i app.css och väljs utifrån data-motion på <html>.

/**
 * forward/back: byte av vy. list: rader läggs till, tas bort eller flyttas. morph: AI ändrar texten.
 * @typedef {'forward' | 'back' | 'list' | 'morph'} Motion
 */

const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let current = 0;

/**
 * Gör en ändring av sidan och låter webbläsaren animera mellan före och efter.
 * Utan stöd för View Transitions, eller när användaren valt mindre rörelse, görs ändringen direkt.
 * @param {Motion} motion
 * @param {() => void | Promise<void>} update
 * @returns {Promise<void>} klar när ändringen är gjord (inte när animationen är slut)
 */
export async function animate(motion, update) {
  if (!document.startViewTransition || reduced.matches || document.visibilityState === 'hidden') {
    await update();
    return;
  }
  const id = ++current;
  document.documentElement.dataset.motion = motion;
  const transition = document.startViewTransition(update);
  const done = () => {
    // En nyare animation kan ha tagit över under tiden.
    if (current === id) delete document.documentElement.dataset.motion;
  };
  transition.finished.then(done, done);
  await transition.updateCallbackDone;
}

/** En kort vibration som kvitto på en handling. Finns bara på Android, annars händer inget. */
export function haptic() {
  if (!reduced.matches) navigator.vibrate?.(8);
}
