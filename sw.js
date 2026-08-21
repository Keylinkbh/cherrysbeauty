// Minimal service worker: caches the app shell so the app installs
// as a real app icon and reopens instantly. Data still requires an
// internet connection, since it lives in Supabase, not on the device.

const CACHE = "cherrys-shell-v2";
const SHELL = ["./", "./index.html", "./config.js", "./app.js", "./manifest.json", "./icon-192.png", "./icon-512.png", "./assets/logo-dark-text.png", "./assets/logo-light-text.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache Supabase API calls — always go to the network for data.
  if (url.hostname.includes("supabase.co")) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
