/*
 * The tombstone of the old Zip worker.
 *
 * A browser with the old app installed re-fetches this file on navigation, sees
 * it has changed, and installs this instead -- which exists only to remove
 * itself, drop the caches it used to keep, and push any open tab through the
 * redirect. It deletes only its own zip-* caches: /puzzles/ lives on the same
 * origin and its cache is visible from here.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith('zip-')).map(n => caches.delete(n)));
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.navigate(client.url).catch(() => {});
  })());
});

// Deliberately no fetch handler: everything goes straight to the network, so
// the redirect page is what people get.
