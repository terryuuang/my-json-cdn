/** App shell updates are atomic; live APIs and map tiles are never archived. */
const APP_VERSION = '0.6.2';
// 退場中的舊網域：不預載、不攔截、主動註銷，讓訪客拿到帶有導向邏輯的最新頁面。
const LEGACY_HOST = 'rnap.riotoolkit.cc';
const IS_LEGACY_HOST = self.location.hostname === LEGACY_HOST;
const CACHE_NAME = `apeintel-atlas-shell-v${APP_VERSION}`;
const DATA_CACHE = 'apeintel-atlas-data-v1';
const CORE_ASSETS = [
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/static/css/main.css',
  '/static/js/map_state.js',
  '/static/js/geo_shapes.js',
  '/static/js/map_init.js',
  '/static/js/markers_render.js',
  '/static/js/panel_ui.js',
  '/static/js/location_search.js',
  '/static/js/bootstrap.js',
  '/static/js/equipment_parser.js',
  '/static/js/search_utils.js',
  '/static/js/shape_utils.js',
  '/static/js/shape_color.js',
  '/static/js/osm_facilities.js',
  '/static/js/unified_dropdown.js',
  '/static/js/notes.js',
  '/static/js/pla_theater.js',
  '/static/js/adiz.js',
  '/static/js/maritime_zones.js',
  '/static/js/submarine_cable.js',
  '/static/js/ais_snapshot.js',
  '/static/js/pwa.js',
  '/static/js/island_activity.js',
  '/static/js/osint_weather.js',
  '/static/assets/APEINTEL ATLAS_192x192.png',
  '/static/assets/APEINTEL ATLAS_512x512.png',
  '/static/css/pwa.css',
  '/static/assets/app-maskable-512.png',
  '/static/assets/atlas-companion.webp',
  '/static/assets/APP_LOGO_180x180.png',
  '/static/assets/APP_LOGO_192x192.png',
  '/static/assets/APP_LOGO_512x512.png'
];
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/layers.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/layers-2x.png',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/images/spritesheet.svg',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff2?dd67030699838ea613ee6dbda90effa6',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/fonts/bootstrap-icons.woff?dd67030699838ea613ee6dbda90effa6',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js'
];
const ASSETS = [...CORE_ASSETS, ...CDN_ASSETS];
const assetURLs = new Set(ASSETS.map(path => new URL(path, self.location.origin).href));
const MAIN_DATA = '/geojson/joseph_w.geojson';

self.addEventListener('install', event => {
  if (IS_LEGACY_HOST) {
    // Retirement is not a feature update, so it must not wait for the user's consent.
    event.waitUntil(self.skipWaiting());
    return;
  }
  // A missing dependency must not replace a working offline installation.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(ASSETS.map(url => new Request(url, { cache: 'reload' })));
    try {
      await refreshData(new Request(new URL(MAIN_DATA, self.location.origin)));
    } catch (_) { /* Existing dataset remains available when offline. */ }
    // Updates wait for the user's explicit action or for all old tabs to close.
  })());
});

self.addEventListener('activate', event => {
  if (IS_LEGACY_HOST) {
    event.waitUntil((async () => {
      await Promise.all((await caches.keys()).map(key => caches.delete(key)));
      await self.registration.unregister();
      const windows = await self.clients.matchAll({ type: 'window' });
      // The reload lands on the canonical host; the page's own guard does the hop.
      await Promise.all(windows.map(client => client.navigate(client.url).catch(() => {})));
    })());
    return;
  }
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('apeintel-atlas-') &&
      key !== CACHE_NAME && key !== DATA_CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function refreshData(request) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let response;
  try {
    response = await fetch(request, { signal: controller.signal, cache: 'no-cache' });
    // Finish reading before clearing the timeout, including stalled bodies.
    if (response.ok) {
      response = new Response(await response.blob(), {
        status: response.status, statusText: response.statusText, headers: response.headers
      });
    }
  } finally { clearTimeout(timeout); }
  if (response.ok && response.type !== 'opaque') {
    const cache = await caches.open(DATA_CACHE);
    const headers = new Headers(response.headers);
    headers.delete('Content-Encoding');
    headers.delete('Content-Length');
    headers.set('X-Atlas-Cached-At', new Date().toISOString());
    await cache.put(request, new Response(await response.clone().blob(), {
      status: response.status, statusText: response.statusText, headers
    }));
    // Keep storage bounded; retain the main dataset for offline launches.
    const keys = await cache.keys();
    const extras = keys.filter(key => new URL(key.url).pathname !== MAIN_DATA);
    await Promise.all(extras.slice(0, Math.max(0, extras.length - 24)).map(key => cache.delete(key)));
  }
  return response;
}

self.addEventListener('fetch', event => {
  if (IS_LEGACY_HOST) return;
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || !/^https?:$/.test(url.protocol)) return;

  if (request.mode === 'navigate' && url.origin === self.location.origin) {
    // One versioned shell for all coordinate / shape links, including offline.
    event.respondWith((async () => {
      const shell = await (await caches.open(CACHE_NAME)).match('/index.html');
      return shell || fetch(request);
    })());
    return;
  }
  if (assetURLs.has(url.href)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      return (await cache.match(request)) || fetch(request);
    })());
    return;
  }
  // Only local, published datasets. AIS, weather, search, analytics and tiles
  // pass through to the network so old observations cannot look like live data.
  if (url.origin === self.location.origin &&
      /^\/(?:geojson|static\/geojson)\/[^?]+\.(?:geojson|json)$/.test(url.pathname) && !url.search) {
    const report = async online => {
      if (url.pathname !== MAIN_DATA) return;
      const client = await self.clients.get(event.clientId);
      client?.postMessage({ type: 'DATA_CONNECTION', online });
    };
    const refresh = refreshData(request).then(async response => {
      await report(response.ok);
      return response;
    }).catch(async () => { await report(false); return null; });
    event.waitUntil(refresh);
    event.respondWith((async () => {
      const cached = await (await caches.open(DATA_CACHE)).match(request);
      return cached || await refresh || new Response('此資料尚未儲存，請連線後再試', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    })());
  }
});

self.addEventListener('message', event => {
  const reply = value => event.ports[0]?.postMessage(value);
  switch (event.data?.type) {
    case 'GET_VERSION':
      reply({ version: APP_VERSION });
      break;
    case 'SKIP_WAITING':
      event.waitUntil(self.skipWaiting());
      break;
    case 'OFFLINE_STATUS':
      event.waitUntil((async () => {
        const cache = await caches.open(DATA_CACHE);
        const data = await cache.match(MAIN_DATA);
        reply({ ready: !!data, cachedAt: data?.headers.get('X-Atlas-Cached-At') });
      })());
      break;
    case 'CLEAR_CACHE':
      // Preserve the app shell and IndexedDB notes. Remove only downloaded data.
      event.waitUntil(caches.delete(DATA_CACHE).then(() => reply({ success: true })));
      break;
    case 'CHECK_UPDATE':
      event.waitUntil(self.registration.update());
      break;
  }
});
