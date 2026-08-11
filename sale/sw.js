// זרם — minimal service worker.
// Purpose: make the app installable (PWA) and let the shell open instantly,
// including offline at a job site (the user's data lives in localStorage
// anyway). AI calls and cloud sync (/api/*) are ALWAYS network-only.
const CACHE = 'zerem-shell-v68';
const SHELL = [
  '/sale/',
  '/sale/index.html',
  '/sale/app.js',
  '/sale/coverage.js',
  '/sale/sketch.js',
  '/sale/styles.css',
  '/sale/manifest.webmanifest',
  '/sale/icons/icon-192.png',
  '/sale/icons/icon-512.png',
  '/assistant.js',
  '/assets/listcards.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;               // never touch writes
  if (url.pathname.startsWith('/api/')) return;          // AI + data: network only
  if (url.origin !== location.origin) return;            // CDN (html2pdf, fonts): browser default
  if (!url.pathname.startsWith('/sale/') && url.pathname !== '/assistant.js' && url.pathname !== '/assets/listcards.js') return;

  // Network-first with cache fallback: fresh app when online, working shell offline.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      // ignoreSearch everywhere under /sale/: the shell is versioned with ?v=NN,
      // so an offline request for app.js?v=46 must still match a cached app.js.
      // Without this the precache is dead weight the moment a version bumps.
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
