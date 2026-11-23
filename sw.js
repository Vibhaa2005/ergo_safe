// sw.js — service worker: lets the app install and work offline.
//
// App files: NETWORK FIRST. When online, every file comes fresh from the
// server (revalidated, never a stale browser-cache copy), so old and new
// files can never be mixed after an update. The saved copy is used only
// when offline.
// Pose model + MediaPipe files (other websites): cached after first use —
// they are fixed for a version and large, so they are read from the cache.

const CACHE_VERSION = 'ergosafe-v19';
const RUNTIME_CACHE = 'ergosafe-runtime-v1';

const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/storage.js',
  './js/ui.js',
  './js/anthropometry.js',
  './js/workers.js',
  './js/pose.js',
  './js/rula.js',
  './js/reba.js',
  './js/recommendations.js',
  './js/posture.js',
  './js/noiseMath.js',
  './js/noise.js',
  './js/dashboard.js',
  './js/riskModel.js',
  './js/riskViews.js',
  './js/profile.js',
  './js/priorityActions.js',
  './js/report.js',
  './report.html',
  './css/report.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
];

const RUNTIME_HOSTS = ['cdn.jsdelivr.net', 'storage.googleapis.com'];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_VERSION).then(function (cache) {
      // cache: 'reload' skips the browser's HTTP cache so the saved copy is
      // the version that was just published.
      return cache.addAll(APP_FILES.map(function (path) { return new Request(path, { cache: 'reload' }); }));
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        if (name !== CACHE_VERSION && name !== RUNTIME_CACHE) {
          return caches.delete(name);
        }
        return null;
      }));
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  // Pose model and MediaPipe: cache first.
  if (RUNTIME_HOSTS.indexOf(url.hostname) !== -1) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(function (cache) {
        return cache.match(request).then(function (cached) {
          if (cached) {
            return cached;
          }
          return fetch(request).then(function (response) {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          });
        });
      })
    );
    return;
  }

  // Own files: network first, saved copy only when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (response) {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then(function (cache) { cache.put(request, copy); });
        }
        return response;
      }).catch(function () {
        return caches.open(CACHE_VERSION).then(function (cache) {
          return cache.match(request, { ignoreSearch: true }).then(function (cached) {
            if (cached) {
              return cached;
            }
            // Offline page loads (e.g. index.html#risk) fall back to the saved app page.
            return request.mode === 'navigate' ? cache.match('./index.html') : Response.error();
          });
        });
      })
    );
  }
});
