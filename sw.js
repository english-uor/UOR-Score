/* Score-UOR service worker.
   Everything the app needs is cached on install, so opening it is instant and works with no internet.
   Files are served from the cache first and refreshed in the background (stale-while-revalidate). */
const VERSION = 'score-uor-v1.3.0';
const SHELL = [
  './', 'index.html', 'css/styles.css', 'manifest.webmanifest',
  'js/vendor/capacitor.js', 'js/vendor/exceljs.min.js', 'js/vendor/docx.iife.js',
  'js/config.js', 'js/i18n.js', 'js/core.js', 'js/local.js', 'js/native.js', 'js/exports.js', 'js/teacher.js',
  'js/tabs-grading.js', 'js/tabs-register.js', 'js/tabs-more.js', 'js/tabs-files.js', 'js/main.js',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon.svg', 'icons/apple-touch-icon.png',
  'fonts/InstrumentSans.woff2', 'fonts/NotoKufiArabic.woff2'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // One missing file must not stop the whole install, so each is added on its own.
      .then((c) => Promise.all(SHELL.map((url) => c.add(url).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req, { ignoreSearch: true }).then((hit) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(() => hit || cache.match('index.html'));
        // Answer from the cache at once; the network copy updates it for next time.
        return hit || fresh;
      })
    )
  );
});
