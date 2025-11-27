/**
 * Service Worker - APEINTEL ATLAS PWA
 * 版本：v0.0.5
 * 功能：快取管理、離線支援、自動更新
 * 
 * ============================================
 * 📋 版本更新規則 (Version Control Rules)
 * ============================================
 * 
 * 版本格式：X.Y.Z (Major.Minor.Patch)
 * 
 * 🔹 Patch 更新 (0.0.X → 0.0.X+1)
 *    - 修復 Bug
 *    - 小幅 UI 調整
 *    - 文字修正
 *    - 效能優化
 *    範例：0.0.1 → 0.0.2
 * 
 * 🔸 Minor 更新 (0.X.0 → 0.X+1.0)
 *    - 新增功能
 *    - 新增圖層或資料來源
 *    - 介面重新設計
 *    - 新增 API 整合
 *    範例：0.1.0 → 0.2.0
 * 
 * 🔺 Major 更新 (X.0.0 → X+1.0.0)
 *    - 重大架構變更
 *    - 不相容的 API 變更
 *    - 全新版本發布
 *    範例：1.0.0 → 2.0.0
 * 
 * ============================================
 * 🔄 如何更新版本
 * ============================================
 * 
 * 1. 修改下方 APP_VERSION 常數（唯一需要修改的地方）
 * 2. 同步修改 manifest.json 中的 version 欄位（非必要但建議）
 * 3. 推送到 GitHub，Cloudflare CDN 會自動更新
 * 4. 使用者下次訪問時會自動收到更新提示
 * 
 * ⚠️ 注意事項：
 * - Service Worker 會在背景自動檢查更新
 * - 新版本安裝後，舊快取會自動清除
 * - 使用者可手動透過 PWA.clearCache() 清除快取
 * - 若 Cloudflare 快取延遲，可在 Dashboard 手動 Purge Cache
 * 
 * ============================================
 */

// ============================================
// 版本與快取設定
// ============================================
const APP_VERSION = '0.1.0';
const CACHE_NAME = `apeintel-atlas-v${APP_VERSION}`;

// 需要快取的核心資源
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/.well-known/web-app-origin-association',
  '/static/css/main.css',
  '/static/js/main.js',
  '/static/js/equipment_parser.js',
  '/static/js/search_utils.js',
  '/static/js/shape_utils.js',
  '/static/js/osm_facilities.js',
  '/static/js/unified_dropdown.js',
  '/static/js/notes.js',
  '/static/js/supabase_auth.js',
  '/static/js/chat.js',
  '/static/js/pwa.js',
  '/static/assets/APEINTEL ATLAS_192x192.png',
  '/static/assets/APEINTEL ATLAS_512x512.png'
];

// CDN 資源（快取但不影響安裝）
const CDN_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.css',
  'https://unpkg.com/leaflet-draw@1.0.4/dist/leaflet.draw.js',
  'https://unpkg.com/leaflet.polylinemeasure/Leaflet.PolylineMeasure.css',
  'https://unpkg.com/leaflet.polylinemeasure/Leaflet.PolylineMeasure.min.js',
  'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css',
  'https://cdn.jsdelivr.net/npm/opencc-js@1.0.5/dist/umd/full.js',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js'
];

// ============================================
// Service Worker 安裝事件
// ============================================
self.addEventListener('install', (event) => {
  console.log(`[SW] 安裝中... 版本 ${APP_VERSION}`);
  
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] 快取核心資源');
        return cache.addAll(CORE_ASSETS);
      })
      .then(() => {
        // 立即啟用新 Service Worker（不等待舊的關閉）
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] 安裝失敗:', error);
      })
  );
});

// ============================================
// Service Worker 啟動事件
// ============================================
self.addEventListener('activate', (event) => {
  console.log(`[SW] 啟動中... 版本 ${APP_VERSION}`);
  
  event.waitUntil(
    Promise.all([
      // 清除舊版本快取
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((cacheName) => {
              return cacheName.startsWith('apeintel-atlas-') && cacheName !== CACHE_NAME;
            })
            .map((cacheName) => {
              console.log(`[SW] 刪除舊快取: ${cacheName}`);
              return caches.delete(cacheName);
            })
        );
      }),
      // 立即接管所有頁面
      self.clients.claim()
    ]).then(() => {
      // 通知所有客戶端有新版本
      return self.clients.matchAll().then((clients) => {
        clients.forEach((client) => {
          client.postMessage({
            type: 'SW_ACTIVATED',
            version: APP_VERSION
          });
        });
      });
    })
  );
});

// ============================================
// 網路請求攔截（快取策略）
// ============================================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 跳過非 GET 請求
  if (request.method !== 'GET') {
    return;
  }

  // 跳過 Chrome 擴充功能請求
  if (url.protocol === 'chrome-extension:') {
    return;
  }

  // GeoJSON 和 JSON 資料：Network First（確保資料最新）
  if (request.url.endsWith('.geojson') || request.url.endsWith('.json')) {
    event.respondWith(networkFirst(request));
    return;
  }

  // API 請求：Network Only（不快取）
  if (url.pathname.includes('/api/') || url.hostname.includes('overpass-api')) {
    event.respondWith(fetch(request));
    return;
  }

  // CDN 資源：Cache First with Network Fallback
  if (url.hostname !== location.hostname) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // 本地靜態資源：Stale While Revalidate（快取優先，背景更新）
  event.respondWith(staleWhileRevalidate(request));
});

// ============================================
// 快取策略函式
// ============================================

/**
 * 快取優先策略（適用於 CDN 資源）
 */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) {
    return cached;
  }
  
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.error('[SW] 網路請求失敗:', error);
    return new Response('Network error', { status: 503 });
  }
}

/**
 * 網路優先策略（適用於資料檔案）
 */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    console.log('[SW] 網路不可用，使用快取');
    const cached = await caches.match(request);
    if (cached) {
      return cached;
    }
    return new Response('Offline', { status: 503 });
  }
}

/**
 * 快取優先 + 背景更新策略（適用於靜態資源）
 */
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  
  // 背景更新快取
  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);

  // 有快取就先回傳，沒有就等網路
  return cached || fetchPromise;
}

// ============================================
// 訊息處理
// ============================================
self.addEventListener('message', (event) => {
  const { type, data } = event.data || {};

  switch (type) {
    case 'GET_VERSION':
      // 回傳當前版本
      event.ports[0]?.postMessage({ version: APP_VERSION });
      break;

    case 'SKIP_WAITING':
      // 強制跳過等待，立即啟用新 SW
      self.skipWaiting();
      break;

    case 'CLEAR_CACHE':
      // 清除所有快取
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => caches.delete(cacheName))
        );
      }).then(() => {
        event.ports[0]?.postMessage({ success: true });
      });
      break;

    case 'CHECK_UPDATE':
      // 檢查更新（強制重新下載 SW）
      self.registration.update();
      break;
  }
});

// ============================================
// 推播通知處理（未來擴充用）
// ============================================
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  const title = data.title || 'APEINTEL ATLAS';
  const options = {
    body: data.body || '有新的更新可用',
    icon: '/static/assets/APEINTEL ATLAS_192x192.png',
    badge: '/static/assets/APEINTEL ATLAS_192x192.png',
    tag: 'apeintel-update',
    renotify: true,
    data: data
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// 點擊通知
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      // 如果已有開啟的視窗，聚焦它
      for (const client of clients) {
        if (client.url === '/' && 'focus' in client) {
          return client.focus();
        }
      }
      // 否則開啟新視窗
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
    })
  );
});

console.log(`[SW] Service Worker 已載入 - 版本 ${APP_VERSION}`);

