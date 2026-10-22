// Network first so updates show up right away; the cache is only used offline.
const CACHE = 'daily-tracking-v29';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'css/colors.css',
  'css/features.css',
  'css/features-color.css',
  'js/util.js',
  'js/store.js',
  'js/pairs.js',
  'js/tags.js',
  'js/accounts.js',
  'js/perf.js',
  'js/money.js',
  'js/news.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Never touch GitHub API calls or anything not from this site.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // 'no-cache' asks the server whether a file changed (cheap when it hasn't),
    // so a new version shows up on the next open instead of up to 10 min later.
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(r => r || caches.match('index.html')))
  );
});
