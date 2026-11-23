// sw.js — service worker: lets the app install and work offline.
// App files: served from cache, refreshed in the background.
// Pose model + MediaPipe files (other websites): cached after first use.

const CACHE_VERSION = 'ergosafe-v6';
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
    caches.open(CACHE_VERSION).then(function (cache) { return cache.addAll(APP_FILES); })
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
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  if (request.method !== 'GET') {
    return;
  }
  const url = new URL(request.url);

  // Pose model and MediaPipe: cache first (they never change for a version).
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

  // Own files: answer from cache straight away, update cache from network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(function (cache) {
        return cache.match(request, { ignoreSearch: true }).then(function (cached) {
          const networkFetch = fetch(request).then(function (response) {
            if (response.ok) {
              cache.put(request, response.clone());
            }
            return response;
          }).catch(function () {
            return cached;
          });
          return cached || networkFetch;
        });
      })
    );
  }
});
