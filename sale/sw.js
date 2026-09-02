// זרם — minimal service worker.
// Purpose: make the app installable (PWA) and let the shell open instantly,
// including offline at a job site (the user's data lives in localStorage
// anyway). AI calls and cloud sync (/api/*) are ALWAYS network-only.
const CACHE = 'zerem-shell-v368';

// The typeface and the icons come from other people's servers, and at a job
// site there is no reception to fetch them with. Without them the app is a wall
// of blank squares and — worse — a quote drafted on site prints in a different
// font than one drafted at home, because the PDF asks for Heebo and gets
// whatever the phone has.
//
// Kept in its own cache on purpose: the shell cache is wiped on every deploy,
// and evicting the fonts each time would mean needing reception again right
// after an update, which is precisely when it is not there.
// v2: wiped once in V3.0.1 — a stale/poisoned cached font response could leave
// the icon font permanently broken on a device, and this cache never expires.
const CDN_CACHE = 'zerem-cdn-v2';
const CDN_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'cdnjs.cloudflare.com'];
const SHELL = [
  '/sale/',
  '/sale/index.html',
  '/sale/app.js',
  '/sale/chat.js',
  '/sale/checkups.js',
  '/sale/market.js',
  '/sale/reports.js',
  '/sale/admin.js',
  '/sale/helper.js',
  '/sale/finance.js',
  '/sale/coach.js',
  '/sale/nextstep.js',
  '/sale/coverage.js',
  '/sale/css/shell.css',
  '/sale/css/panels.css',
  '/sale/css/pdf.css',
  '/sale/controlroom.css',
  '/sale/periodic.css',
  '/sale/nextstep.css',
  '/sale/vendor/fontawesome/css/all.min.css',
  '/sale/vendor/fontawesome/webfonts/fa-solid-900.woff2',
  '/sale/vendor/fontawesome/webfonts/fa-brands-400.woff2',
  '/sale/vendor/fontawesome/webfonts/fa-regular-400.woff2',
  '/assets/tokens.css',
  '/assets/ui.css',
  '/sale/manifest.webmanifest',
  '/sale/icons/icon-192.png',
  '/sale/icons/icon-512.png',
  '/assistant.js',
  '/assets/listcards.js',
  '/assets/checkups-core.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE && k !== CDN_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;               // never touch writes
  if (url.pathname.startsWith('/api/')) return;          // AI + data: network only

  // Fonts and icons: keep whatever we were served, and serve it again offline.
  // Cache-first, because these URLs are immutable — cdnjs pins the version in
  // the path and Google Fonts hashes the file name — so there is nothing to
  // revalidate and a job site should not wait on a request that will time out.
  // Google's auth scripts are deliberately not here: they are useless offline
  // and must never be replayed stale.
  if (CDN_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        // An opaque response (no-cors, as a plain stylesheet link makes) reports
        // status 0 and ok=false. Checking res.ok alone would cache nothing at
        // all, which is the failure this whole branch exists to prevent.
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(CDN_CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match(e.request)))
    );
    return;
  }

  if (url.origin !== location.origin) return;            // anything else third-party: browser default
  if (!url.pathname.startsWith('/sale/') && !url.pathname.startsWith('/assets/') && url.pathname !== '/assistant.js') return;

  // "Network-first" is only as fresh as the fetch underneath it, and a plain
  // fetch() is still allowed to be answered by the browser's HTTP cache. That
  // was observed: the server had index.html at ?v=66, the worker had ?v=65, and
  // the browser rendered ?v=65 — a whole deploy behind. Because the HTML is
  // what carries the ?v= for every other file, one stale page means the entire
  // app is stale.
  //
  // Versioned assets are exempt: a ?v= URL is immutable, so revalidating it
  // every time would cost a round trip to be told nothing changed.
  const isShell = e.request.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');
  const request = isShell ? new Request(e.request, { cache: 'reload' }) : e.request;

  // Network-first with cache fallback: fresh app when online, working shell offline.
  e.respondWith(
    fetch(request)
      .then((res) => {
        const copy = res.clone();
        // Keyed on the original request, so the offline lookup below still finds it.
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      // ignoreSearch everywhere under /sale/: the shell is versioned with ?v=NN,
      // so an offline request for app.js?v=46 must still match a cached app.js.
      // Without this the precache is dead weight the moment a version bumps.
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
