// sw.js — Service Worker simple para Phone Inspection
const CACHE_NAME = "phone-inspection-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./style.css",
  "./script.js"
];

// Instala el service worker y guarda los archivos en caché
self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
});

// Activa el nuevo service worker y limpia cachés viejas
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => k !== CACHE_NAME && caches.delete(k)))
    )
  );
});

// Intercepta peticiones y responde desde caché si existe
self.addEventListener("fetch", event => {
  event.respondWith(
    caches.match(event.request).then(resp => resp || fetch(event.request))
  );
});
