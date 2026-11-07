// AlertMap: оболонка працює без інтернету; карти/скрипти з CDN кешуються під час перегляду
const V = 'alertmap-v16', TILES = 'alertmap-tiles';
const SHELL = ['/', '/index.html', '/manifest.json', '/avatar.png', '/avatar-192.png', '/oblasts.json', '/raions.json', '/kyiv.json', '/settlements.json'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
async function trim(c) { const ks = await c.keys(); if (ks.length > 600) for (const k of ks.slice(0, ks.length - 600)) await c.delete(k); }
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin === location.origin) {
    if (u.pathname.startsWith('/api/')) return; // живі дані завжди з сервера (останній стан клієнт зберігає сам)
    e.respondWith(fetch(r).then(res => { if (res.ok) { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); } return res; })
      .catch(() => caches.match(r, { ignoreSearch: true }).then(m => m || caches.match('/'))));
    return;
  }
  if (/cdnjs\.cloudflare\.com|arcgisonline\.com|tiles\.maps\.eox\.at/.test(u.host)) {
    e.respondWith(caches.match(r).then(m => m || fetch(r).then(res => {
      if (res.ok || res.type === 'opaque') { const cp = res.clone(); caches.open(TILES).then(c => c.put(r, cp).then(() => trim(c))); }
      return res;
    })));
  }
});
