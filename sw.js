// Service worker: network first – haetaan aina ensin verkosta, välimuistia käytetään vain offline-tilassa.
// Origin (tkoljonen-wq.github.io) on jaettu muiden sovellusten kanssa → välimuistilla oma etuliite,
// ja vain tämän sovelluksen vanhat välimuistit poistetaan.
const CACHE_PREFIX = 'martti-paivakirja-';
const CACHE_NAME = CACHE_PREFIX + 'v5';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/store.js',
  './js/export.js',
  './js/util.js',
  './js/chart.js',
  './firebase-config.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable.png',
  './icons/icon-192.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => Promise.all(ASSETS.map(url =>
      fetch(new Request(url, { cache: 'reload' }))
        .then(res => { if (res.ok) return cache.put(url, res); })
        .catch(() => {})
    ))).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys
        .filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
        .map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  // Firebase SDK -moduulit välimuistiin, jotta sovellus käynnistyy myös offline.
  // Firestoren/kirjautumisen omat verkkokutsut jätetään kokonaan rauhaan.
  const firebaseSdk = url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (!sameOrigin && !firebaseSdk) return;

  event.respondWith((async () => {
    try {
      // cache: 'no-cache' ohittaa GitHub Pagesin max-age=600 -HTTP-välimuistin
      const netReq = req.mode === 'navigate'
        ? new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        : new Request(req, { cache: 'no-cache' });
      const res = await fetch(netReq);
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const index = await caches.match('./index.html');
        if (index) return index;
      }
      throw err;
    }
  })());
});
