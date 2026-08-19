const MIGRATION_CACHE = "cajafamiliar-pwa-update-migration-v1";
const MIGRATION_MARKER = new URL("/__pwa-update-migration-v1__", self.location.origin).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(MIGRATION_CACHE);
      const alreadyMigrated = await cache.match(MIGRATION_MARKER);

      if (alreadyMigrated) return;

      await cache.put(
        MIGRATION_MARKER,
        new Response("done", { headers: { "content-type": "text/plain" } })
      );

      await self.skipWaiting();
    })()
  );
});
