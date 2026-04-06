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
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

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

  let lastError = null;
  const requestBody = new URLSearchParams({ data: query }).toString();

  for (const endpoint of OVERPASS_ENDPOINTS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000);

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          body: requestBody,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const error = new Error(`HTTP ${response.status}`);
          error.status = response.status;
          error.endpoint = endpoint;
          lastError = error;
          showStatus(`查詢 ${endpoint.replace(/^https?:\/\//, '')} 失敗，正在重試`, 'loading');
          if ([429, 502, 503, 504].includes(response.status)) {
            await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
            continue;
          }
          throw error;
        }

        const data = await response.json();
        if (useCache) {
          overpassCache.set(cacheKey, { data, time: Date.now() });
        }
        return data;
      } catch (error) {
        clearTimeout(timeoutId);
        lastError = error;
        const retriable = error?.name === 'AbortError' || [429, 502, 503, 504].includes(error?.status);
        if (retriable) {
          showStatus(`查詢逾時或服務忙碌，正在切換備援節點`, 'loading');
        }
        if (!retriable || attempt === 1) break;
        await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }

  if (lastError?.endpoint) {
    throw new Error(`${lastError.message} (${lastError.endpoint})`);
  }
  if (lastError?.name === 'AbortError') {
    throw new Error('查詢逾時');
  }
  if (lastError) throw lastError;
  throw new Error('Overpass 查詢失敗');
}

function getCurrentSearchContext(map) {
  let center = null;
  let radius = 50;
  const urlParams = new URLSearchParams(window.location.search);
  const urlRadius = parseFloat(urlParams.get('radius'));

  const shapeType = urlParams.get('shape');
  if (shapeType) {
    center = calculateShapeCenter(urlParams);
    radius = !isNaN(urlRadius) ? urlRadius : 50;
  }

  if (!center) {
    const lat = parseFloat(urlParams.get('lat'));
    const lng = parseFloat(urlParams.get('lng'));
    if (!isNaN(lat) && !isNaN(lng)) {
      center = { lat, lng };
      if (!isNaN(urlRadius)) radius = urlRadius;
    }
  }

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

  if (!center) {
    const mapCenter = map.getCenter();
    center = { lat: mapCenter.lat, lng: mapCenter.lng };
  }

  return { center, radius };
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

  return `<div class="osm-popup" style="min-width:250px"><h3 style="margin:0 0 10px 0;color:${def.color};font-size:16px;display:flex;align-items:center"><i class="bi ${iconClass}" style="font-size:20px;margin-right:6px;"></i>${displayName}</h3><div style="margin:10px 0;font-size:13px">${props.name ? `<div><strong>名稱:</strong> ${displayName}</div>` : ''}${displayOperator ? `<div><strong>運營者:</strong> ${displayOperator}</div>` : ''}</div><div style="margin:10px 0;padding-top:10px;border-top:1px solid #ddd;font-size:12px;color:#666"><div><strong>來源:</strong> OpenStreetMap</div><div><strong>ID:</strong> ${props.osmType}/${props.osmId}</div></div>${lat && lon ? `<div style="margin-top:12px;display:flex;gap:8px"><a href="https://www.google.com/maps?q=${lat},${lon}" target="_blank" style="flex:1;padding:8px;background:#4285f4;color:white;text-decoration:none;border-radius:4px;text-align:center;font-size:12px">Google Maps</a><a href="https://www.openstreetmap.org/${props.osmType}/${props.osmId}" target="_blank" style="flex:1;padding:8px;background:#7ebc6f;color:white;text-decoration:none;border-radius:4px;text-align:center;font-size:12px">OSM</a></div>` : ''}${noteButtonHtml ? `<div class="popup-actions">${noteButtonHtml}</div>` : ''}</div>`;
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

  const averagePoints = (points) => {
    const validPoints = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lng));
    if (validPoints.length === 0) return null;
    return {
      lat: validPoints.reduce((sum, p) => sum + p.lat, 0) / validPoints.length,
      lng: validPoints.reduce((sum, p) => sum + p.lng, 0) / validPoints.length
    };
  };

  const parsePointList = (value) => {
    return (value || '').split(';').map(p => {
      const [lng, lat] = p.split(',').map(Number);
      return { lat, lng };
    }).filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  };

  if (shapeType === 'circle') {
    const lat = parseFloat(urlParams.get('lat'));
    const lng = parseFloat(urlParams.get('lng'));
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  } else if (shapeType === 'line') {
    return averagePoints(parsePointList(urlParams.get('line')));
  } else if (shapeType === 'polygon') {
    return averagePoints(parsePointList(urlParams.get('poly') || urlParams.get('polygon')));
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
    if (window.shapeUtils && typeof window.shapeUtils.parseShapeParams === 'function') {
      const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);
      const centers = [];
      (shapeSpec.shapes || []).forEach(shape => {
        if (shape.center && Number.isFinite(shape.center.lat) && Number.isFinite(shape.center.lng)) {
          centers.push(shape.center);
          return;
        }
        if (Array.isArray(shape.coords)) {
          centers.push(...shape.coords);
          return;
        }
        if (shape.bounds) {
          centers.push({
            lat: (shape.bounds.south + shape.bounds.north) / 2,
            lng: (shape.bounds.west + shape.bounds.east) / 2
          });
        }
      });
      const averaged = averagePoints(centers);
      if (averaged) return averaged;
    }

    const allPolyPoints = urlParams.getAll('poly').flatMap(raw => {
      const [value] = String(raw || '').split('|');
      return parsePointList(value);
    });
    const averagedPolys = averagePoints(allPolyPoints);
    if (averagedPolys) return averagedPolys;

    const circleStr = urlParams.get('circle');
    if (circleStr) {
      const [lng, lat] = circleStr.split(',').map(Number);
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat, lng };
      }
    }

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
    const { center, radius } = getCurrentSearchContext(map);
    const bounds = calculateBounds(center, radius);
    const query = buildOverpassQuery(type, bounds);
    const data = await queryOverpass(query);
    const geoJSON = toGeoJSON(data, type);
    renderLayer(type, geoJSON, map);
    layers.visibility[type] = true;
    layers.groups[type].addTo(map);
    return geoJSON;
  } catch (error) {
    console.error('[OSM] 載入失敗:', type, error);
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

function syncFacilitiesToUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  if (selectedFacilities.size > 0) {
    urlParams.set('osm', Array.from(selectedFacilities).join(','));
  } else {
    urlParams.delete('osm');
  }
  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
  window.history.pushState({}, '', newUrl);
}

function setFacilityVisualState(type, state = 'idle', detail = '') {
  const checkbox = document.querySelector(`#osmDropdownMenu input[value="${type}"]`);
  const option = checkbox?.closest('.dropdown-option');
  if (!checkbox || !option) return;

  option.classList.remove('is-loading', 'is-success', 'is-error');
  delete option.dataset.state;
  delete option.dataset.detail;

  if (state !== 'idle') {
    option.classList.add(`is-${state}`);
    option.dataset.state = state;
    if (detail) option.dataset.detail = detail;
  }
}

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
    setFacilityVisualState(type, 'loading', '正在查詢');
    const loadingNotice = showStatus(`正在查詢 ${FACILITY_TYPES[type].name}`, 'loading');
    
    try {
      const data = await loadLayer(type, map);
      setFacilityVisualState(type, 'success', data?.features?.length > 0 ? `已載入 ${data.features.length} 筆` : '查無資料');
      setTimeout(() => setFacilityVisualState(type, checkbox.checked ? 'idle' : 'idle'), 1600);
      
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
      checkbox.checked = false;
      selectedFacilities.delete(type);
      setFacilityVisualState(type, 'error', '查詢失敗');
      
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
    setFacilityVisualState(type, 'idle');
  }

  syncFacilitiesToUrl();
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
  Object.keys(FACILITY_TYPES).forEach(type => setFacilityVisualState(type, 'idle'));
  syncFacilitiesToUrl();
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
  notice.classList.toggle('osm-notice-loading', type === 'loading');
  notice.textContent = msg;
  
  // 根據類型設定顏色
  if (type === 'loading') {
    notice.style.background = 'rgba(255, 255, 255, 0.96)';
    notice.style.color = '#111827';
    notice.style.borderColor = '#cbd5e1';
  } else if (type === 'error') {
    notice.style.background = 'rgba(255, 255, 255, 0.96)';
    notice.style.color = '#991b1b';
    notice.style.borderColor = '#fecaca';
  } else if (type === 'warning') {
    notice.style.background = 'rgba(255, 255, 255, 0.96)';
    notice.style.color = '#92400e';
    notice.style.borderColor = '#fcd34d';
  } else {
    notice.style.background = 'rgba(255, 255, 255, 0.96)';
    notice.style.color = '#065f46';
    notice.style.borderColor = '#a7f3d0';
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

      const urlParams = new URLSearchParams(window.location.search);
      const initialFacilities = (urlParams.get('osm') || '')
        .split(',')
        .map(v => v.trim())
        .filter(v => FACILITY_TYPES[v]);

      initialFacilities.forEach(type => {
        selectedFacilities.add(type);
        const checkbox = document.querySelector(`#osmDropdownMenu input[value="${type}"]`);
        if (checkbox && !checkbox.checked) {
          checkbox.checked = true;
          handleFacilityChange(checkbox);
        }
      });

      updateCount();
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
