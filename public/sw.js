/*
 * Offline support.
 *
 * Vite hashes asset filenames, so rather than precaching a list that would go
 * stale on every build, this caches at runtime: the shell is fetched from the
 * network first so a deploy is picked up promptly, and hashed assets are
 * cache-first because their names change whenever their contents do.
 */
const CACHE = 'zip-v2';

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(['./', './index.html'])).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Navigations: network first, and deliberately bypassing the HTTP cache.
   * The host serves the shell with max-age=600, so a plain fetch here can hand
   * back a ten-minute-old page -- long enough to be told about a change and not
   * see it. The shell is under 3 KB and the assets it names are content-hashed,
   * so revalidating it on every navigation costs almost nothing.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request.url, { cache: 'no-cache' })
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html').then(hit => hit ?? Response.error()))
    );
    return;
  }

  // Everything else is content-addressed by filename, so the cache cannot be stale.
  event.respondWith(
    caches.match(request).then(hit => hit ?? fetch(request).then(response => {
      if (response.ok) {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    }))
  );
});
