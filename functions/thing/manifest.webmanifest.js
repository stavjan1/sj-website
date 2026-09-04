// /thing/manifest.webmanifest — the app icon carries the address.
//
// Stav, 3.9.2026: the home-screen app opened /thing/ with no key, ran
// "מקומי בלבד", and asked him to paste an address he never wanted to see.
// The page that has the key asks for the manifest with ?k=, and start_url
// answers with the key in it — so the icon he adds from that page opens the
// tree connected, on any device, with nothing to paste.
import { validKey } from '../api/thing.js';

export async function onRequestGet(context) {
  const k = new URL(context.request.url).searchParams.get('k') || '';
  const start = validKey(k) ? `/thing/#k=${k}` : '/thing/';
  const body = {
    name: 'עץ התובנות', short_name: 'תובנות',
    start_url: start, scope: '/thing/', display: 'standalone', dir: 'rtl', lang: 'he',
    background_color: '#F7F6F3', theme_color: '#F7F6F3',
    icons: [
      { src: '/thing/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/thing/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/thing/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(body), { status: 200, headers: {
    'Content-Type': 'application/manifest+json; charset=utf-8',
    'Cache-Control': 'no-store',
  } });
}
