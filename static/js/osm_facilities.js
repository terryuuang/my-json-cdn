/**
 * OSM 公共設施圖層整合模組
 * 整合 Overpass API 查詢、圖層管理、UI 控制
 */

// ============================================
// 設施類型定義
// ============================================

const FACILITY_TYPES = {
  surveillance: {
    name: '監視設備',
    color: '#ff4444',
    tags: [{ key: 'man_made', value: 'surveillance' }],
    elements: ['node', 'way']
  },
  school: {
    name: '學校',
    color: '#22aa44',
    tags: [{ key: 'amenity', value: 'school' }],
    elements: ['node', 'way', 'relation']
  },
  university: {
    name: '大學',
    color: '#0066cc',
    tags: [{ key: 'amenity', value: 'university' }],
    elements: ['node', 'way', 'relation']
  },
  college: {
    name: '學院',
    color: '#0088ee',
    tags: [{ key: 'amenity', value: 'college' }],
    elements: ['node', 'way', 'relation']
  },
  hospital: {
    name: '醫療設施',
    color: '#ff0000',
    tags: [{ key: 'amenity', value: 'hospital' }],
    elements: ['node', 'way', 'relation']
  },
  stadium: {
    name: '體育場',
    color: '#44aa44',
    tags: [{ key: 'leisure', value: 'stadium' }],
    elements: ['node', 'way', 'relation']
  },
  sports_centre: {
    name: '運動中心',
    color: '#55bb55',
    tags: [{ key: 'leisure', value: 'sports_centre' }],
    elements: ['node', 'way', 'relation']
  },
  parking: {
    name: '停車場',
    color: '#888888',
    tags: [{ key: 'amenity', value: 'parking' }],
    elements: ['node', 'way', 'relation']
  },
  fuel: {
    name: '加油站',
    color: '#4444ff',
    tags: [{ key: 'amenity', value: 'fuel' }],
    elements: ['node', 'way']
  },
  helipad: {
    name: '直升機停機坪',
    color: '#00ddff',
    tags: [{ key: 'aeroway', value: 'helipad' }],
    elements: ['node', 'way']
  },
  airport: {
    name: '機場',
    color: '#00aaff',
    tags: [{ key: 'aeroway', value: 'aerodrome' }],
    elements: ['node', 'way', 'relation']
  },
  tower: {
    name: '高塔',
    color: '#aa5500',
    tags: [{ key: 'man_made', value: 'tower' }],
    elements: ['node']
  },
  water_tower: {
    name: '水塔',
    color: '#0088cc',
    tags: [{ key: 'man_made', value: 'water_tower' }],
    elements: ['node', 'way']
  },
  bridge: {
    name: '橋樑',
    color: '#666666',
    tags: [{ key: 'man_made', value: 'bridge' }],
    elements: ['way', 'relation']
  },
  power_station: {
    name: '發電廠',
    color: '#ffaa00',
    tags: [{ key: 'power', value: 'plant' }],
    elements: ['node', 'way', 'relation']
  }
};

// Bootstrap Icons 類名映射
const ICON_CLASSES = {
  surveillance: 'bi-camera-video-fill',
  school: 'bi-backpack-fill',
  university: 'bi-mortarboard-fill',
  college: 'bi-bank2',
  hospital: 'bi-hospital-fill',
  stadium: 'bi-award-fill',
  sports_centre: 'bi-trophy-fill',
  parking: 'bi-p-square-fill',
  fuel: 'bi-fuel-pump-fill',
  helipad: 'bi-hurricane',
  airport: 'bi-airplane-fill',
  tower: 'bi-broadcast-pin',
  water_tower: 'bi-droplet-fill',
  bridge: 'bi-signpost-split-fill',
  power_station: 'bi-lightning-charge-fill'
};

// ============================================
// Overpass API 查詢
// ============================================

const overpassCache = new Map();
const CACHE_TIME = 30 * 60 * 1000; // 30 分鐘

function buildOverpassQuery(facilityType, bounds) {
  const def = FACILITY_TYPES[facilityType];
  const bbox = {
    south: bounds.getSouth ? bounds.getSouth() : bounds.south,
    west: bounds.getWest ? bounds.getWest() : bounds.west,
    north: bounds.getNorth ? bounds.getNorth() : bounds.north,
    east: bounds.getEast ? bounds.getEast() : bounds.east
  };

  const parts = [];
  def.elements.forEach(el => {
    def.tags.forEach(tag => {
      const filter = tag.value ? `["${tag.key}"="${tag.value}"]` : `["${tag.key}"]`;
      parts.push(`  ${el}${filter}(${bbox.south},${bbox.west},${bbox.north},${bbox.east});`);
    });
  });

  return `[out:json][timeout:25];(${parts.join('\n')});out body;>;out skel qt;`;
}

async function queryOverpass(query, useCache = true) {
  const cacheKey = query;
  if (useCache && overpassCache.has(cacheKey)) {
    const cached = overpassCache.get(cacheKey);
    if (Date.now() - cached.time < CACHE_TIME) {
      return cached.data;
    }
    overpassCache.delete(cacheKey);
  }

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: query,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const data = await response.json();
  if (useCache) {
    overpassCache.set(cacheKey, { data, time: Date.now() });
  }
  
  return data;
}

function toGeoJSON(overpassData, facilityType) {
  if (!overpassData?.elements) return { type: 'FeatureCollection', features: [] };

  const nodeMap = new Map();
  overpassData.elements.forEach(el => {
    if (el.type === 'node') nodeMap.set(el.id, el);
  });

  const features = [];
  overpassData.elements.forEach(el => {
    if (el.type === 'node' && !el.tags) return;

    let geometry = null;
    if (el.type === 'node' && el.lat && el.lon) {
      geometry = { type: 'Point', coordinates: [el.lon, el.lat] };
    } else if (el.type === 'way' && el.nodes?.length >= 2) {
      const coords = el.nodes.map(id => {
        const n = nodeMap.get(id);
        return n ? [n.lon, n.lat] : null;
      }).filter(c => c);
      
      if (coords.length >= 2) {
        const isClosed = el.nodes[0] === el.nodes[el.nodes.length - 1];
        geometry = isClosed && coords.length >= 4 
          ? { type: 'Polygon', coordinates: [coords] }
          : { type: 'LineString', coordinates: coords };
      }
    } else if (el.type === 'relation' && el.center) {
      geometry = { type: 'Point', coordinates: [el.center.lon, el.center.lat] };
    }

    if (geometry) {
      features.push({
        type: 'Feature',
        geometry,
        properties: { ...el.tags, osmId: el.id, osmType: el.type, facilityType }
      });
    }
  });

  return { type: 'FeatureCollection', features };
}

// ============================================
// 圖層管理
// ============================================

const layers = {
  groups: {},
  data: {},
  visibility: {},
  activeQueries: new Set()
};

function initLayers(map) {
  Object.keys(FACILITY_TYPES).forEach(type => {
    layers.groups[type] = L.layerGroup();
    layers.visibility[type] = false;
    layers.data[type] = null;
  });
}

// 建立標記圖示
function createMarker(type, props) {
  const def = FACILITY_TYPES[type];
  const iconClass = ICON_CLASSES[type] || 'bi-geo-fill';
  const label = props.name || '';
  
  return L.divIcon({
    html: `<div style="position:relative"><div style="background:${def.color};width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 2px 4px rgba(0,0,0,0.3)"><i class="bi ${iconClass}" style="font-size:13px;color:white;"></i></div>${label ? `<div style="position:absolute;top:32px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.75);color:white;padding:2px 6px;border-radius:3px;font-size:10px;white-space:nowrap;max-width:100px;overflow:hidden;text-overflow:ellipsis">${label}</div>` : ''}</div>`,
    className: 'osm-marker',
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14]
  });
}

// 建立彈出視窗內容
function createPopup(feature, type) {
  const def = FACILITY_TYPES[type];
  const props = feature.properties;
  const iconClass = ICON_CLASSES[type] || 'bi-geo-fill';

  // 使用 OpenCC 轉換簡體為繁體
  const toTraditional = (text) => {
    if (!text) return text;
    if (window.searchUtils && window.searchUtils.simplified2Traditional) {
      return window.searchUtils.simplified2Traditional(text);
    }
    return text;
  };

  // 轉換設施名稱和運營者為繁體中文
  const displayName = toTraditional(props.name || def.name);
  const displayOperator = props.operator ? toTraditional(props.operator) : null;

  let coord = null;
  if (feature.geometry.type === 'Point') coord = feature.geometry.coordinates;
  else if (feature.geometry.type === 'Polygon') coord = feature.geometry.coordinates[0][0];
  else if (feature.geometry.type === 'LineString') coord = feature.geometry.coordinates[0];

  const lat = coord ? coord[1] : null;
  const lon = coord ? coord[0] : null;

  // 建立筆記按鈕 HTML
  let noteButtonHtml = '';
  if (lat && lon && window.Notes && typeof window.Notes.getNoteButtonHtml === 'function') {
    const featureId = `osm_${props.osmType}_${props.osmId}`;
    noteButtonHtml = window.Notes.getNoteButtonHtml({
      type: 'osm',
      featureId: featureId,
      featureName: displayName,
      layerName: def.name,
      lat: lat,
      lng: lon
    });
  }

  return `<div style="min-width:250px"><h3 style="margin:0 0 10px 0;color:${def.color};font-size:16px;display:flex;align-items:center"><i class="bi ${iconClass}" style="font-size:20px;margin-right:6px;"></i>${displayName}</h3><div style="margin:10px 0;font-size:13px">${props.name ? `<div><strong>名稱:</strong> ${displayName}</div>` : ''}${displayOperator ? `<div><strong>運營者:</strong> ${displayOperator}</div>` : ''}</div><div style="margin:10px 0;padding-top:10px;border-top:1px solid #ddd;font-size:12px;color:#666"><div><strong>來源:</strong> OpenStreetMap</div><div><strong>ID:</strong> ${props.osmType}/${props.osmId}</div></div>${lat && lon ? `<div style="margin-top:12px;display:flex;gap:8px"><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" style="flex:1;padding:8px;background:#4285f4;color:white;text-decoration:none;border-radius:4px;text-align:center;font-size:12px">Google Maps</a><a href="https://www.openstreetmap.org/${props.osmType}/${props.osmId}" target="_blank" style="flex:1;padding:8px;background:#7ebc6f;color:white;text-decoration:none;border-radius:4px;text-align:center;font-size:12px">OSM</a></div>` : ''}${noteButtonHtml}</div>`;
}

// 渲染圖層到地圖
function renderLayer(type, geoJSON, map) {
  const group = layers.groups[type];
  
  // 如果已經渲染過且資料相同，直接返回
  if (group.getLayers().length > 0 && layers.data[type] === geoJSON) {
    return;
  }
  
  group.clearLayers();
  
  if (!geoJSON?.features?.length) return;
  
  layers.data[type] = geoJSON;
  const def = FACILITY_TYPES[type];
  
  geoJSON.features.forEach(f => {
    if (f.geometry.type === 'Point') {
      const [lon, lat] = f.geometry.coordinates;
      const marker = L.marker([lat, lon], { icon: createMarker(type, f.properties) });
      marker.bindPopup(createPopup(f, type), { maxWidth: 350 });
      group.addLayer(marker);
    } else if (f.geometry.type === 'LineString') {
      const coords = f.geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      const line = L.polyline(coords, { color: def.color, weight: 3, opacity: 0.7 });
      line.bindPopup(createPopup(f, type), { maxWidth: 350 });
      group.addLayer(line);
    } else if (f.geometry.type === 'Polygon') {
      const coords = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon]);
      const poly = L.polygon(coords, { color: def.color, weight: 2, fillColor: def.color, fillOpacity: 0.2 });
      poly.bindPopup(createPopup(f, type), { maxWidth: 350 });
      group.addLayer(poly);
    }
  });
  
  if (layers.visibility[type]) group.addTo(map);
}

// 計算基於中心點和半徑的邊界框
function calculateBounds(center, radiusKm) {
  // 1 度緯度約 111km
  const latDelta = radiusKm / 111;
  // 經度需要考慮緯度的 cosine 修正
  const lngDelta = radiusKm / (111 * Math.cos(center.lat * Math.PI / 180));

  return {
    south: center.lat - latDelta,
    north: center.lat + latDelta,
    west: center.lng - lngDelta,
    east: center.lng + lngDelta
  };
}

// 計算 SHAPE 的中心點
function calculateShapeCenter(urlParams) {
  const shapeType = urlParams.get('shape');

  if (shapeType === 'circle') {
    const lat = parseFloat(urlParams.get('lat'));
    const lng = parseFloat(urlParams.get('lng'));
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  } else if (shapeType === 'line') {
    const line = urlParams.get('line');
    if (line) {
      const points = line.split(';').map(p => {
        const [lng, lat] = p.split(',').map(Number);
        return { lat, lng };
      }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

      if (points.length > 0) {
        const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
        const avgLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
        return { lat: avgLat, lng: avgLng };
      }
    }
  } else if (shapeType === 'polygon') {
    const polygon = urlParams.get('polygon');
    if (polygon) {
      const points = polygon.split(';').map(p => {
        const [lng, lat] = p.split(',').map(Number);
        return { lat, lng };
      }).filter(p => !isNaN(p.lat) && !isNaN(p.lng));

      if (points.length > 0) {
        const avgLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
        const avgLng = points.reduce((sum, p) => sum + p.lng, 0) / points.length;
        return { lat: avgLat, lng: avgLng };
      }
    }
  } else if (shapeType === 'sector') {
    const sectorStr = urlParams.get('sector');
    if (sectorStr) {
      const [lng, lat] = sectorStr.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  } else if (shapeType === 'bbox') {
    const bbox = urlParams.get('bbox');
    if (bbox) {
      const [w, s, e, n] = bbox.split(',').map(Number);
      if (!isNaN(w) && !isNaN(s) && !isNaN(e) && !isNaN(n)) {
        return { lat: (s + n) / 2, lng: (w + e) / 2 };
      }
    }
  } else if (shapeType === 'multi') {
    // 對於 multi 模式，優先使用 circle 的中心
    const circleStr = urlParams.get('circle');
    if (circleStr) {
      const [lng, lat] = circleStr.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
    // 其次使用 sector 的中心
    const sectorStr = urlParams.get('sector');
    if (sectorStr) {
      const [lng, lat] = sectorStr.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }
  }

  return null;
}

// 載入並顯示圖層
async function loadLayer(type, map) {
  if (layers.activeQueries.has(type)) return null;
  layers.activeQueries.add(type);

  try {
    // 嘗試從 URL 或輸入框獲取搜尋中心和半徑
    let center = null;
    let radius = 50; // 預設 50KM

    const urlParams = new URLSearchParams(window.location.search);
    const urlRadius = parseFloat(urlParams.get('radius'));

    // 1. 檢查是否為 SHAPE 模式
    const shapeType = urlParams.get('shape');
    if (shapeType) {
      center = calculateShapeCenter(urlParams);
      // SHAPE 模式預設使用 50KM，除非 URL 有指定 radius
      radius = !isNaN(urlRadius) ? urlRadius : 50;
    }

    // 2. 如果不是 SHAPE 模式或無法計算 SHAPE 中心，嘗試從 lat/lng 參數獲取
    if (!center) {
      const lat = parseFloat(urlParams.get('lat'));
      const lng = parseFloat(urlParams.get('lng'));

      if (!isNaN(lat) && !isNaN(lng)) {
        center = { lat, lng };
        if (!isNaN(urlRadius)) radius = urlRadius;
      }
    }

    // 3. 從輸入框獲取
    if (!center) {
      const latInput = document.getElementById('latInput');
      const lngInput = document.getElementById('lngInput');
      const radiusInput = document.getElementById('radiusInput');

      const inputLat = parseFloat(latInput?.value);
      const inputLng = parseFloat(lngInput?.value);
      const inputRadius = parseFloat(radiusInput?.value);

      if (!isNaN(inputLat) && !isNaN(inputLng)) {
        center = { lat: inputLat, lng: inputLng };
        if (!isNaN(inputRadius)) radius = inputRadius;
      }
    }

    // 4. 使用地圖中心作為後備
    if (!center) {
      const mapCenter = map.getCenter();
      center = { lat: mapCenter.lat, lng: mapCenter.lng };
    }

    console.log(`[OSM] 載入 ${FACILITY_TYPES[type].name}，中心: (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)})，半徑: ${radius}km`);

    const bounds = calculateBounds(center, radius);
    const query = buildOverpassQuery(type, bounds);
    const data = await queryOverpass(query);
    const geoJSON = toGeoJSON(data, type);
    renderLayer(type, geoJSON, map);
    layers.visibility[type] = true;
    layers.groups[type].addTo(map);
    return geoJSON;
  } catch (error) {
    console.error(`載入 ${type} 失敗:`, error);
    throw error;
  } finally {
    layers.activeQueries.delete(type);
  }
}

function toggleLayer(type, map, visible) {
  const group = layers.groups[type];
  if (!group) return;
  
  layers.visibility[type] = visible;
  if (visible) {
    group.addTo(map);
  } else {
    try { map.removeLayer(group); } catch (e) {}
  }
}

function clearAll(map) {
  Object.entries(layers.groups).forEach(([type, group]) => {
    group.clearLayers();
    try { map.removeLayer(group); } catch (e) {}
    layers.visibility[type] = false;
  });
  layers.data = {};
}

// ============================================
// UI 控制
// ============================================

let selectedFacilities = new Set();

// toggleDropdown function is now provided by unified_dropdown.js

async function handleFacilityChange(checkbox) {
  const type = checkbox.value;
  const map = window.map;
  
  if (!map) {
    showStatus('地圖尚未載入', 'error');
    checkbox.checked = false;
    return;
  }
  
  if (checkbox.checked) {
    selectedFacilities.add(type);
    const label = checkbox.closest('label');
    if (label) label.style.opacity = '0.6';
    
    const loadingNotice = showStatus(`載入 ${FACILITY_TYPES[type].name}...`, 'loading');
    
    try {
      const data = await loadLayer(type, map);
      if (label) label.style.opacity = '1';
      
      // 移除 loading 提示
      if (loadingNotice) {
        loadingNotice.classList.remove('show');
        loadingNotice.classList.add('hide');
        setTimeout(() => loadingNotice.remove(), 400);
      }
      
      if (data?.features?.length > 0) {
        showStatus(`已載入 ${data.features.length} 個 ${FACILITY_TYPES[type].name}`, 'success');
      } else {
        showStatus(`公開資料中當前範圍內查無 ${FACILITY_TYPES[type].name}`, 'warning');
      }
    } catch (error) {
      if (label) label.style.opacity = '1';
      checkbox.checked = false;
      selectedFacilities.delete(type);
      
      // 移除 loading 提示
      if (loadingNotice) {
        loadingNotice.classList.remove('show');
        loadingNotice.classList.add('hide');
        setTimeout(() => loadingNotice.remove(), 400);
      }
      
      showStatus(`載入失敗: ${error.message}`, 'error');
    }
  } else {
    selectedFacilities.delete(type);
    toggleLayer(type, map, false);
  }
  
  updateCount();
}

function updateCount() {
  const el = document.getElementById('osmSelectedCount');
  if (!el) return;
  
  const count = selectedFacilities.size;
  if (count === 0) {
    el.textContent = '選擇設施類型';
  } else if (count === 1) {
    const type = Array.from(selectedFacilities)[0];
    el.textContent = FACILITY_TYPES[type].name;
  } else {
    el.textContent = `已選擇 ${count} 項`;
  }
}

function clearSelections() {
  document.querySelectorAll('.osm-facility-option input').forEach(cb => cb.checked = false);
  if (window.map) clearAll(window.map);
  selectedFacilities.clear();
  updateCount();
  showStatus('已清除所有圖層', 'success');
}

// 顯示狀態訊息（使用 topNotice 樣式）
function showStatus(msg, type = 'success') {
  const existingNotice = document.querySelector('.osm-notice');
  if (existingNotice) {
    existingNotice.remove();
  }
  
  const notice = document.createElement('div');
  notice.className = 'osm-notice';
  notice.textContent = msg;
  
  // 根據類型設定顏色
  if (type === 'loading') {
    notice.style.background = 'rgba(59, 130, 246, 0.95)';
  } else if (type === 'error') {
    notice.style.background = 'rgba(239, 68, 68, 0.95)';
  } else if (type === 'warning') {
    notice.style.background = 'rgba(245, 158, 11, 0.95)'; // 橙色警告
  } else {
    notice.style.background = 'rgba(34, 197, 94, 0.95)';
  }
  
  document.body.appendChild(notice);
  
  // 觸發動畫
  setTimeout(() => notice.classList.add('show'), 10);
  
  // 自動隱藏（除非是 loading 狀態）
  if (type !== 'loading') {
    setTimeout(() => {
      notice.classList.remove('show');
      notice.classList.add('hide');
      setTimeout(() => notice.remove(), 400);
    }, 3000);
  }
  
  return notice;
}

// ============================================
// 初始化
// ============================================

function initOSM() {
  // 等待地圖載入
  const check = setInterval(() => {
    if (window.map && typeof window.map.getBounds === 'function') {
      clearInterval(check);
      initLayers(window.map);
      console.log('✅ OSM 功能已啟用');
    }
  }, 200);
  
  setTimeout(() => clearInterval(check), 10000);
}

// DOM 載入後初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initOSM);
} else {
  initOSM();
}

// 匯出全域函數
// window.toggleOSMDropdown is now provided by unified_dropdown.js
window.handleOSMFacilityChange = handleFacilityChange;
window.clearAllOSMSelections = clearSelections;
window.OSM_FACILITY_TYPES = FACILITY_TYPES;


