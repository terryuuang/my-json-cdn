// ==========================================================
// map_init.js - 地圖初始化、圖層圖示、繪圖工具設定
// ==========================================================


// 初始化地圖
function initializeMap() {
map = L.map('map', { 
    zoomControl: false,
    maxZoom: 22, // 增加最大縮放級別，讓使用者可以看得更清楚
    minZoom: 2,
    tap: true, // 手機版點擊支援
    tapTolerance: 15 // 增加點擊容差
}).setView([25.5100, 119.7910], 7);

// 將 map 實例掛載到 window 供其他模組使用
window.map = map;

// 根據設備類型調整縮放控制器位置
if (isMobileDevice()) {
    L.control.zoom({ position: 'bottomright' }).addTo(map);
} else {
L.control.zoom({ position: 'topright' }).addTo(map);
}

// 定義可切換的底圖圖層
const googleSea = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}&hl=zh-TW', {
    attribution: '&copy; Google Maps',
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

const googleAir = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&hl=zh-TW', {
    attribution: '&copy; Google Maps',
    maxZoom: 22,
    subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
});

// 預設使用 Google 海域圖層（衛星混合），若 URL 帶 base= 參數則優先套用（供分享連結還原畫面）
const initialBaseParam = new URLSearchParams(window.location.search).get('base');
let currentBaseLayer = initialBaseParam === 'air' ? 'air' : 'sea';
(currentBaseLayer === 'air' ? googleAir : googleSea).addTo(map);

// 全域圖層切換函數
window.switchBaseLayer = function(layerName) {
  if (layerName === currentBaseLayer) return;

  // 移除當前圖層
  if (currentBaseLayer === 'sea') {
    map.removeLayer(googleSea);
  } else if (currentBaseLayer === 'air') {
    map.removeLayer(googleAir);
  }

  // 添加新圖層
  if (layerName === 'sea') {
    googleSea.addTo(map);
  } else if (layerName === 'air') {
    googleAir.addTo(map);
  }

  // 更新按鈕狀態
  document.querySelectorAll('.layer-toggle-btn').forEach(btn => {
    btn.classList.remove('active');
    if (btn.dataset.layer === layerName) {
      btn.classList.add('active');
    }
  });

  currentBaseLayer = layerName;

  // 同步寫回 URL，讓「分享目前畫面」連結能還原底圖模式
  const urlParams = new URLSearchParams(window.location.search);
  if (layerName === 'air') {
    urlParams.set('base', 'air');
  } else {
    urlParams.delete('base');
  }
  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}${window.location.hash}`;
  window.history.replaceState({}, '', newUrl);
};

// 若初始化時就是空域（來自分享連結），確保按鈕狀態與底圖切換函式邏輯一致
if (currentBaseLayer === 'air') {
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.layer-toggle-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layer === 'air');
    });
  });
}

  // 防止面板互動事件冒泡到地圖導致誤關閉（Leaflet 觸控環境尤為明顯）
  try {
    const panel = document.getElementById('controlPanel');
    if (panel && L && L.DomEvent) {
      L.DomEvent.disableClickPropagation(panel);
      L.DomEvent.disableScrollPropagation(panel);
    }
  } catch (_) { /* 忽略 Leaflet 未就緒或 DOM 缺失 */ }

  // 點擊地圖關閉控制面板（手機與桌面通用）
  map.on('click', function(e) {
    const panel = document.getElementById('controlPanel');
    const toggleBtn = document.querySelector('.toggle-panel');
    if (!panel) return;

    const originalEvent = e?.originalEvent;
    if (originalEvent) {
      const target = originalEvent.target;
      const composedPath = typeof originalEvent.composedPath === 'function'
        ? originalEvent.composedPath()
        : null;

      const interactedWithPanel = (target && panel.contains(target)) ||
        (toggleBtn && target && toggleBtn.contains(target)) ||
        (Array.isArray(composedPath) && (
          composedPath.includes(panel) ||
          (toggleBtn && composedPath.includes(toggleBtn))
        ));

      if (interactedWithPanel) return;
    }

    closeControlPanel();
  });

  // 初始化禁航區圖層（繪圖工具延後至地圖資料載入後初始化，加速首次渲染）
  try { nfzLayerGroup.addTo(map); } catch (_) {}
}

// SVG圖標系統
// 外框統一採用臂章／徽章風格的盾形輪廓（SHIELD_PATH），內部圖案依各軍種識別色與象徵符號繪製
const SHIELD_PATH = 'M12 2.2 C9.2 3.6 6.4 4.4 4.6 4.6 C4.6 9 4.8 13 6.6 16.4 C8.2 19.2 10.2 20.8 12 21.6 C13.8 20.8 15.8 19.2 17.4 16.4 C19.2 13 19.4 9 19.4 4.6 C17.6 4.4 14.8 3.6 12 2.2 Z';

const layerIcons = {
'中國軍工及航天產業': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#3730a3" stroke="#1e1b4b" stroke-width="1.4"/>
    <!-- 工業齒輪 -->
    <circle cx="12" cy="13" r="3.2" stroke="white" stroke-width="1.6"/>
    <path d="M12 8.8v-1.6M12 17.8v-1.6M7.8 13h-1.6M17.8 13h-1.6M9.2 10.2l-1.1-1.1M15.9 15.8l-1.1-1.1M14.8 10.2l1.1-1.1M8.1 15.8l1.1-1.1" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
    <!-- 航太火箭尾焰 -->
    <path d="M16 6.6l-2 1-2.6 2.6 1 1 2.6-2.6 1-2Z" fill="#fbbf24"/>
    </svg>`,
    color: '#3730a3',
    colorDark: '#a5b4fc'
},
'武裝警察、海外軍事設施及其他分類': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#dc2626" stroke="#7f1d1d" stroke-width="1.4"/>
    <!-- 內盾＋五角星 -->
    <path d="M12 6.5l3.4 1.3v2.6c0 2.6-1.9 4.5-3.4 5.1-1.5-0.6-3.4-2.5-3.4-5.1V7.8L12 6.5Z" fill="white"/>
    <path d="M12 8.6l0.62 1.28 1.41 0.2-1.02 1 0.24 1.4-1.25-0.66-1.25 0.66 0.24-1.4-1.02-1 1.41-0.2Z" fill="#dc2626"/>
    </svg>`,
    color: '#dc2626',
    colorDark: '#fca5a5'
},
'解放軍海軍、海軍陸戰隊基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#0c3b6e" stroke="#041c36" stroke-width="1.4"/>
    <!-- 錨與纜繩 -->
    <circle cx="12" cy="8.4" r="1.5" stroke="white" stroke-width="1.4"/>
    <path d="M12 10v6.4" stroke="white" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M8.4 12.4h7.2" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M8 14.8c1.2 1.4 2.8 2 4 2s2.8-0.6 4-2" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
    </svg>`,
    color: '#0c3b6e',
    colorDark: '#93c5fd'
},
'解放軍火箭軍': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#991b1b" stroke="#5b1010" stroke-width="1.4"/>
    <!-- 彈道飛彈上升 -->
    <path d="M12 6.4l1.8 2.8v5.6l-1.8 1.8-1.8-1.8V9.2L12 6.4Z" fill="white"/>
    <path d="M10.2 13.6h3.6" stroke="#991b1b" stroke-width="1.3"/>
    <path d="M11 16.6l1 1.6 1-1.6" stroke="#fbbf24" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`,
    color: '#991b1b',
    colorDark: '#fdba74'
},
'解放軍空軍、海軍航空兵基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#0284c7" stroke="#075985" stroke-width="1.4"/>
    <!-- 戰鷹展翼 -->
    <path d="M12 8.2l1.2 1.6 4.4 1.4-4.2 0.4-1 1.4-0.4 1.6-0.4-1.6-1-1.4-4.2-0.4 4.4-1.4Z" fill="white"/>
    <path d="M12 14.4v2.8" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
    color: '#0284c7',
    colorDark: '#7dd3fc'
},
'解放軍軍事航天部隊、網路空間部隊、信息支援部隊': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#5b21b6" stroke="#2e1065" stroke-width="1.4"/>
    <!-- 衛星軌道與訊號 -->
    <circle cx="12" cy="13.2" r="2.6" stroke="white" stroke-width="1.4"/>
    <path d="M7.2 10.4c2.4-2.2 7.2-2.2 9.6 0" stroke="white" stroke-width="1.3"/>
    <rect x="11.1" y="7.6" width="1.8" height="2.6" fill="white"/>
    <path d="M9.6 6.6l1.5 1M14.4 6.6l-1.5 1" stroke="white" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`,
    color: '#5b21b6',
    colorDark: '#c4b5fd'
},
'解放軍軍事院校、教育單位': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#c2410c" stroke="#7c2d12" stroke-width="1.4"/>
    <!-- 學位帽 -->
    <path d="M12 8.4l6 2.6-6 2.6-6-2.6 6-2.6Z" fill="white"/>
    <path d="M12 13.6c2.6 0 4.4-0.8 5.2-1.6v2.2c-0.9 0.9-2.6 1.7-5.2 1.7s-4.3-0.8-5.2-1.7v-2.2c0.8 0.8 2.6 1.6 5.2 1.6Z" fill="white"/>
    <path d="M6.4 11.6v2.6" stroke="white" stroke-width="1.1" stroke-linecap="round"/>
    </svg>`,
    color: '#c2410c',
    colorDark: '#fed7aa'
},
'解放軍重要訓場/特殊設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#0f766e" stroke="#083f3a" stroke-width="1.4"/>
    <!-- 靶心 -->
    <circle cx="12" cy="13" r="4.2" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="13" r="1.7" fill="white"/>
    <path d="M12 7.4v2.4M12 18.6v-2.4M6.4 13h2.4M17.6 13h-2.4" stroke="white" stroke-width="1.4" stroke-linecap="round"/>
    </svg>`,
    color: '#0f766e',
    colorDark: '#5eead4'
},
'解放軍陸軍、陸軍防空單位、聯勤保障設施、預備役部隊(部分設施為個人推斷)': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#166534" stroke="#0d3b1f" stroke-width="1.4"/>
    <!-- 內盾＋V形臂章與星 -->
    <path d="M12 7l4 1.6v3.6c0 2.8-2.3 4.6-4 5.3-1.7-0.7-4-2.5-4-5.3V8.6L12 7Z" fill="white"/>
    <path d="M9.4 12.4l2.6 2 2.6-2" stroke="#166534" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M12 8.6l0.5 1 1.1 0.16-0.8 0.78 0.2 1.1-1-0.53-1 0.53 0.2-1.1-0.8-0.78 1.1-0.16Z" fill="#166534"/>
    </svg>`,
    color: '#166534',
    colorDark: '#86efac'
},
'黨和國家重要政經軍事機關': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="${SHIELD_PATH}" fill="#9f1239" stroke="#5c0a20" stroke-width="1.4"/>
    <!-- 政經機關建築＋五角星 -->
    <path d="M12 6.6l0.7 1.5 1.6 0.2-1.2 1.1 0.3 1.6-1.4-0.8-1.4 0.8 0.3-1.6-1.2-1.1 1.6-0.2Z" fill="#fbbf24"/>
    <path d="M7.2 11.6h9.6v5.6H7.2v-5.6Z" fill="white"/>
    <path d="M7.2 11.6l4.8-2.4 4.8 2.4H7.2Z" fill="white"/>
    <path d="M9 12.8v4M11.4 12.8v4M12.6 12.8v4M15 12.8v4" stroke="#9f1239" stroke-width="1.3"/>
    </svg>`,
    color: '#9f1239',
    colorDark: '#fda4af'
}
};

// 根據layer獲取圖標
function getLayerIcon(layerName) {
return layerIcons[layerName] || layerIcons['武裝警察、海外軍事設施及其他分類'];
}

// 紅色小圓點標記（用於繪圖工具的 point 標記與 shape 模式中心點）
function createRedDotIcon(extraOptions = {}) {
  return L.divIcon({
    className: 'custom-red-marker',
    html: '<div style="background-color: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    ...extraOptions
  });
}

// 創建自定義標記圖標
// layerName+isZeroDistance 組合數量有限（各分層 x 是否零距離），快取產生好的 divIcon
// 供同組合的所有 marker 共用，避免每個 marker 都重新拼接一次 SVG/HTML 字串
const _customIconCache = new Map();

function createCustomIcon(layerName, isZeroDistance = false) {
const cacheKey = layerName + '::' + (isZeroDistance ? 1 : 0);
const cachedIcon = _customIconCache.get(cacheKey);
if (cachedIcon) return cachedIcon;

const iconData = getLayerIcon(layerName);
const size = isZeroDistance ? 40 : 32; // 零距離標記稍大一點

const icon = L.divIcon({
    className: `custom-military-marker ${isZeroDistance ? 'zero-distance-marker' : ''}`,
    html: `
    <div style="
        width: ${size}px; 
        height: ${size}px; 
        position: relative;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        ${isZeroDistance ? `
        animation: pulseRing 2s infinite;
        border: 3px solid #ef4444;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.1);
        backdrop-filter: blur(4px);
        ` : ''}
    ">
        ${iconData.svg}
        ${isZeroDistance ? `
        <div style="
            position: absolute;
            top: -3px;
            right: -3px;
            width: 12px;
            height: 12px;
            background: #ef4444;
            border: 2px solid white;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.3);
        "></div>
        ` : ''}
    </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
});
_customIconCache.set(cacheKey, icon);
return icon;
}

// 取得標籤名稱
function getLabel(url) {
url = url.toLowerCase();
return url.includes('twitter.com') || url.includes('x.com') ? 'Twitter/X' :
        url.includes('wikipedia.org') ? 'Wikipedia' :
        url.includes('weixin.qq.com') ? '微信公眾號' :
        url.includes('youtube.com') ? 'YouTube' :
        url.includes('thepaper.cn') ? '澎湃新聞' :
        url.includes('cctv.com') ? 'CCTV' :
        url.includes('bilibili.com') ? 'Bilibili' :
        '相關連結';
}

// 修補 Leaflet 棄用 API 警告（讓外掛使用 isFlat 而非 _flat）
function patchLeafletDeprecations() {
  try {
    if (window.L && L.LineUtil && typeof L.LineUtil.isFlat === 'function') {
      L.LineUtil._flat = L.LineUtil.isFlat; // 直接別名，避免觸發內建警告
    }
  } catch (e) {
    // 靜默處理，不影響主要功能
  }
}

// 初始化地圖工具：Leaflet.draw
function setupMapTools() {
  try {
    // 本地化 Leaflet.draw 介面為繁體中文（若可用）
    if (window.L && L.drawLocal) {
      L.drawLocal = {
        draw: {
          toolbar: {
            actions: {
              title: '取消繪圖',
              text: '取消'
            },
            finish: {
              title: '完成繪圖',
              text: '完成'
            },
            undo: {
              title: '刪除最後一點',
              text: '上一步'
            },
            buttons: {
              polyline: '繪製折線',
              polygon: '繪製多邊形',
              rectangle: '繪製矩形',
              circle: '繪製圓形',
              marker: '放置標記',
              circlemarker: '繪製圓點'
            }
          },
          handlers: {
            simpleshape: {
              tooltip: {
                start: '拖曳以繪製形狀'
              }
            },
            polyline: {
              tooltip: {
                start: '點擊開始繪製折線',
                cont: '點擊以繼續，雙擊完成',
                end: '雙擊以完成繪製'
              }
            },
            polygon: {
              tooltip: {
                start: '點擊開始繪製多邊形',
                cont: '點擊以繼續，點選起點以完成',
                end: '點選起點以完成繪製'
              }
            },
            rectangle: {
              tooltip: {
                start: '拖曳以繪製矩形'
              }
            },
            marker: {
              tooltip: {
                start: '點擊地圖以放置標記'
              }
            },
            circle: {
              tooltip: {
                start: '拖曳以繪製圓形',
                cont: '調整半徑以變更大小',
                end: '放開滑鼠以完成'
              }
            },
            circlemarker: {
              tooltip: {
                start: '點擊以繪製圓點'
              }
            }
          }
        },
        edit: {
          toolbar: {
            actions: {
              save: {
                title: '儲存變更',
                text: '儲存'
              },
              cancel: {
                title: '取消編輯，放棄變更',
                text: '取消'
              },
              clearAll: {
                title: '刪除所有圖形',
                text: '全部清除'
              }
            },
            buttons: {
              edit: '編輯圖形',
              editDisabled: '沒有可編輯的圖形',
              remove: '刪除圖形',
              removeDisabled: '沒有可刪除的圖形'
            }
          },
          handlers: {
            edit: {
              tooltip: {
                text: '拖曳控制點以編輯圖形',
                subtext: '點擊取消可放棄變更'
              }
            },
            remove: {
              tooltip: {
                text: '點選圖形以刪除'
              }
            }
          }
        }
      };
    }
    // 建立已繪製物件的圖層群組
    if (!drawnItems) {
      drawnItems = new L.FeatureGroup();
      map.addLayer(drawnItems);
    }

    // 依裝置調整控制項位置（避免與自家面板衝突）
    const isMobile = isMobileDevice();
    const drawPosition = isMobile ? 'bottomleft' : 'topright';

    // 安裝 Leaflet.draw 控制項（僅保留常用工具，降低 UI 複雜度與事件負載）
    if (window.L && L.Control && L.Control.Draw && !drawControl) {
      drawControl = new L.Control.Draw({
        position: drawPosition,
        draw: {
          polygon: {
            showArea: true,
            allowIntersection: false,
            shapeOptions: { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 }
          },
          polyline: {
            shapeOptions: { color: '#ef4444', weight: 3 }
          },
          rectangle: {
            shapeOptions: { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.08 }
          },
          circle: false,
          circlemarker: false,
          marker: true
        },
        edit: {
          featureGroup: drawnItems,
          remove: true
        }
      });
      map.addControl(drawControl);
      // 補強：設定工具列按鈕的 title 為繁中（避免部分版本未套用 drawLocal 的情況）
      setTimeout(() => {
        try {
          const t = [
            ['.leaflet-draw-draw-polyline', '繪製折線'],
            ['.leaflet-draw-draw-polygon', '繪製多邊形'],
            ['.leaflet-draw-draw-rectangle', '繪製矩形'],
            ['.leaflet-draw-draw-marker', '放置標記'],
            ['.leaflet-draw-edit-edit', '編輯圖形'],
            ['.leaflet-draw-edit-remove', '刪除圖形']
          ];
          t.forEach(([sel, title]) => {
            const el = document.querySelector(sel);
            if (el) el.setAttribute('title', title);
          });
        } catch (_) { /* 忽略 */ }
      }, 0);

      // 事件：新增圖形
      map.on(L.Draw.Event.CREATED, function (e) {
        const layer = e.layer;
        const type = e.layerType;

        try {
          // 統一套用紅色樣式
          if (layer.setStyle) {
            layer.setStyle({ color: '#ef4444', weight: 3, fillColor: '#ef4444', fillOpacity: 0.12 });
          }

          // 建立即時資訊 popup（含筆記按鈕）
          const drawingId = `drawing_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          layer.drawingId = drawingId; // 儲存 ID 以便後續使用
          
          if (type === 'marker') {
            // 使用紅色小圓點標記
            const redIcon = createRedDotIcon({ popupAnchor: [0, -8] });
            layer.setIcon(redIcon);
            const { lat, lng } = layer.getLatLng();
            // 建立 Point 幾何資料
            const geometry = { type: 'Point', coordinates: [lng, lat] };
            let popupHtml = `<h3 class="popup-title">標記點</h3>`;
            popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">手動標記</span></div>`;
            popupHtml += `<div class="popup-field"><strong>緯度:</strong><span class="popup-field-value">${lat.toFixed(6)}</span></div>`;
            popupHtml += `<div class="popup-field"><strong>經度:</strong><span class="popup-field-value">${lng.toFixed(6)}</span></div>`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += `<div class="popup-actions">${window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: '標記點',
                layerName: '手動標記',
                lat: lat,
                lng: lng,
                metadata: { drawingType: 'marker' },
                geometry: geometry
              })}</div>`;
            }
            layer.bindPopup(popupHtml, { className: 'custom-popup' });
          } else if (type === 'polyline') {
            const latlngs = layer.getLatLngs();
            let total = 0;
            for (let i = 1; i < latlngs.length; i++) {
              total += map.distance(latlngs[i - 1], latlngs[i]);
            }
            const lengthText = total < 1000
              ? `約 ${total.toFixed(0)} 公尺`
              : `約 ${(total / 1000).toFixed(2)} 公里`;
            const center = layer.getBounds().getCenter();
            // 建立 LineString 幾何資料（儲存所有頂點）
            const geometry = {
              type: 'LineString',
              coordinates: latlngs.map(ll => [ll.lng, ll.lat])
            };
            let popupHtml = `<h3 class="popup-title">線段</h3>`;
            popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">手動繪製</span></div>`;
            popupHtml += `<div class="popup-field"><strong>長度:</strong><span class="popup-field-value">${lengthText}</span></div>`;
            popupHtml += `<div class="popup-field"><strong>頂點數:</strong><span class="popup-field-value">${latlngs.length}</span></div>`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += `<div class="popup-actions">${window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `線段 (${lengthText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: 'polyline', length: total },
                geometry: geometry
              })}</div>`;
            }
            layer.bindPopup(popupHtml, { className: 'custom-popup' });
          } else if (type === 'polygon' || type === 'rectangle') {
            // 使用 Leaflet.draw 的 geodesicArea（若存在）
            let areaText = '無法計算';
            let area = 0;
            const latlngs = layer.getLatLngs();
            const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs; // 兼容多邊形/矩形
            try {
              if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
                area = L.GeometryUtil.geodesicArea(flat);
                areaText = area < 1e6
                  ? `約 ${area.toFixed(0)} 平方公尺`
                  : `約 ${(area / 1e6).toFixed(2)} 平方公里`;
              }
            } catch (_) {}
            const shapeType = type === 'rectangle' ? '矩形' : '多邊形';
            const center = layer.getBounds().getCenter();
            // 建立幾何資料（矩形使用 Rectangle，多邊形使用 Polygon）
            let geometry;
            if (type === 'rectangle') {
              const bounds = layer.getBounds();
              geometry = {
                type: 'Rectangle',
                bounds: {
                  west: bounds.getWest(),
                  south: bounds.getSouth(),
                  east: bounds.getEast(),
                  north: bounds.getNorth()
                }
              };
            } else {
              geometry = {
                type: 'Polygon',
                coordinates: flat.map(ll => [ll.lng, ll.lat])
              };
            }
            let popupHtml = `<h3 class="popup-title">${shapeType}</h3>`;
            popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">手動繪製</span></div>`;
            popupHtml += `<div class="popup-field"><strong>面積:</strong><span class="popup-field-value">${areaText}</span></div>`;
            popupHtml += `<div class="popup-field"><strong>頂點數:</strong><span class="popup-field-value">${flat.length}</span></div>`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += `<div class="popup-actions">${window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `${shapeType} (${areaText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: type, area: area },
                geometry: geometry
              })}</div>`;
            }
            layer.bindPopup(popupHtml, { className: 'custom-popup' });
          } else if (type === 'circle') {
            // 圓形處理
            const center = layer.getLatLng();
            const radius = layer.getRadius();
            const radiusText = radius < 1000
              ? `${radius.toFixed(0)} 公尺`
              : `${(radius / 1000).toFixed(2)} 公里`;
            // 建立 Circle 幾何資料
            const geometry = {
              type: 'Circle',
              center: [center.lng, center.lat],
              radiusKm: radius / 1000
            };
            let popupHtml = `<h3 class="popup-title">圓形</h3>`;
            popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">手動繪製</span></div>`;
            popupHtml += `<div class="popup-field"><strong>半徑:</strong><span class="popup-field-value">${radiusText}</span></div>`;
            popupHtml += `<div class="popup-field"><strong>中心座標:</strong><span class="popup-field-value">${center.lat.toFixed(6)}, ${center.lng.toFixed(6)}</span></div>`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += `<div class="popup-actions">${window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `圓形 (半徑 ${radiusText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: 'circle', radius: radius },
                geometry: geometry
              })}</div>`;
            }
            layer.bindPopup(popupHtml, { className: 'custom-popup' });
          }

          // 點擊圖形時開啟資訊
          layer.on('click', () => { if (layer.getPopup()) layer.openPopup(); });
        } catch (_) { /* 忽略單一圖形錯誤 */ }

        drawnItems.addLayer(layer);
      });

      // 事件：編輯/刪除完成（這裡僅維持資料結構，避免昂貴運算）
      map.on(L.Draw.Event.EDITED, function () {/* no-op for performance */});
      map.on(L.Draw.Event.DELETED, function () {/* no-op for performance */});
    }
  } catch (err) {
    console.warn('[Map] Map tools 設定略過:', err);
  }
}
