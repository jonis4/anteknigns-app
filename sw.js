// @ts-check
/// <reference lib="webworker" />

// Bumpa versionen vid varje deploy, annars ligger gammal kod kvar i cachen.
const CACHE = 'notes-v5';

/** Appens filer, relativa till sw.js så att det funkar under /<reponamn>/. */
const FILES = [
  './',
  './index.html',
  './app.css',
  './js/main.js',
  './js/store.js',
  './js/supabase.js',
  './js/ai.js',
  './js/sync.js',
  './js/lock.js',
  './js/ui/editor.js',
  './js/ui/list.js',
  './js/ui/signin.js',
  './js/ui/pin.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(removeOldCaches());
});

sw.addEventListener('fetch', (event) => {
  // Bara appens egna filer. Anrop till Supabase går alltid direkt till nätet.
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== sw.location.origin) return;
  event.respondWith(cacheFirst(event.request));
});

/** @returns {Promise<void>} */
async function precache() {
  const cache = await caches.open(CACHE);
  // 'reload' går förbi webbläsarens HTTP-cache så att en ny version verkligen hämtar nya filer.
  await cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' })));
  await sw.skipWaiting();
}

/** @returns {Promise<void>} */
async function removeOldCaches() {
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
  await sw.clients.claim();
}

/**
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  return cached ?? fetch(request);
}
