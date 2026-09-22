// ==========================================================
// bootstrap.js - 應用程式啟動、事件監聽、window.* 匯出
// 必須最後載入（依賴其他模組已定義完成）
// ==========================================================


// 主要初始化函數
async function init() {
const startTime = performance.now(); // 效能計時開始
showLoading();
 // 顯示頂部載入提醒（RWD）
 showTopNotice();
 // 修補 Leaflet 相容性（抑制 _flat 的棄用警告）
 patchLeafletDeprecations();

try {
    // 初始化地圖
    initializeMap();
    // 工具已在 initializeMap 內初始化
    
    // 初始化面板狀態（手機版預設隱藏）
    initializePanelState();
    
    // 監聽視窗大小變化（debounce 150ms，避免拖曳縮放視窗時高頻觸發）
    let resizeDebounceTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeDebounceTimer);
      resizeDebounceTimer = setTimeout(handleResize, 150);
    });
    
    // 解析URL參數（同步，不佔時間）
    const urlCoords = parseUrlCoordinates();
    const urlParams = window.UrlParams.read();
    
    const radius = parseFloat(urlParams.get('radius')) || (urlCoords ? 50 : 100);
    const selectedLayer = urlParams.get('layer') || '';
    
    if (urlCoords) {
    document.getElementById('latInput').value = urlCoords.lat;
    document.getElementById('lngInput').value = urlCoords.lng;
    } else {
    document.getElementById('latInput').value = 25.5100;
    document.getElementById('lngInput').value = 119.7910;
    }
    document.getElementById('radiusInput').value = radius;
    
    // 並行載入：筆記系統 + GeoJSON 資料同時初始化
    const geojsonURL = DATA_BASE_URL + GEOJSON_FILENAME;
    document.querySelector('#loading div:last-child').textContent = '載入地圖資料中...';
    
    const notesPromise = (window.Notes && typeof window.Notes.init === 'function')
      ? window.Notes.init(map).catch(e => console.warn('[Notes] 初始化失敗:', e))
      : Promise.resolve();
    
    const geojsonPromise = fetchGeoJSON(geojsonURL);
    
    const [, geojsonData] = await Promise.all([notesPromise, geojsonPromise]);
    
    allFeatures = geojsonData.features;
    layerIndex = buildLayerIndex(allFeatures);

    const hasAisSnapshot = window.AISSnapshot && typeof window.AISSnapshot.hasAisHash === 'function'
      ? window.AISSnapshot.hasAisHash()
      : window.UrlParams.hashHas('ais');
    if (hasAisSnapshot) unitsVisible = false;
    
    // 支援 shape 模式（禁航區繪制 + 附近點位）
    const shapeParam = (urlParams.get('shape') || '').trim().toLowerCase();
    if (shapeParam) {
      unitsVisible = false;
      const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);
      renderShapeMode(shapeSpec, selectedLayer);
    } else {
      const targetCoords = urlCoords || { lat: 25.5100, lng: 119.7910 };
      // 分享連結若帶 zoom= 參數，還原當時實際的縮放層級（僅限初始載入這一次）
      const zoomParam = parseInt(urlParams.get('zoom'), 10);
      const initialZoom = Number.isFinite(zoomParam) ? zoomParam : undefined;
      renderMap(targetCoords, radius, selectedLayer, { initialZoom });
    }

    if (window.AISSnapshot && typeof window.AISSnapshot.init === 'function') {
      window.AISSnapshot.init(map);
    }
    
    // 完成後隱藏載入指示器
    hideLoading();

    // 通知動態島資料載入完成
    if (window._initActivityId && window.IslandActivity) {
      window.IslandActivity.finish(window._initActivityId, '✓ 地圖就緒', 'success');
      delete window._initActivityId;
    }
    
    // 延後初始化繪圖工具（不影響地圖資料顯示）
    requestAnimationFrame(() => {
      setupMapTools();
      if (window.PLATheater) window.PLATheater.init(map);
      if (window.ADIZ) window.ADIZ.init(map);
      if (window.MaritimeZones) window.MaritimeZones.init(map, { visible: hasAisSnapshot });
      if (window.SubmarineCable) {
        window.SubmarineCable.init(map);
        // 網址帶 cable= 時自動開啟圖層（全部或指定電纜）
        window.SubmarineCable.applyUrlSelection();
      }
      if (typeof initOsintToolbar === 'function') initOsintToolbar(map);
      if (window.MapContextMenu) window.MapContextMenu.init(map);
      if (window.MndAreas) window.MndAreas.init(map);
      if (window.OsintWeather) window.OsintWeather.init();
    });
    
    const endTime = performance.now();
    const loadTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`[Map] 初始化完成，耗時 ${loadTime}s`);
    
} catch (error) {
    hideLoading();
    console.error('[Map] 載入地圖資料失敗:', error);
    updateInfoPanel(`錯誤：${error.message}`);
    
    // 即使載入失敗也要初始化基本地圖
    if (!map) {
    initializeMap();
    }
}
}

// hash 裡的圖形參數改變時就地重繪，不重新載入整頁。
// history.replaceState/pushState 不會觸發 hashchange，所以自己寫回網址不會造成重繪迴圈；
// 仍比對前後值，避免使用者只改 #ais= 之類無關參數時也重畫圖形。
const SHAPE_HASH_KEYS = [
  'shape', 'unit', 'lat', 'lng', 'coords', 'radius', 'start', 'end', 'text',
  'line', 'poly', 'bbox', 'circle', 'sector',
  'color', 'circle_color', 'line_color', 'poly_color', 'sector_color',
  'circle_text', 'line_text', 'poly_text', 'sector_text',
  'activity_type', 'ai_judgment'
];

function shapeParamsSignature() {
  try {
    const params = window.UrlParams.read();
    return SHAPE_HASH_KEYS
      .map(key => `${key}=${params.getAll(key).join('\u0001')}`)
      .join('\u0002');
  } catch (_) {
    return '';
  }
}

// 以載入時的網址為基準，這樣第一次 hashchange 就會生效
let lastShapeSignature = shapeParamsSignature();

function syncShapeHashState() {
  const signature = shapeParamsSignature();
  if (signature === lastShapeSignature) return;
  lastShapeSignature = signature;

  try {
    if (typeof hasShapeModeInUrl === 'function' && hasShapeModeInUrl()) {
      if (typeof renderShapeOverlayFromUrl === 'function') renderShapeOverlayFromUrl();
    } else {
      // shape 參數被移除：清掉圖形圖層，並把單位圖示放回來
      // （進 shape 模式時是被強制隱藏的，不還原的話畫面會整片空白）
      try { nfzLayerGroup.clearLayers(); } catch (_) {}
      unitsVisible = true;
      if (typeof applyUnitVisibility === 'function') applyUnitVisibility();
    }
  } catch (error) {
    console.warn('[Map] 依 hash 重繪圖形失敗:', error);
  }
}

// cable= 改變時就地套用，不重載整頁。與 shape 參數分開比對，
// 避免調個電纜就把圖形整組重畫。
let lastCableSignature = cableParamsSignature();

function cableParamsSignature() {
  try {
    return window.UrlParams.read().getAll('cable').join('\u0001');
  } catch (_) {
    return '';
  }
}

function syncCableHashState() {
  const signature = cableParamsSignature();
  if (signature === lastCableSignature) return;
  lastCableSignature = signature;
  if (window.SubmarineCable) window.SubmarineCable.applyUrlSelection();
}

// 當頁面載入完成時啟動應用程式
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('hashchange', syncAisHashState);
window.addEventListener('pageshow', syncAisHashState);
window.addEventListener('focus', syncAisHashState);
window.addEventListener('hashchange', syncShapeHashState);
window.addEventListener('hashchange', syncCableHashState);

// 在 init 函數中調用
// 需要在 DOMContentLoaded 後執行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupSearchIsland();
  });
} else {
  setupSearchIsland();
}

// 導出函數和變數供 unified_dropdown.js 使用
window.renderMap = renderMap;
window.renderShapeMode = renderShapeMode;
window.filterFeaturesByLayer = filterFeaturesByLayer;
window.parseUrlCoordinates = parseUrlCoordinates;

// 導出全域變數（需要在初始化後更新）
Object.defineProperty(window, 'allFeatures', {
  get: () => allFeatures,
  set: (value) => { allFeatures = value; }
});

Object.defineProperty(window, 'map', {
  get: () => map,
  set: (value) => { map = value; }
});
