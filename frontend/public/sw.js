const CACHE_VERSION = "__CACHE_VERSION__";
const resolvedVersion = CACHE_VERSION === "__CACHE_VERSION__" ? "dev" : CACHE_VERSION;
const CACHE_NAME = `noma-maintenance-${resolvedVersion}`;
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./404.html",
  "./manifest.json",
  "./favicon.ico",
  "./logo-white.webp",
  "./app-images/android/android-launchericon-192-192.png",
  "./app-images/android/android-launchericon-512-512.png",
  "./app-images/ios/180.png",
  "./app-images/ios/32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  if (!event.request.url.startsWith(self.location.origin)) return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        const responseClone = response.clone();
        const cache = await caches.open(CACHE_NAME);
        cache.put(event.request, responseClone);
        return response;
      } catch (error) {
        return cached ?? Response.error();
      }
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.map((key) => caches.delete(key))),
      ),
    );
    self.skipWaiting();
  }
});
