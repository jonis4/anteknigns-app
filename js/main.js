// @ts-check

/**
 * Registrerar service workern så att appen går att installera och öppnar offline.
 * @returns {Promise<void>}
 */
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (err) {
    console.error('Service workern kunde inte registreras', err);
  }
}

registerServiceWorker();
