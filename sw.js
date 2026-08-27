/* Panda service worker — network-first so updates reach users immediately.
   Falls back to cache only when offline. Old caches are cleared on activate. */
const CACHE = 'panda-cache-2026-08-27-external-api-only-five-photos-v9';

self.addEventListener('install', function(){
  self.skipWaiting();
});

self.addEventListener('activate', function(e){
  e.waitUntil((async function(){
    const keys = await caches.keys();
    await Promise.all(keys.filter(function(k){ return k.indexOf('panda-cache-') === 0 && k !== CACHE; }).map(function(k){ return caches.delete(k); }));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', function(e){
  const req = e.request;
  if(req.method !== 'GET') return;
  const url = new URL(req.url);

  /* Never intercept API calls — always live from the network. */
  if(url.pathname.indexOf('/api/') > -1 || url.hostname.indexOf('vercel.app') > -1) return;

  /* Network-first: fetch fresh, cache a copy of same-origin OK responses,
     fall back to cache (then cached index for navigations) when offline. */
  e.respondWith((async function(){
    try{
      const fresh = await fetch(req);
      if(fresh && fresh.status === 200 && url.origin === self.location.origin){
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    }catch(err){
      const cached = await caches.match(req);
      if(cached) return cached;
      if(req.mode === 'navigate'){
        const idx = await caches.match('./index.html');
        if(idx) return idx;
      }
      throw err;
    }
  })());
});

