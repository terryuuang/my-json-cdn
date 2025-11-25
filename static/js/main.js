// ==========================================================
// 資料來源 URL 設定（支援自訂 DOMAIN）
// ==========================================================
const DATA_BASE_URL = './';  // 使用相對路徑以支援自訂域名
const GEOJSON_FILENAME = 'joseph_w.geojson';

// ==========================================================
// 更新日誌設定（統一維護）
// ==========================================================
const CHANGELOG = [
  {
    date: '2025年11月25日',
    description: '新增筆記功能，支援離線筆記儲存'
  },
  {
    date: '2025年11月25日',
    description: '新增pwa功能，支援手機應用'
  },
  {
    date: '2025年11月24日',
    description: '新增更新日誌功能，顯示最新版本更新內容'
  },
  {
    date: '2025年11月24日',
    description: '整合統一下拉選單系統，新增多選功能以支援分層篩選及公共設施選擇'
  },
  {
    date: '2025年11月24日',
    description: '新增手機版搜尋功能，優化搜尋體驗及競態條件處理'
  },
  {
    date: '2025年11月24日',
    description: '新增地點搜尋功能，支援 Nominatim API 進行地理編碼查詢'
  },
  {
    date: '2025年09月17日',
    description: '改進控制面板互動邏輯，防止誤關閉並優化點擊事件處理'
  },
  {
    date: '2025年09月16日',
    description: '新增形狀模式支援，包含圓形、線段、多邊形等地圖標記功能'
  },
  {
    date: '2025年09月16日',
    description: '本地化 Leaflet.draw 介面為繁體中文，新增紅色主題樣式'
  }
];

// 異步處理裝備資訊的函數
// 非同步處理裝備資訊（加上防重與效能優化）
async function processEquipmentAsync(layer, equipmentText) {
// 防止重複綁定與重複處理（提升效能，避免重複事件造成多次渲染）
if (layer._equipmentParsingStarted) return;
layer._equipmentParsingStarted = true;

let loadingShown = false;

// 設置載入狀態顯示的定時器（手機版延遲更短）
const loadingDelay = isMobileDevice() ? 500 : 1000;
const loadingTimer = setTimeout(() => {
    // 僅在首次打開時注入載入狀態（避免重複綁定）
    layer.once('popupopen', function(e) {
    const popup = e.popup;
    const popupContent = popup.getContent();
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = popupContent;
    
    if (!tempDiv.querySelector('.equipment-info')) {
        const loadingHTML = window.equipmentParser.generateEquipmentHTML([], true);
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', loadingHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', loadingHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
        loadingShown = true;
    }
    });
}, loadingDelay); // 手機版0.5秒，桌面版1秒後顯示載入狀態

try {
    const equipmentData = await window.equipmentParser.processEquipmentText(equipmentText);
    clearTimeout(loadingTimer);
    
    if (equipmentData.length > 0) {
    const equipmentHTML = window.equipmentParser.generateEquipmentHTML(equipmentData);
    
    // 更新popup內容（只於首次開啟綁定，避免重複）
    layer.once('popupopen', function(e) {
        const popup = e.popup;
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        // 移除載入狀態或檢查是否已經添加過裝備資訊
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        }
        
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', equipmentHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', equipmentHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
    });
    
    // 如果popup已經開啟，立即更新
    if (layer.getPopup() && layer.getPopup().isOpen()) {
        const popup = layer.getPopup();
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        }
        
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', equipmentHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', equipmentHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
    }
    } else if (loadingShown) {
    // 如果沒有找到裝備資訊且顯示了載入狀態，則移除載入狀態
    layer.once('popupopen', function(e) {
        const popup = e.popup;
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        popup.setContent(tempDiv.innerHTML);
        }
    });
    }
} catch (error) {
    clearTimeout(loadingTimer);
    console.error('處理裝備資訊時發生錯誤:', error);
}
}


// 解析URL參數 - 獲取經緯度
function parseUrlCoordinates() {
const urlParams = new URLSearchParams(window.location.search);

// 支援多種參數格式
// 格式1: ?lat=31.9424765&lng=120.2903877
if (urlParams.has('lat') && urlParams.has('lng')) {
    return {
    lat: parseFloat(urlParams.get('lat')),
    lng: parseFloat(urlParams.get('lng'))
    };
}

// 格式2: ?coords=31.9424765,120.2903877
if (urlParams.has('coords')) {
    const coords = urlParams.get('coords').split(',');
    if (coords.length === 2) {
    return {
        lat: parseFloat(coords[0]),
        lng: parseFloat(coords[1])
    };
    }
}

// 格式3: 路徑格式 /31.9424765,120.2903877 (向後相容)
const path = window.location.pathname;
const coordinatePattern = /\/(-?\d+\.?\d*),(-?\d+\.?\d*)$/;
const match = path.match(coordinatePattern);

if (match) {
    return {
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2])
    };
}

return null;
}

// 計算兩點間距離(公里) - 使用Haversine公式
function calculateDistance(lat1, lon1, lat2, lon2) {
const R = 6371; // 地球半徑(公里)
const dLat = (lat2 - lat1) * Math.PI / 180;
const dLon = (lon2 - lon1) * Math.PI / 180;
const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
return R * c;
}

//（已搬移到 static/js/shape_utils.js）

// 根據 shape 規格渲染禁航區與附近點位
function renderShapeMode(shapeSpec, selectedLayer = null) {
  currentMarkers.clearLayers();
  if (centerMarker) { try { map.removeLayer(centerMarker); } catch (_) {} centerMarker = null; }
  try { nfzLayerGroup.clearLayers(); } catch (_) {}

  let featuresToScan = allFeatures;
  if (selectedLayer) featuresToScan = filterFeaturesByLayer(featuresToScan, selectedLayer);

  const ensureClosedPolyline = (points) => {
    if (!points || points.length === 0) return null;
    const first = points[0];
    const last = points[points.length - 1];
    if (first.lat === last.lat && first.lng === last.lng) {
      return points.slice();
    }
    return [...points, { lat: first.lat, lng: first.lng }];
  };

  let bounds = null;
  const extendBounds = (input) => {
    try {
      let b = null;
      if (Array.isArray(input)) {
        b = L.latLngBounds(input);
      } else if (input && typeof input.getSouthWest === 'function') {
        b = input;
      }
      if (b) bounds = bounds ? bounds.extend(b) : b;
    } catch (_) {}
  };

  // 輔助函數：建立含筆記功能的 popup 內容（跟軍事設施彈窗樣式一致）
  const buildShapePopup = (type, text, center, shapeInfo = {}) => {
    const baseText = text || '區域標記';
    const shapeTypeLabels = { 'point': '標記點', 'circle': '圓形區域', 'line': '線段', 'polygon': '多邊形', 'bbox': '矩形區域', 'sector': '扇形區域' };
    const typeLabel = shapeTypeLabels[type] || '圖形';
    
    let popupHtml = `<h3 class="popup-title" style="margin-bottom:10px">${baseText}</h3>`;
    popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">${typeLabel}</span></div>`;
    
    // 添加形狀資訊
    if (shapeInfo.radius) popupHtml += `<div class="popup-field"><strong>半徑:</strong><span class="popup-field-value">${shapeInfo.radius}</span></div>`;
    if (shapeInfo.area) popupHtml += `<div class="popup-field"><strong>面積:</strong><span class="popup-field-value">${shapeInfo.area}</span></div>`;
    if (shapeInfo.length) popupHtml += `<div class="popup-field"><strong>長度:</strong><span class="popup-field-value">${shapeInfo.length}</span></div>`;
    
    // 添加儲存筆記按鈕
    if (window.Notes && typeof window.Notes.getShapeNoteButtonHtml === 'function') {
      popupHtml += `<div class="popup-actions">${window.Notes.getShapeNoteButtonHtml({
        shapeType: type,
        lat: center.lat,
        lng: center.lng,
        text: baseText,
        shapeInfo: shapeInfo
      })}</div>`;
    }
    
    return popupHtml;
  };

  shapeSpec.shapes.forEach(s => {
    try {
      s._bufferPolyline = null;
      if (s.type === 'point') {
        const redIcon = L.divIcon({
          className: 'custom-red-marker',
          html: '<div style="background-color: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
          iconSize: [16, 16], iconAnchor: [8, 8]
        });
        const markerText = s.text || shapeSpec.text || '禁航點';
        const popupContent = buildShapePopup('point', markerText, s.center, {});
        const m = L.marker([s.center.lat, s.center.lng], { icon: redIcon }).bindPopup(popupContent);
        nfzLayerGroup.addLayer(m);
        extendBounds([[s.center.lat, s.center.lng]]);
        if (Number.isFinite(s.radiusKm) && s.radiusKm > 0) {
          const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
          const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
          const circleText = s.text || shapeSpec.text || '圓形區域';
          const circlePopup = buildShapePopup('circle', circleText, s.center, { radius: radiusText });
          c.bindPopup(circlePopup);
          nfzLayerGroup.addLayer(c);
          extendBounds(c.getBounds());
        }
      } else if (s.type === 'line') {
        const latlngs = s.coords.map(p => [p.lat, p.lng]);
        const pl = L.polyline(latlngs, { color: '#ef4444', weight: 3 });
        // 計算線段長度
        let totalLength = 0;
        for (let i = 1; i < latlngs.length; i++) {
          totalLength += calculateDistance(latlngs[i-1][0], latlngs[i-1][1], latlngs[i][0], latlngs[i][1]);
        }
        const lengthText = totalLength < 1 ? `${(totalLength * 1000).toFixed(0)} 公尺` : `${totalLength.toFixed(2)} 公里`;
        const center = pl.getBounds().getCenter();
        const lineText = s.text || shapeSpec.text || '線段';
        const linePopup = buildShapePopup('line', lineText, { lat: center.lat, lng: center.lng }, { length: lengthText });
        pl.bindPopup(linePopup);
        nfzLayerGroup.addLayer(pl);
        extendBounds(latlngs);
      } else if (s.type === 'polygon') {
        const latlngs = s.coords.map(p => [p.lat, p.lng]);
        const poly = L.polygon(latlngs, { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const center = poly.getBounds().getCenter();
        const polyText = s.text || shapeSpec.text || '多邊形區域';
        const polyPopup = buildShapePopup('polygon', polyText, { lat: center.lat, lng: center.lng }, {});
        poly.bindPopup(polyPopup);
        nfzLayerGroup.addLayer(poly);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(s.coords.map(p => ({ lat: p.lat, lng: p.lng })));
        s._bufferPolyline = perimeter;
      } else if (s.type === 'bbox') {
        const latlngs = [
          [s.bounds.south, s.bounds.west],
          [s.bounds.south, s.bounds.east],
          [s.bounds.north, s.bounds.east],
          [s.bounds.north, s.bounds.west]
        ];
        const rect = L.polygon(latlngs, { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.08 });
        const center = rect.getBounds().getCenter();
        const rectText = s.text || shapeSpec.text || '矩形區域';
        const rectPopup = buildShapePopup('bbox', rectText, { lat: center.lat, lng: center.lng }, {});
        rect.bindPopup(rectPopup);
        nfzLayerGroup.addLayer(rect);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(latlngs.map(([lat, lng]) => ({ lat, lng })));
        s._bufferPolyline = perimeter;
      } else if (s.type === 'circle') {
        const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
        const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const circleText = s.text || shapeSpec.text || '圓形區域';
        const circlePopup = buildShapePopup('circle', circleText, s.center, { radius: radiusText });
        c.bindPopup(circlePopup);
        nfzLayerGroup.addLayer(c);
        extendBounds(c.getBounds());
      } else if (s.type === 'sector') {
        const latlngs = window.shapeUtils.buildSectorLatLngs(s.center, s.radiusKm, s.startDeg, s.endDeg);
        const sec = L.polygon(latlngs, { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
        const sectorText = s.text || shapeSpec.text || '扇形區域';
        const sectorPopup = buildShapePopup('sector', sectorText, s.center, { 
          radius: radiusText,
          angle: `${s.startDeg}° - ${s.endDeg}°`
        });
        sec.bindPopup(sectorPopup);
        nfzLayerGroup.addLayer(sec);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(latlngs.map(([lat, lng]) => ({ lat, lng })));
        s._bufferPolyline = perimeter;
      }
    } catch (_) { /* 忽略單一形狀錯誤 */ }
  });

  const matched = [];
  for (const feature of featuresToScan) {
    const coords = feature.geometry && feature.geometry.coordinates;
    if (!coords || coords.length < 2) continue;
    const pt = { lat: coords[1], lng: coords[0] };

    let hit = false;
    for (const s of shapeSpec.shapes) {
      try {
        if (s.type === 'point') {
          if (!s.center) continue;
          const baseRadius = Number.isFinite(s.radiusKm) ? s.radiusKm : 0;
          const dKm = calculateDistance(s.center.lat, s.center.lng, pt.lat, pt.lng);
          if (dKm <= baseRadius + NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
        } else if (s.type === 'circle') {
          if (!s.center) continue;
          const radius = Number.isFinite(s.radiusKm) ? s.radiusKm : 0;
          const dKm = calculateDistance(s.center.lat, s.center.lng, pt.lat, pt.lng);
          if (dKm <= radius + NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
        } else if (s.type === 'polygon') {
          if (window.shapeUtils.pointInPolygon(pt, s.coords)) { hit = true; break; }
          if (s._bufferPolyline && s._bufferPolyline.length >= 2 && window.shapeUtils.distancePointToPolylineKm(pt, s._bufferPolyline) <= NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
        } else if (s.type === 'bbox') {
          const inside = pt.lat >= s.bounds.south && pt.lat <= s.bounds.north && pt.lng >= s.bounds.west && pt.lng <= s.bounds.east;
          if (inside) { hit = true; break; }
          if (s._bufferPolyline && s._bufferPolyline.length >= 2 && window.shapeUtils.distancePointToPolylineKm(pt, s._bufferPolyline) <= NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
        } else if (s.type === 'line') {
          if (!s.coords || s.coords.length < 2) continue;
          const threshold = Math.max(Number.isFinite(shapeSpec.lineBufferKm) ? shapeSpec.lineBufferKm : 0, NFZ_NEARBY_BUFFER_KM);
          if (window.shapeUtils.distancePointToPolylineKm(pt, s.coords) <= threshold) { hit = true; break; }
        } else if (s.type === 'sector') {
          if (!s.center) continue;
          const radius = Number.isFinite(s.radiusKm) ? s.radiusKm : 0;
          const dKm = calculateDistance(s.center.lat, s.center.lng, pt.lat, pt.lng);
          const ang = window.shapeUtils.bearingDeg(s.center.lat, s.center.lng, pt.lat, pt.lng);
          const withinAngle = window.shapeUtils.angleInRangeCW(ang, s.startDeg, s.endDeg);
          if (withinAngle && dKm <= radius) { hit = true; break; }
          if (withinAngle && dKm <= radius + NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
          if (s._bufferPolyline && s._bufferPolyline.length >= 2 && window.shapeUtils.distancePointToPolylineKm(pt, s._bufferPolyline) <= NFZ_NEARBY_BUFFER_KM) { hit = true; break; }
        }
      } catch (_) {}
    }
    if (hit) matched.push(feature);
  }

  try {
    if (bounds) {
      map.fitBounds(bounds.pad(0.2));
    }
  } catch (_) {}

  addMarkersForFeatures(matched, null, selectedLayer, null);
}

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

// 使用高解析度衛星圖層
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 22 // 支援高縮放級別
}).addTo(map);

// 添加地名標籤疊加層
const labelLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 22,
    subdomains: 'abcd',
    pane: 'overlayPane'
}).addTo(map);

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

  // 初始化繪圖/測距工具（依裝置調整位置與可用性）
  setupMapTools();
  // 初始化禁航區圖層
  try { nfzLayerGroup.addTo(map); } catch (_) {}
}

// SVG圖標系統
const layerIcons = {
'中國軍工及航天產業': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#4338ca" stroke="#312e81" stroke-width="2"/>
    <!-- 工業齒輪簡化版 -->
    <circle cx="12" cy="12" r="3.5" stroke="white" stroke-width="2"/>
    <path d="M12 7.5v-2M12 18.5v-2M7.5 12h-2M18.5 12h-2M9 9l-1.2-1.2M16.2 16.2L15 15M15 9l1.2-1.2M8.8 16.2L10 15" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
    <!-- 航太火箭 -->
    <path d="M16.5 7.5l-2.2 1.1-2.9 2.9 1.1 1.1 2.9-2.9 1.1-2.2Z" fill="white"/>
    </svg>`,
    color: '#4338ca'
},
'武裝警察、海外軍事設施及其他分類': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#dc2626" stroke="#991b1b" stroke-width="2"/>
    <!-- 盾牌 -->
    <path d="M12 6l5 2v4c0 3.5-3 5.8-5 6.5-2-0.7-5-3-5-6.5V8l5-2Z" fill="white"/>
    <path d="M12 10l1 2h2l-1.6 1.2.6 2-2-1.2-2 1.2.6-2L9 12h2l1-2Z" fill="#dc2626"/>
    </svg>`,
    color: '#dc2626'
},
'解放軍海軍、海軍陸戰隊基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#8B4513" stroke="#654321" stroke-width="2"/>
    <!-- 錨與海浪 -->
    <circle cx="12" cy="8" r="2" fill="white"/>
    <path d="M12 10v6" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <path d="M8 16c1.2 1 2.8 1 4 0 1.2 1 2.8 1 4 0" stroke="white" stroke-width="1.6" fill="none"/>
    <path d="M9 13h2M13 13h2" stroke="white" stroke-width="1.6"/>
    </svg>`,
    color: '#8B4513'
},
'解放軍火箭軍': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#b91c1c" stroke="#7f1d1d" stroke-width="2"/>
    <!-- 火箭垂直 -->
    <path d="M12 6l2 3v6l-2 2-2-2V9l2-3Z" fill="white"/>
    <path d="M10 15h4" stroke="#b91c1c" stroke-width="1.6"/>
    <path d="M12 17v2" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    color: '#b91c1c'
},
'解放軍空軍、海軍航空兵基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#1E3A8A" stroke="#1E40AF" stroke-width="2"/>
    <!-- 戰機俯視 -->
    <path d="M12 6l3 4-3 1-3-1 3-4Z" fill="white"/>
    <path d="M9 12l3 2 3-2M12 14v3" stroke="white" stroke-width="1.6" stroke-linecap="round"/>
    </svg>`,
    color: '#1E3A8A'
},
'解放軍軍事航天部隊、網路空間部隊、信息支援部隊': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#7c3aed" stroke="#5b21b6" stroke-width="2"/>
    <!-- 衛星與軌道 -->
    <circle cx="12" cy="12" r="3.2" stroke="white" stroke-width="1.6"/>
    <path d="M7 9c2-2 8-2 10 0" stroke="white" stroke-width="1.4"/>
    <rect x="11" y="7" width="2" height="3" fill="white"/>
    <rect x="9" y="6" width="2" height="2" fill="white"/>
    <rect x="13" y="6" width="2" height="2" fill="white"/>
    </svg>`,
    color: '#7c3aed'
},
'解放軍軍事院校、教育單位': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#ea580c" stroke="#c2410c" stroke-width="2"/>
    <!-- 學位帽 -->
    <path d="M12 8l6 3-6 3-6-3 6-3Z" fill="white"/>
    <path d="M12 14c3 0 5-1 6-2v2c-1 1-3 2-6 2s-5-1-6-2v-2c1 1 3 2 6 2Z" fill="white"/>
    </svg>`,
    color: '#ea580c'
},
'解放軍重要訓場/特殊設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#0d9488" stroke="#0f766e" stroke-width="2"/>
    <!-- 靶心/靶場 -->
    <circle cx="12" cy="12" r="5" stroke="white" stroke-width="1.6"/>
    <circle cx="12" cy="12" r="2" fill="white"/>
    <path d="M12 6v3M12 18v-3M6 12h3M18 12h-3" stroke="white" stroke-width="1.6"/>
    </svg>`,
    color: '#0d9488'
},
'解放軍陸軍、陸軍防空單位、聯勤保障設施、預備役部隊(部分設施為個人推斷)': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#16a34a" stroke="#15803d" stroke-width="2"/>
    <!-- 盾牌+V形臂章 -->
    <path d="M12 7l4 1.5v3.5c0 2.8-2.4 4.6-4 5.2-1.6-0.6-4-2.4-4-5.2V8.5L12 7Z" fill="white"/>
    <path d="M9.5 12l2.5 2 2.5-2" stroke="#16a34a" stroke-width="1.6" fill="none" stroke-linecap="round"/>
    </svg>`,
    color: '#16a34a'
},
'黨和國家重要政經軍事機關': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#be123c" stroke="#9f1239" stroke-width="2"/>
    <!-- 政府建築 -->
    <path d="M6 11h12v6H6v-6Z" fill="white"/>
    <path d="M6 11l6-3 6 3H6Z" fill="white"/>
    <path d="M8 12v4M10 12v4M12 12v4M14 12v4M16 12v4" stroke="#be123c" stroke-width="1.6"/>
    </svg>`,
    color: '#be123c'
}
};

// 根據layer獲取圖標
function getLayerIcon(layerName) {
return layerIcons[layerName] || layerIcons['武裝警察、海外軍事設施及其他分類'];
}

// 創建自定義標記圖標
function createCustomIcon(layerName, isZeroDistance = false) {
const iconData = getLayerIcon(layerName);
const size = isZeroDistance ? 40 : 32; // 零距離標記稍大一點

return L.divIcon({
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
    
    // 初始化筆記系統（IndexedDB）
    if (window.Notes && typeof window.Notes.init === 'function') {
      await window.Notes.init(map);
    }
    
    // 初始化面板狀態（手機版預設隱藏）
    initializePanelState();
    
    // 監聽視窗大小變化
    window.addEventListener('resize', handleResize);
    
    // 解析URL參數
    const urlCoords = parseUrlCoordinates();
    const urlParams = new URLSearchParams(window.location.search);
    
    // 如果有URL座標參數，使用50KM，否則使用100KM
    const radius = parseFloat(urlParams.get('radius')) || (urlCoords ? 50 : 100);
    const selectedLayer = urlParams.get('layer') || '';
    
    // 如果有URL參數，填入控制面板，否則使用預設位置
    if (urlCoords) {
    document.getElementById('latInput').value = urlCoords.lat;
    document.getElementById('lngInput').value = urlCoords.lng;
    } else {
    // 沒有URL參數時，使用預設位置並顯示100KM範圍
    document.getElementById('latInput').value = 25.5100;
    document.getElementById('lngInput').value = 119.7910;
    }
    document.getElementById('radiusInput').value = radius;
    // layerFilter 已改為多選下拉選單，由 unified_dropdown.js 處理
    
    // 載入地圖資料 - 優化版本，支援進度顯示
    const geojsonURL = DATA_BASE_URL + GEOJSON_FILENAME;
    
    // 更新載入狀態顯示進度
    document.querySelector('#loading div:last-child').textContent = '載入地圖資料中...';
    
    const response = await fetch(geojsonURL);
    
    if (!response.ok) {
    throw new Error(`載入資料失敗: ${response.status}`);
    }
    
    // 檢查資料大小並顯示進度
    const contentLength = response.headers.get('content-length');
    // 若可取得 content-length 且支援串流，顯示進度條（避免超過 100%）
    if (contentLength && response.body) {
    const total = Math.max(parseInt(contentLength, 10) || 0, 0);
    let loaded = 0;
    
    const reader = response.body.getReader();
    const chunks = [];
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        loaded += value.length;
        
        // 一律限制為 0–99%，完成後再顯示 100%
        const ratio = total > 0 ? loaded / total : 0;
        const progress = Math.max(0, Math.min(99, Math.floor(ratio * 100)));
        document.querySelector('#loading div:last-child').textContent = `載入地圖資料中... ${progress}%`;
    }
    
    // 組合所有片段
    const allChunks = new Uint8Array(loaded);
    let position = 0;
    for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
    }
    
    const text = new TextDecoder().decode(allChunks);
    const data = JSON.parse(text);
    allFeatures = data.features;
    layerIndex = buildLayerIndex(allFeatures);
    // 完成後明確設為 100%
    document.querySelector('#loading div:last-child').textContent = '載入地圖資料中... 100%';
    } else {
    // 如果沒有 content-length，使用原來的方式
    const data = await response.json();
    allFeatures = data.features;
    layerIndex = buildLayerIndex(allFeatures);
    }
    
    // 支援 shape 模式（禁航區繪制 + 附近點位）
    const shapeParam = (urlParams.get('shape') || '').trim().toLowerCase();
    if (shapeParam) {
      // shape 模式預設不顯示單位（點位）
      unitsVisible = false;
      const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);
      renderShapeMode(shapeSpec, selectedLayer);
    } else {
      // 根據URL參數渲染地圖，如果沒有URL座標，使用預設位置
      const targetCoords = urlCoords || { lat: 25.5100, lng: 119.7910 };
      renderMap(targetCoords, radius, selectedLayer);
    }
    
    // 效能統計
    const endTime = performance.now();
    const loadTime = ((endTime - startTime) / 1000).toFixed(2);
    // 完成後隱藏載入指示器（避免長時間遮擋畫面）
    hideLoading();
    
} catch (error) {
    hideLoading();
    console.error('載入地圖資料時發生錯誤:', error);
    updateInfoPanel(`錯誤：${error.message}`);
    
    // 即使載入失敗也要初始化基本地圖
    if (!map) {
    initializeMap();
    }
}
}

// 全域變數
let map;
let allFeatures = [];
// 分層索引快取：加速分層篩選
let layerIndex = null; // { layerName: Feature[] }
let currentMarkers = L.layerGroup();
let centerMarker = null;
// 禁航區圖層（No-Fly Zones）
let nfzLayerGroup = L.layerGroup();
const NFZ_NEARBY_BUFFER_KM = 50;
let unitsVisible = true;
// 繪圖/測距控制元件
let drawnItems = null;
let drawControl = null;
let polylineMeasureControl = null;

// 建立分層索引（一次 O(N)），提高後續分層切換效能
function buildLayerIndex(features) {
  const idx = Object.create(null);
  for (const f of features) {
    const props = f.properties || {};
    const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
    (idx[layerName] ||= []).push(f);
  }
  return idx;
}

// 篩選功能 - 根據距離篩選點位
function filterFeaturesByDistance(features, centerLat, centerLng, radiusKm = 50) {
return features.filter(feature => {
    const coords = feature.geometry.coordinates;
    const distance = calculateDistance(centerLat, centerLng, coords[1], coords[0]);
    return distance <= radiusKm;
});
}

// 將特徵批次加入為標記（共用於搜尋/shape 模式）
function addMarkersForFeatures(features, targetCoords = null, selectedLayer = null, radiusKm = null) {
  // 優化：分批載入標記以提升效能
  const featuresToShow = features || [];
  const batchSize = isMobileDevice() ? 50 : 100;
  let currentBatch = 0;

  const addMarkersBatch = () => {
    const start = currentBatch * batchSize;
    const end = Math.min(start + batchSize, featuresToShow.length);
    const batchFeatures = featuresToShow.slice(start, end);

    if (batchFeatures.length > 0) {
      L.geoJSON({ type: 'FeatureCollection', features: batchFeatures }, {
        pointToLayer: (feature, latlng) => {
          const props = feature.properties || {};
          const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
          let isZeroDistance = false;
          if (targetCoords) {
            const coords = feature.geometry.coordinates;
            const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
            isZeroDistance = distance < 0.1; // 小於100公尺視為零距離
          }
          const customIcon = createCustomIcon(layerName, isZeroDistance);
          const marker = L.marker(latlng, { icon: customIcon });
          currentMarkers.addLayer(marker);
          return marker;
        },
        onEachFeature: (feature, layer) => {
          const props = feature.properties || {};
          const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
          const iconData = getLayerIcon(layerName);
          let popupContent = '';
          let referenceLinks = [];
          let mainTitle = cleanText(props['名稱'] || props['name'] || '軍事設施');
          popupContent += `<div class="popup-header"><div class="popup-icon">${iconData.svg}</div><h3 class="popup-title">${mainTitle}</h3></div>`;
          const cleanLayerName = cleanText(layerName);
          popupContent += `<div class="popup-field"><strong>分層類別:</strong><span class="popup-field-value" style="color: ${iconData.color}; font-weight: 600;">${cleanLayerName}</span></div>`;
          let equipmentText = '';
          Object.entries(props).forEach(([key, value]) => {
            if (key === '說明') {
              const urlRegex = /(https?:\/\/[^\s]+)/g;
              const matchedURLs = value.match(urlRegex);
              if (matchedURLs) {
                referenceLinks.push(...matchedURLs);
                value = value.replace(urlRegex, '').trim();
              }
              value = cleanText(value);
              if (value.includes('裝備')) equipmentText = value;
            }
            if (['名稱', 'name', 'layer', '分層', '類別'].includes(key)) return;
            if (value && value.toString().trim()) {
              const cleanValue = cleanText(value);
              if (cleanValue) popupContent += `<div class=\"popup-field\"><strong>${key}:</strong><span class=\"popup-field-value\">${cleanValue}</span></div>`;
            }
          });
          if (targetCoords) {
            const coords = feature.geometry.coordinates;
            const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
            const isZeroDistance = distance < 0.1;
            if (isZeroDistance) {
              popupContent += `<div class=\"popup-distance\" style=\"background: linear-gradient(135deg, #fef2f2, #fee2e2); border-left: 4px solid #ef4444; border: 2px solid #ef4444; animation: subtle-pulse 2s infinite;\"><strong>就在搜尋中心</strong> <span style=\"color: #ef4444; font-weight: 700;\">${distance < 0.01 ? '< 10公尺' : `${(distance * 1000).toFixed(0)}公尺`}</span><br/><small style=\"color: #dc2626;\">此設施位於您指定的位置附近</small></div>`;
            } else {
              popupContent += `<div class=\"popup-distance\"><strong>距離搜尋中心:</strong> ${distance.toFixed(2)} 公里</div>`;
            }
          }
          // 相關連結
          if (referenceLinks.length) {
            popupContent += `<div class="popup-links"><div class="popup-links-title">相關連結</div>`;
            referenceLinks.forEach(url => { popupContent += `<a class="link-btn" href="${url}" target="_blank">${getLabel(url)}</a>`; });
            popupContent += '</div>';
          }
          
          // 筆記按鈕（獨立區塊）
          const geoCoords = feature.geometry.coordinates;
          const featureId = `geojson_${geoCoords[1].toFixed(6)}_${geoCoords[0].toFixed(6)}`;
          const escapeAttr = (str) => String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
          popupContent += `<div class="popup-actions"><a href="#" class="link-btn" onclick="openNoteFromPopup(this);return false;" 
            data-type="geojson"
            data-feature-id="${featureId}"
            data-feature-name="${escapeAttr(mainTitle)}"
            data-layer-name="${escapeAttr(layerName)}"
            data-lat="${geoCoords[1]}"
            data-lng="${geoCoords[0]}"
            data-metadata='{}'>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px;">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>筆記</a></div>`;
          
          const popupOptions = { className: 'custom-popup' };
          if (isMobileDevice()) {
            popupOptions.maxWidth = Math.min(350, window.innerWidth - 40);
            popupOptions.minWidth = Math.min(260, window.innerWidth - 60);
            popupOptions.maxHeight = Math.min(500, window.innerHeight - 120);
            popupOptions.autoPan = true;
            popupOptions.autoPanPadding = [10, 10];
            popupOptions.closeButton = true;
            popupOptions.keepInView = true;
            popupOptions.autoClose = false;
            popupOptions.closeOnEscapeKey = true;
          } else {
            popupOptions.maxWidth = 350;
            popupOptions.minWidth = 280;
          }
          layer.bindPopup(popupContent, popupOptions);
          if (equipmentText && window.equipmentParser) {
            processEquipmentAsync(layer, equipmentText);
          }
        }
      });

      currentBatch++;
      const progress = Math.round((end / featuresToShow.length) * 100);
      if (document.getElementById('loading').style.display === 'block') {
        document.querySelector('#loading div:last-child').textContent = `載入標記中... ${progress}%`;
      }
      if (end < featuresToShow.length) {
        setTimeout(addMarkersBatch, 10);
      } else {
        hideLoading();
        let message = `顯示 ${featuresToShow.length} 個點位`;
        if (selectedLayer) message += ` (${selectedLayer})`;
        if (targetCoords && Number.isFinite(radiusKm)) message += ` (${radiusKm}公里內)`;
        updateInfoPanel(message);
      }
    } else {
      hideLoading();
      let message = `顯示 0 個點位`;
      if (selectedLayer) message += ` (${selectedLayer})`;
      if (targetCoords && Number.isFinite(radiusKm)) message += ` (${radiusKm}公里內)`;
      updateInfoPanel(message);
    }
  };

  addMarkersBatch();
  applyUnitVisibility();
}
function applyUnitVisibility() {
  const toggleBtn = document.getElementById('toggleUnitsBtn');
  if (toggleBtn) toggleBtn.textContent = unitsVisible ? '隱藏單位' : '顯示單位';
  if (!map) return;
  if (unitsVisible) {
    currentMarkers.addTo(map);
  } else {
    try { map.removeLayer(currentMarkers); } catch (_) {}
  }
}

function toggleUnitsVisibility() {
  unitsVisible = !unitsVisible;
  applyUnitVisibility();
}


// 顯示載入指示器
function showLoading() {
document.getElementById('loading').style.display = 'block';
document.querySelector('#loading div:last-child').textContent = '初始化地圖...';
}

// 隱藏載入指示器
function hideLoading() {
document.getElementById('loading').style.display = 'none';
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

// 初始化地圖工具：Leaflet.draw 與 PolylineMeasure
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
    const measurePosition = isMobile ? 'bottomright' : 'bottomright';

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
            const redIcon = L.divIcon({
              className: 'custom-red-marker',
              html: '<div style="background-color: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
              iconSize: [16, 16],
              iconAnchor: [8, 8],
              popupAnchor: [0, -8]
            });
            layer.setIcon(redIcon);
            const { lat, lng } = layer.getLatLng();
            let popupHtml = `<div class="drawing-popup"><strong>📍 標記點</strong><br/>緯度：${lat.toFixed(6)}<br/>經度：${lng.toFixed(6)}`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: '標記點',
                layerName: '手動標記',
                lat: lat,
                lng: lng,
                metadata: { drawingType: 'marker' }
              });
            }
            popupHtml += '</div>';
            layer.bindPopup(popupHtml);
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
            let popupHtml = `<div class="drawing-popup"><strong>📏 線段</strong><br/>長度：${lengthText}`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `線段 (${lengthText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: 'polyline', length: total }
              });
            }
            popupHtml += '</div>';
            layer.bindPopup(popupHtml);
          } else if (type === 'polygon' || type === 'rectangle') {
            // 使用 Leaflet.draw 的 geodesicArea（若存在）
            let areaText = '無法計算';
            let area = 0;
            try {
              const latlngs = layer.getLatLngs();
              const flat = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs; // 兼容多邊形/矩形
              if (L.GeometryUtil && typeof L.GeometryUtil.geodesicArea === 'function') {
                area = L.GeometryUtil.geodesicArea(flat);
                areaText = area < 1e6
                  ? `約 ${area.toFixed(0)} 平方公尺`
                  : `約 ${(area / 1e6).toFixed(2)} 平方公里`;
              }
            } catch (_) {}
            const shapeType = type === 'rectangle' ? '矩形' : '多邊形';
            const center = layer.getBounds().getCenter();
            let popupHtml = `<div class="drawing-popup"><strong>📐 ${shapeType}</strong><br/>面積：${areaText}`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `${shapeType} (${areaText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: type, area: area }
              });
            }
            popupHtml += '</div>';
            layer.bindPopup(popupHtml);
          } else if (type === 'circle') {
            // 圓形處理
            const center = layer.getLatLng();
            const radius = layer.getRadius();
            const radiusText = radius < 1000
              ? `${radius.toFixed(0)} 公尺`
              : `${(radius / 1000).toFixed(2)} 公里`;
            let popupHtml = `<div class="drawing-popup"><strong>⭕ 圓形</strong><br/>半徑：${radiusText}`;
            if (window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
              popupHtml += window.Notes.getNoteButtonHtml({
                type: 'drawing',
                featureId: drawingId,
                featureName: `圓形 (半徑 ${radiusText})`,
                layerName: '手動繪製',
                lat: center.lat,
                lng: center.lng,
                metadata: { drawingType: 'circle', radius: radius }
              });
            }
            popupHtml += '</div>';
            layer.bindPopup(popupHtml);
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

    // 安裝 PolylineMeasure（預設公里顯示，提供清除控制）
    if (window.L && L.control && L.control.polylineMeasure && !polylineMeasureControl) {
      polylineMeasureControl = L.control.polylineMeasure({
        position: measurePosition,
        unit: 'kilometres',
        showUnitControl: true,
        showClearControl: true,
        clearMeasurementsOnStop: false,
        // 若外掛支援則套用紅色主題；不支援時忽略
        color: '#ef4444'
      });
      polylineMeasureControl.addTo(map);

      // 嘗試本地化測距控制項的 title 文案為繁體中文
      setTimeout(() => {
        try {
          const root = document.querySelector('.polyline-measure-control');
          const onBtn = document.querySelector('.polyline-measure-controlOn');
          const clearBtn = document.querySelector('.polyline-measure-clearControl');
          const unitBtn = document.querySelector('.polyline-measure-unitControl');
          const bearingBtn = document.querySelector('.polyline-measure-bearingControl');
          const targets = [root, onBtn].filter(Boolean);
          targets.forEach(el => el.setAttribute('title', '啟動/停止距離測量'));
          if (clearBtn) clearBtn.setAttribute('title', '清除測量');
          if (unitBtn) unitBtn.setAttribute('title', '切換單位');
          if (bearingBtn) bearingBtn.setAttribute('title', '切換方位角');
        } catch (_) { /* 忽略 DOM 無法定位時的錯誤 */ }
      }, 0);
    }
  } catch (err) {
    console.warn('Map tools setup skipped:', err);
  }
}

// 更新資訊面板
// 更新資訊面板，顯示點位統計資訊
function updateInfoPanel(message) {
  const infoPanel = document.getElementById('infoPanel');
  const infoText = document.getElementById('infoText');
  infoText.innerHTML = `
    <div class="info-panel-content">
      <span class="info-message">${message}</span>
      <span class="changelog-link" onclick="showChangelog(event)">更新資訊</span>
    </div>
  `;
  infoPanel.style.display = 'block';
}

// 顯示更新日誌彈窗
function showChangelog(event) {
  event.stopPropagation();
  
  // 關閉控制面板（如果是手機版）
  const controlPanel = document.getElementById('controlPanel');
  const panelBackdrop = document.getElementById('panelBackdrop');
  if (window.innerWidth <= 768) {
    controlPanel.classList.remove('active');
    panelBackdrop.style.display = 'none';
  }
  
  // 動態生成更新日誌內容
  const changelogBody = document.querySelector('.changelog-body');
  if (changelogBody) {
    changelogBody.innerHTML = CHANGELOG.map(item => `
      <div class="changelog-item">
        <span class="changelog-date">${item.date}：</span>
        <span class="changelog-desc">${item.description}</span>
      </div>
    `).join('');
  }
  
  // 顯示更新日誌 modal
  const modal = document.getElementById('changelogModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// 關閉更新日誌彈窗
function closeChangelog() {
  const modal = document.getElementById('changelogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 檢測是否為手機設備
function isMobileDevice() {
return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 清理文字中的HTML實體字符和多餘空格
function cleanText(text) {
if (!text) return '';

return text.toString()
    .replace(/&nbsp;/g, ' ')           // 替換 &nbsp; 為普通空格
    .replace(/&amp;/g, '&')           // 替換 &amp; 為 &
    .replace(/&lt;/g, '<')            // 替換 &lt; 為 <
    .replace(/&gt;/g, '>')            // 替換 &gt; 為 >
    .replace(/&quot;/g, '"')          // 替換 &quot; 為 "
    .replace(/&#39;/g, "'")           // 替換 &#39; 為 '
    .replace(/\s+/g, ' ')             // 多個空格替換為單個空格
    .trim();                          // 移除首尾空格
}

// 隱藏/顯示控制面板
function closeControlPanel() {
  const panel = document.getElementById('controlPanel');
  const toggleBtn = document.querySelector('.toggle-panel');
  if (!panel) return;

  panel.classList.remove('show-mobile');
  if (isMobileDevice()) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }

  if (toggleBtn) toggleBtn.style.zIndex = '1600';
}

function togglePanel() {
const panel = document.getElementById('controlPanel');
const toggleBtn = document.querySelector('.toggle-panel');

if (isMobileDevice()) {
    // 手機版使用不同的class
    panel.classList.toggle('show-mobile');
    // 面板開啟時讓按鈕位於面板之下或隱藏
    if (panel.classList.contains('show-mobile')) {
      toggleBtn.style.zIndex = '1400';
    } else {
      toggleBtn.style.zIndex = '1600';
    }
} else {
    // 桌面版使用原有的hidden class
    panel.classList.toggle('hidden');
    // 面板開啟(未隱藏)時將按鈕壓到下面
    if (!panel.classList.contains('hidden')) {
      toggleBtn.style.zIndex = '1400';
    } else {
      toggleBtn.style.zIndex = '1600';
    }
}
}

// 初始化面板顯示狀態
function initializePanelState() {
const panel = document.getElementById('controlPanel');
const mobileHint = document.getElementById('mobileHint');
const toggleBtn = document.querySelector('.toggle-panel');

if (isMobileDevice()) {
    // 手機版預設隱藏
    panel.classList.remove('show-mobile');
    // 確保不使用桌面版的hidden class
    panel.classList.remove('hidden');
    // 顯示手機版提示（如果存在）
    if (mobileHint) {
        mobileHint.style.display = 'block';
    }
    if (toggleBtn) {
        toggleBtn.style.zIndex = '1600';
    }
} else {
    // 桌面版預設顯示
    panel.classList.remove('hidden');
    panel.classList.remove('show-mobile');
    // 隱藏手機版提示（如果存在）
    if (mobileHint) {
        mobileHint.style.display = 'none';
    }
    if (toggleBtn) {
        toggleBtn.style.zIndex = '1400';
    }
}
}

// 監聽視窗大小變化
function handleResize() {
const panel = document.getElementById('controlPanel');
const mobileHint = document.getElementById('mobileHint');
const toggleBtn = document.querySelector('.toggle-panel');

if (isMobileDevice()) {
    // 切換到手機版
    panel.classList.remove('hidden');
    if (mobileHint) {
        mobileHint.style.display = 'block';
    }
    if (!panel.classList.contains('show-mobile')) {
    // 如果面板是開啟狀態，保持開啟
    const wasVisible = !panel.classList.contains('hidden');
    if (wasVisible) {
        panel.classList.add('show-mobile');
    }
    }
    if (toggleBtn) {
        toggleBtn.style.zIndex = panel.classList.contains('show-mobile') ? '1400' : '1600';
    }
} else {
    // 切換到桌面版
    panel.classList.remove('show-mobile');
    if (mobileHint) {
        mobileHint.style.display = 'none';
    }
    // 桌面版預設顯示
    panel.classList.remove('hidden');
    if (toggleBtn) {
        toggleBtn.style.zIndex = '1400';
    }
}
}

// （保留由點擊地圖/切換按鈕控制面板開關）

// 根據分層篩選特徵
function filterFeaturesByLayer(features, selectedLayer) {
if (!selectedLayer) return features;
// 若已建立索引，直接回傳對應陣列（避免重複掃描全量 features）
if (layerIndex && layerIndex[selectedLayer]) return layerIndex[selectedLayer];
// 後備：無索引時退回線性過濾
return features.filter(feature => {
    const props = feature.properties || {};
    const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
    return layerName === selectedLayer;
});
}

// 分層篩選功能（已棄用，由 unified_dropdown.js 處理）
function filterByLayer() {
  // 此函數已被 unified_dropdown.js 的多選系統取代
  console.warn('filterByLayer() is deprecated. Use unified_dropdown.js system instead.');
}

// 搜尋位置功能
function searchLocation() {
const lat = parseFloat(document.getElementById('latInput').value);
const lng = parseFloat(document.getElementById('lngInput').value);
const radius = parseFloat(document.getElementById('radiusInput').value) || 50;

if (isNaN(lat) || isNaN(lng)) {
    alert('請輸入有效的經緯度數值！');
    return;
}

// 獲取當前選中的圖層
const selectedLayers = window.getSelectedLayers ? window.getSelectedLayers() : [];

// 更新URL（保留 layers 參數，但清除 SHAPE 相關參數）
const urlParams = new URLSearchParams(window.location.search);

// 清除 SHAPE 模式的所有參數
urlParams.delete('shape');
urlParams.delete('line');
urlParams.delete('polygon');
urlParams.delete('circle');
urlParams.delete('sector');
urlParams.delete('bbox');
urlParams.delete('text');
urlParams.delete('unit');

// 設置座標搜尋參數
urlParams.set('lat', lat);
urlParams.set('lng', lng);
urlParams.set('radius', radius);

// 如果沒有選中任何圖層，刪除 layers 參數（表示顯示所有圖層）
if (selectedLayers.length === 0) {
    urlParams.delete('layers');
}

const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
window.history.pushState({}, '', newUrl);

// 重新渲染地圖
// 如果沒有選中任何圖層，直接調用 renderMap 顯示所有圖層
if (selectedLayers.length === 0) {
    renderMap({ lat, lng }, radius, null);
} else if (window.renderMapWithMultipleLayers) {
    window.renderMapWithMultipleLayers({ lat, lng }, radius, selectedLayers);
} else {
    renderMap({ lat, lng }, radius, null);
}

// 手機版自動關閉控制面板
if (isMobileDevice()) {
    closeControlPanel();
}
}

// 複製URL功能
function copyUrl() {
const url = window.location.href;
navigator.clipboard.writeText(url).then(() => {
    updateInfoPanel('連結已複製到剪貼簿！');
    setTimeout(() => {
    document.getElementById('infoPanel').style.display = 'none';
    }, 3000);
}).catch(() => {
    // 備用方案
    const textArea = document.createElement('textarea');
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    updateInfoPanel('連結已複製！');
    setTimeout(() => {
    document.getElementById('infoPanel').style.display = 'none';
    }, 3000);
});
}

// 清除目前繪製的圖形
function clearDrawings() {
  try {
    if (drawnItems) drawnItems.clearLayers();
  } catch (e) {
    console.warn('clearDrawings failed', e);
  }
}

// 渲染地圖功能 - 優化版本，支援延遲載入
function renderMap(targetCoords, radiusKm = 50, selectedLayer = null) {
// 清除現有標記
currentMarkers.clearLayers();
if (centerMarker) {
    map.removeLayer(centerMarker);
    centerMarker = null;
}
// 清除禁航區圖層（切回搜尋模式時）
try { nfzLayerGroup.clearLayers(); } catch (_) {}

let featuresToShow = allFeatures;
let mapCenter = [25.5100, 119.7910]; // 預設中心
let mapZoom = 7;

// 更新載入狀態
if (document.getElementById('loading').style.display === 'block') {
    document.querySelector('#loading div:last-child').textContent = '渲染地圖標記中...';
}

// 先進行分層篩選
if (selectedLayer) {
    featuresToShow = filterFeaturesByLayer(featuresToShow, selectedLayer);
}

// 然後進行地理位置篩選
if (targetCoords) {
    mapCenter = [targetCoords.lat, targetCoords.lng];
    mapZoom = 15; // 增加預設縮放級別，讓用戶能看得更清楚
    
    // 篩選附近的點位
    featuresToShow = filterFeaturesByDistance(
    featuresToShow, 
    targetCoords.lat, 
    targetCoords.lng, 
    radiusKm
    );
    
    // 添加中心標記
    const redIcon = L.divIcon({
        className: 'custom-red-marker',
    html: '<div style="background-color: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    
    centerMarker = L.marker([targetCoords.lat, targetCoords.lng], { icon: redIcon })
        .addTo(map)
    .bindPopup(`<strong>搜尋中心</strong><br/>緯度: ${targetCoords.lat}<br/>經度: ${targetCoords.lng}<br/>搜尋半徑: ${radiusKm} 公里`);
    }

// 設定地圖視野
map.setView(mapCenter, mapZoom);

    // 優化：分批載入標記以提升效能
    const batchSize = isMobileDevice() ? 50 : 100; // 手機版每批50個，桌面版100個
    let currentBatch = 0;
    
    const addMarkersBatch = () => {
    const start = currentBatch * batchSize;
    const end = Math.min(start + batchSize, featuresToShow.length);
    const batchFeatures = featuresToShow.slice(start, end);
    
    if (batchFeatures.length > 0) {
        L.geoJSON({ type: 'FeatureCollection', features: batchFeatures }, {
        pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
        
        // 檢查是否為零距離點位（距離搜尋中心很近）
        let isZeroDistance = false;
        if (targetCoords) {
            const coords = feature.geometry.coordinates;
            const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
            isZeroDistance = distance < 0.1; // 小於100公尺視為零距離
        }
        
        const customIcon = createCustomIcon(layerName, isZeroDistance);
        const marker = L.marker(latlng, { icon: customIcon });
        currentMarkers.addLayer(marker);
        return marker;
        },
    onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
    const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
    const iconData = getLayerIcon(layerName);
    
        let popupContent = '';
        let referenceLinks = [];
    let mainTitle = cleanText(props['名稱'] || props['name'] || '軍事設施');

    // 構建popup標題
    popupContent += `<div class="popup-header"><div class="popup-icon">${iconData.svg}</div><h3 class="popup-title">${mainTitle}</h3></div>`;

    // 顯示分層資訊
    const cleanLayerName = cleanText(layerName);
    popupContent += `<div class="popup-field"><strong>分層類別:</strong><span class="popup-field-value" style="color: ${iconData.color}; font-weight: 600;">${cleanLayerName}</span></div>`;

    // 儲存裝備文本供後續處理
    let equipmentText = '';
    
    // 處理其他屬性
        Object.entries(props).forEach(([key, value]) => {
        if (key === '說明') {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const matchedURLs = value.match(urlRegex);
            if (matchedURLs) {
            referenceLinks.push(...matchedURLs);
            value = value.replace(urlRegex, '').trim();
            }
            
            // 清理說明文字
            value = cleanText(value);
            
            // 儲存包含裝備資訊的文本
            if (value.includes('裝備')) {
            equipmentText = value;
            }
        }
        
        // 跳過已處理的欄位
        if (['名稱', 'name', 'layer', '分層', '類別'].includes(key)) return;
        
        if (value && value.toString().trim()) {
        const cleanValue = cleanText(value);
        if (cleanValue) {
            popupContent += `<div class="popup-field"><strong>${key}:</strong><span class="popup-field-value">${cleanValue}</span></div>`;
        }
        }
    });

    // 如果有目標座標，顯示距離資訊
    if (targetCoords) {
        const coords = feature.geometry.coordinates;
        const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
        const isZeroDistance = distance < 0.1;
        
        if (isZeroDistance) {
        popupContent += `<div class="popup-distance" style="background: linear-gradient(135deg, #fef2f2, #fee2e2); border-left: 4px solid #ef4444; border: 2px solid #ef4444; animation: subtle-pulse 2s infinite;"><strong>就在搜尋中心</strong> <span style="color: #ef4444; font-weight: 700;">${distance < 0.01 ? '< 10公尺' : `${(distance * 1000).toFixed(0)}公尺`}</span><br/><small style="color: #dc2626;">此設施位於您指定的位置附近</small></div>`;
        } else {
        popupContent += `<div class="popup-distance"><strong>距離搜尋中心:</strong> ${distance.toFixed(2)} 公里</div>`;
        }
    }

    // 添加參考連結
        if (referenceLinks.length) {
        popupContent += `<div class="popup-links"><div class="popup-links-title">相關連結</div>`;
        referenceLinks.forEach(url => {
            popupContent += `<a class="link-btn" href="${url}" target="_blank">${getLabel(url)}</a>`;
        });
        popupContent += '</div>';
    }
    
    // 筆記按鈕（獨立區塊）
    const geoCoords = feature.geometry.coordinates;
    const featureId = `geojson_${geoCoords[1].toFixed(6)}_${geoCoords[0].toFixed(6)}`;
    const escapeAttr = (str) => String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    popupContent += `<div class="popup-actions"><a href="#" class="link-btn" onclick="openNoteFromPopup(this);return false;" 
      data-type="geojson"
      data-feature-id="${featureId}"
      data-feature-name="${escapeAttr(mainTitle)}"
      data-layer-name="${escapeAttr(layerName)}"
      data-lat="${geoCoords[1]}"
      data-lng="${geoCoords[0]}"
      data-metadata='{}'>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px;">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
      </svg>筆記</a></div>`;

    // 根據設備類型調整popup設定
    const popupOptions = {
        className: 'custom-popup'
    };
    
    if (isMobileDevice()) {
        popupOptions.maxWidth = Math.min(350, window.innerWidth - 40);
        popupOptions.minWidth = Math.min(260, window.innerWidth - 60);
        popupOptions.maxHeight = Math.min(500, window.innerHeight - 120);
        popupOptions.autoPan = true;
        popupOptions.autoPanPadding = [10, 10];
        popupOptions.closeButton = true;
        popupOptions.keepInView = true;
        popupOptions.autoClose = false;
        popupOptions.closeOnEscapeKey = true;
    } else {
        popupOptions.maxWidth = 350;
        popupOptions.minWidth = 280;
    }
    
    // 綁定popup
    const popup = layer.bindPopup(popupContent, popupOptions);
    
    // 異步處理裝備資訊
    if (equipmentText && window.equipmentParser) {
        processEquipmentAsync(layer, equipmentText);
    }
        }
        });
        
        currentBatch++;
        
        // 更新進度
        const progress = Math.round((end / featuresToShow.length) * 100);
        if (document.getElementById('loading').style.display === 'block') {
        document.querySelector('#loading div:last-child').textContent = `載入標記中... ${progress}%`;
        }
        
        // 如果還有更多批次，使用 setTimeout 避免阻塞 UI
        if (end < featuresToShow.length) {
        setTimeout(addMarkersBatch, 10); // 10ms 延遲
        } else {
        // 載入完成
        hideLoading();
        
        // 更新資訊面板
        let message = `顯示 ${featuresToShow.length} 個點位`;
        
        if (selectedLayer) {
            message += ` (${selectedLayer})`;
        }
        
        if (targetCoords) {
            message += ` (${radiusKm}公里內)`;
        }
        
        updateInfoPanel(message);
        }
    } else {
        hideLoading();
        
        // 如果沒有點位可顯示，也要更新資訊面板
        let message = `顯示 0 個點位`;
        
        if (selectedLayer) {
            message += ` (${selectedLayer})`;
        }
        
        if (targetCoords) {
            message += ` (${radiusKm}公里內)`;
        }
        
        updateInfoPanel(message);
    }
    };
    
    // 開始載入第一批
    addMarkersBatch();

// 將標記群組添加到地圖
applyUnitVisibility();
}

// 當頁面載入完成時啟動應用程式
document.addEventListener('DOMContentLoaded', init);

// 頂部提醒：滑入+3秒後淡出
function showTopNotice() {
  try {
    const el = document.getElementById('topNotice');
    if (!el) return;
    // 下一幀加入 .show 以觸發過渡
    requestAnimationFrame(() => {
      el.classList.add('show');
    });
    const DISPLAY_MS = 5000; // 顯示5秒
    setTimeout(() => {
      el.classList.add('hide');
      el.addEventListener('transitionend', () => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, { once: true });
    }, DISPLAY_MS);
  } catch (e) {
    // 靜默失敗，不影響主流程
    console.warn('top notice failed', e);
  }
}

// ==========================================================
// 搜尋功能
// ==========================================================

// 執行搜尋
// 使用搜尋請求 ID 來避免競態條件
let desktopSearchRequestId = 0;

async function performSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.style.display = 'none';
    return;
  }

  // 檢查 searchUtils 是否已載入
  if (!window.searchUtils) {
    console.error('Search utils not loaded');
    searchResults.innerHTML = '<div class="search-no-results">搜尋功能載入中，請稍後再試...</div>';
    searchResults.style.display = 'block';
    return;
  }

  // 生成新的搜尋請求 ID
  const currentRequestId = ++desktopSearchRequestId;

  // 顯示載入狀態
  searchResults.innerHTML = '<div class="search-loading">搜尋中...</div>';
  searchResults.style.display = 'block';

  try {
    // 使用混合搜尋：本地 GeoJSON + Nominatim API
    const results = await window.searchUtils.searchCombined(allFeatures, query, {
      searchFields: ['名稱', '說明', 'layer'],
      maxResults: isMobileDevice() ? 20 : 50,
      includeNominatim: true,
      nominatimMaxResults: 5
    });

    // 只有當這個請求仍然是最新的時候才顯示結果
    if (currentRequestId === desktopSearchRequestId) {
      displaySearchResults(results, query);
    } else {
      console.log('Ignoring outdated desktop search result');
    }
  } catch (error) {
    console.error('Search error:', error);
    // 只有當這個請求仍然是最新的時候才顯示錯誤
    if (currentRequestId === desktopSearchRequestId) {
      searchResults.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 顯示搜尋結果
function displaySearchResults(results, query) {
  const searchResults = document.getElementById('searchResults');

  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">找不到相關地點</div>';
    searchResults.style.display = 'block';
    return;
  }

  let html = '';
  results.forEach((result, index) => {
    const name = result.displayName || result.name || '未命名';
    const layer = result.layer || '未分類';
    const coords = result.coordinates;
    const coordsText = coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : '';
    const source = result.source || 'local';

    // 高亮匹配文本（僅對本地結果）
    const displayName = source === 'local'
      ? window.searchUtils.highlightMatch(name, query)
      : name;

    // 來源標記
    const sourceIcon = source === 'nominatim'
      ? '<span class="search-source-badge" title="來自 OpenStreetMap">🌍</span>'
      : '';

    html += `
      <div class="search-result-item ${source === 'nominatim' ? 'nominatim-result' : ''}" onclick="selectSearchResult(${index})">
        <div class="search-result-name">${displayName} ${sourceIcon}</div>
        <div class="search-result-layer">${layer}</div>
        <div class="search-result-coords">${coordsText}</div>
      </div>
    `;
  });

  searchResults.innerHTML = html;
  searchResults.style.display = 'block';

  // 保存結果供選擇使用
  window.currentSearchResults = results;
}

// 選擇搜尋結果
function selectSearchResult(index) {
  const results = window.currentSearchResults;
  if (!results || !results[index]) return;

  const result = results[index];
  const coords = result.coordinates;

  if (!coords || coords.length < 2) return;

  const lat = coords[1];
  const lng = coords[0];

  // 填入座標
  document.getElementById('latInput').value = lat;
  document.getElementById('lngInput').value = lng;

  // 隱藏搜尋結果
  document.getElementById('searchResults').style.display = 'none';

  // 設定預設半徑
  const radiusInput = document.getElementById('radiusInput');
  if (!radiusInput.value || parseFloat(radiusInput.value) > 100) {
    radiusInput.value = 10; // 搜尋結果預設使用較小半徑
  }

  // 獲取當前選中的圖層
  const selectedLayers = window.getSelectedLayers ? window.getSelectedLayers() : [];
  const radius = parseFloat(radiusInput.value) || 10;

  // 更新 URL（保留 layers 參數，但清除 SHAPE 相關參數）
  const urlParams = new URLSearchParams(window.location.search);

  // 清除 SHAPE 模式的所有參數
  urlParams.delete('shape');
  urlParams.delete('line');
  urlParams.delete('polygon');
  urlParams.delete('circle');
  urlParams.delete('sector');
  urlParams.delete('bbox');
  urlParams.delete('text');
  urlParams.delete('unit');

  // 設置座標搜尋參數
  urlParams.set('lat', lat);
  urlParams.set('lng', lng);
  urlParams.set('radius', radius);

  // 如果沒有選中任何圖層，刪除 layers 參數（表示顯示所有圖層）
  if (selectedLayers.length === 0) {
    urlParams.delete('layers');
  }

  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
  window.history.pushState({}, '', newUrl);

  // 渲染地圖
  // 如果沒有選中任何圖層，直接調用 renderMap 顯示所有圖層
  if (selectedLayers.length === 0) {
    renderMap({ lat, lng }, radius, null);
  } else if (window.renderMapWithMultipleLayers) {
    window.renderMapWithMultipleLayers({ lat, lng }, radius, selectedLayers);
  } else {
    renderMap({ lat, lng }, radius, null);
  }

  // 手機版自動關閉面板
  if (isMobileDevice()) {
    closeControlPanel();
  }

  // 清空搜尋框（可選）
  // document.getElementById('searchInput').value = '';
}

// 手機版搜尋功能
// 使用搜尋請求 ID 來避免競態條件
let mobileSearchRequestId = 0;

async function performMobileSearch() {
  const searchInput = document.getElementById('mobileSearchInput');
  const searchResults = document.getElementById('mobileSearchResults');
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.style.display = 'none';
    return;
  }

  // 檢查 searchUtils 是否已載入
  if (!window.searchUtils) {
    console.error('Search utils not loaded');
    searchResults.innerHTML = '<div class="search-no-results">搜尋功能載入中，請稍後再試...</div>';
    searchResults.style.display = 'block';
    return;
  }

  // 生成新的搜尋請求 ID
  const currentRequestId = ++mobileSearchRequestId;

  // 顯示載入狀態
  searchResults.innerHTML = '<div class="search-loading">搜尋中...</div>';
  searchResults.style.display = 'block';

  try {
    // 使用混合搜尋：本地 GeoJSON + Nominatim API
    const results = await window.searchUtils.searchCombined(allFeatures, query, {
      searchFields: ['名稱', '說明', 'layer'],
      maxResults: 20,
      includeNominatim: true,
      nominatimMaxResults: 5
    });

    // 只有當這個請求仍然是最新的時候才顯示結果
    if (currentRequestId === mobileSearchRequestId) {
      displayMobileSearchResults(results, query);
    } else {
      console.log('Ignoring outdated mobile search result');
    }
  } catch (error) {
    console.error('Search error:', error);
    // 只有當這個請求仍然是最新的時候才顯示錯誤
    if (currentRequestId === mobileSearchRequestId) {
      searchResults.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 顯示手機版搜尋結果
function displayMobileSearchResults(results, query) {
  const searchResults = document.getElementById('mobileSearchResults');

  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">找不到相關地點</div>';
    searchResults.style.display = 'block';
    return;
  }

  let html = '';
  results.forEach((result, index) => {
    const name = result.displayName || result.name || '未命名';
    const layer = result.layer || '未分類';
    const coords = result.coordinates;
    const coordsText = coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : '';
    const source = result.source || 'local';

    // 高亮匹配文本（僅對本地結果）
    const displayName = source === 'local'
      ? window.searchUtils.highlightMatch(name, query)
      : name;

    // 來源標記
    const sourceIcon = source === 'nominatim'
      ? '<span class="search-source-badge" title="來自 OpenStreetMap">🌍</span>'
      : '';

    html += `
      <div class="search-result-item ${source === 'nominatim' ? 'nominatim-result' : ''}" onclick="selectMobileSearchResult(${index})">
        <div class="search-result-name">${displayName} ${sourceIcon}</div>
        <div class="search-result-layer">${layer}</div>
        <div class="search-result-coords">${coordsText}</div>
      </div>
    `;
  });

  searchResults.innerHTML = html;
  searchResults.style.display = 'block';

  // 保存結果供選擇使用
  window.currentMobileSearchResults = results;
}

// 選擇手機版搜尋結果
function selectMobileSearchResult(index) {
  const results = window.currentMobileSearchResults;
  if (!results || !results[index]) return;

  const result = results[index];
  const coords = result.coordinates;

  if (!coords || coords.length < 2) return;

  const lat = coords[1];
  const lng = coords[0];

  // 填入座標到控制面板（如果用戶要調整）
  document.getElementById('latInput').value = lat;
  document.getElementById('lngInput').value = lng;

  // 隱藏搜尋結果
  document.getElementById('mobileSearchResults').style.display = 'none';

  // 清空搜尋框
  document.getElementById('mobileSearchInput').value = '';
  document.getElementById('mobileClearBtn').style.display = 'none';

  // 設定預設半徑
  const radiusInput = document.getElementById('radiusInput');
  if (!radiusInput.value || parseFloat(radiusInput.value) > 100) {
    radiusInput.value = 10; // 搜尋結果預設使用較小半徑
  }

  // 獲取當前選中的圖層
  const selectedLayers = window.getSelectedLayers ? window.getSelectedLayers() : [];
  const radius = parseFloat(radiusInput.value) || 10;

  // 更新 URL（保留 layers 參數，但清除 SHAPE 相關參數）
  const urlParams = new URLSearchParams(window.location.search);

  // 清除 SHAPE 模式的所有參數
  urlParams.delete('shape');
  urlParams.delete('line');
  urlParams.delete('polygon');
  urlParams.delete('circle');
  urlParams.delete('sector');
  urlParams.delete('bbox');
  urlParams.delete('text');
  urlParams.delete('unit');

  // 設置座標搜尋參數
  urlParams.set('lat', lat);
  urlParams.set('lng', lng);
  urlParams.set('radius', radius);

  // 如果沒有選中任何圖層，刪除 layers 參數（表示顯示所有圖層）
  if (selectedLayers.length === 0) {
    urlParams.delete('layers');
  }

  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
  window.history.pushState({}, '', newUrl);

  // 渲染地圖
  // 如果沒有選中任何圖層，直接調用 renderMap 顯示所有圖層
  if (selectedLayers.length === 0) {
    renderMap({ lat, lng }, radius, null);
  } else if (window.renderMapWithMultipleLayers) {
    window.renderMapWithMultipleLayers({ lat, lng }, radius, selectedLayers);
  } else {
    renderMap({ lat, lng }, radius, null);
  }
}

// 清除手機版搜尋
function clearMobileSearch() {
  const searchInput = document.getElementById('mobileSearchInput');
  const searchResults = document.getElementById('mobileSearchResults');
  const clearBtn = document.getElementById('mobileClearBtn');

  searchInput.value = '';
  searchResults.style.display = 'none';
  clearBtn.style.display = 'none';
  searchInput.focus();
}

// 設置手機版搜尋輸入監聽
function setupMobileSearchInput() {
  const searchInput = document.getElementById('mobileSearchInput');
  const clearBtn = document.getElementById('mobileClearBtn');
  if (!searchInput) return;

  let searchTimeout;
  let selectedResultIndex = -1;

  // 輸入時即時搜尋（防抖）
  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const query = this.value.trim();

    selectedResultIndex = -1; // 重置選中項

    // 顯示/隱藏清除按鈕
    if (this.value.length > 0) {
      clearBtn.style.display = 'flex';
    } else {
      clearBtn.style.display = 'none';
    }

    if (!query) {
      document.getElementById('mobileSearchResults').style.display = 'none';
      return;
    }

    // 延遲搜尋以避免過於頻繁
    searchTimeout = setTimeout(() => {
      performMobileSearch();
    }, 300); // 300ms 延遲
  });

  // 鍵盤導航
  searchInput.addEventListener('keydown', function(e) {
    const searchResults = document.getElementById('mobileSearchResults');
    const resultItems = searchResults.querySelectorAll('.search-result-item');

    if (!resultItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedResultIndex = Math.min(selectedResultIndex + 1, resultItems.length - 1);
      updateSelectedMobileResult(resultItems, selectedResultIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedResultIndex = Math.max(selectedResultIndex - 1, -1);
      updateSelectedMobileResult(resultItems, selectedResultIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedResultIndex >= 0) {
        selectMobileSearchResult(selectedResultIndex);
      } else {
        performMobileSearch();
      }
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
      selectedResultIndex = -1;
    }
  });

  // 點擊外部關閉搜尋結果
  document.addEventListener('click', function(e) {
    const searchResults = document.getElementById('mobileSearchResults');
    const mobileSearchBar = document.getElementById('mobileSearchBar');

    if (mobileSearchBar && !mobileSearchBar.contains(e.target)) {
      searchResults.style.display = 'none';
      selectedResultIndex = -1;
    }
  });

  // 更新選中的結果項
  function updateSelectedMobileResult(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}

// 即時搜尋（當用戶輸入時）- 桌面版
function setupSearchInput() {
  const searchInput = document.getElementById('searchInput');
  if (!searchInput) return;

  let searchTimeout;
  let selectedResultIndex = -1;

  // 輸入時即時搜尋（防抖）
  searchInput.addEventListener('input', function() {
    clearTimeout(searchTimeout);
    const query = this.value.trim();

    selectedResultIndex = -1; // 重置選中項

    if (!query) {
      document.getElementById('searchResults').style.display = 'none';
      return;
    }

    // 延遲搜尋以避免過於頻繁
    searchTimeout = setTimeout(() => {
      performSearch();
    }, 300); // 300ms 延遲
  });

  // 鍵盤導航
  searchInput.addEventListener('keydown', function(e) {
    const searchResults = document.getElementById('searchResults');
    const resultItems = searchResults.querySelectorAll('.search-result-item');

    if (!resultItems.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedResultIndex = Math.min(selectedResultIndex + 1, resultItems.length - 1);
      updateSelectedResult(resultItems, selectedResultIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedResultIndex = Math.max(selectedResultIndex - 1, -1);
      updateSelectedResult(resultItems, selectedResultIndex);
    } else if (e.key === 'Enter' && selectedResultIndex >= 0) {
      e.preventDefault();
      selectSearchResult(selectedResultIndex);
    } else if (e.key === 'Escape') {
      searchResults.style.display = 'none';
      selectedResultIndex = -1;
    }
  });

  // 點擊外部關閉搜尋結果
  document.addEventListener('click', function(e) {
    const searchResults = document.getElementById('searchResults');
    const controlPanel = document.getElementById('controlPanel');

    if (!controlPanel.contains(e.target)) {
      searchResults.style.display = 'none';
      selectedResultIndex = -1;
    }
  });

  // 更新選中的結果項
  function updateSelectedResult(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}

// 在 init 函數中調用
// 需要在 DOMContentLoaded 後執行
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    setupSearchInput();
    setupMobileSearchInput();
  });
} else {
  setupSearchInput();
  setupMobileSearchInput();
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
