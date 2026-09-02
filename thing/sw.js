// עץ התובנות — offline shell.
//
// Stav, 3.9.2026: "זה לא יעבוד לי אם אני בלי קליטה". The tree itself never
// needed a signal (it lives in localStorage first); what needed one was
// opening the page. So: the shell is cached at install, served network-first
// (a deploy still arrives on the next open with signal) and from the cache
// when the network is gone. The API is never cached — a stale tree served as
// fresh would be worse than "לא מקוון".
const CACHE = 'thing-shell-v2';
const SHELL = ['/thing/', '/thing/index.html', '/thing/thing.js', '/assets/tokens.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('thing-shell-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/')) return;                    // never cached
  if (url.pathname.endsWith('.webmanifest')) return;              // carries the key in its query — never from cache
  const isShell = url.origin === location.origin && (url.pathname.startsWith('/thing/') || url.pathname === '/assets/tokens.css');
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!isShell && !isFont) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // The URL carries ?v=; the cache is keyed without it so a bumped version
    // still finds yesterday's copy when there is no signal.
    const key = isShell ? new Request(url.origin + url.pathname) : e.request;
    try {
      const fresh = await fetch(e.request, { cache: 'reload' });
      if (fresh && fresh.ok) cache.put(key, fresh.clone());
      return fresh;
    } catch {
      const hit = await cache.match(key) || (isShell && url.pathname.startsWith('/thing/') && !url.pathname.endsWith('.js') && !url.pathname.endsWith('.webmanifest') ? await cache.match('/thing/index.html') : null);
      return hit || new Response('אין קליטה, והדף עוד לא נשמר במכשיר.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
