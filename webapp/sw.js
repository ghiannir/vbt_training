// Offline cache of the app shell (WA-70). Bump CACHE when any file below changes.
const CACHE = "vbt-shell-v3";
const SHELL = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "icon.svg",
  "css/style.css",
  "js/main.js",
  "js/ui.js",
  "js/ble.js",
  "js/simulator.js",
  "js/protocol.js",
  "js/session.js",
  "js/storage.js",
  "js/github.js",
  "js/lvprofile.js",
];

// No skipWaiting() here: a new version waits until the user taps "Ricarica",
// so the app never swaps code in the middle of a set (WA-72).
self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for same-origin GETs only: api.github.com (cross-origin) always goes to the network.
// ?demo=1 and other query strings share the cached page.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)),
  );
});
