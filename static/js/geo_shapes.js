// ==========================================================
// geo_shapes.js - 幾何/距離計算工具、shape 模式渲染、KML 匯出
// ==========================================================



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

// 計算多邊形近似面積（km²），使用 Shoelace + 球面近似
function calcPolygonAreaKm2(latlngs) {
  // latlngs: [[lat,lng], ...]
  const n = latlngs.length;
  if (n < 3) return 0;
  const R = 6371; // km
  const toRad = d => d * Math.PI / 180;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const lat1 = toRad(latlngs[i][0]), lat2 = toRad(latlngs[j][0]);
    const lng1 = toRad(latlngs[i][1]), lng2 = toRad(latlngs[j][1]);
    area += (lng2 - lng1) * (2 + Math.sin(lat1) + Math.sin(lat2));
  }
  return Math.abs(area * R * R / 2);
}

// 格式化面積顯示
function fmtArea(km2) {
  if (km2 >= 1) return `${km2.toFixed(2)} km²`;
  return `${(km2 * 1e6).toFixed(0)} m²`;
}

// 格式化距離（km + nm）
function fmtDist(km) {
  const nm = km / 1.852;
  const kmStr = km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
  const nmStr = `${nm.toFixed(2)} nm`;
  return `${kmStr}（${nmStr}）`;
}

// 建立 hover tooltip 內容（每種形狀）
function buildShapeTooltip(type, s, extraKm) {
  const rows = []; // [label, value] pairs
  const PI = Math.PI;
  if (type === 'circle') {
    const r = s.radiusKm;
    const area = PI * r * r;
    const circ = 2 * PI * r;
    rows.push(['圓形', '']);
    rows.push(['半徑', fmtDist(r)]);
    rows.push(['周長', fmtDist(circ)]);
    rows.push(['面積', fmtArea(area)]);
  } else if (type === 'sector') {
    const r = s.radiusKm;
    const cw = (b, e) => ((e - b + 360) % 360) || 360;
    const angleDeg = cw(s.startDeg, s.endDeg);
    const arcLen = 2 * PI * r * (angleDeg / 360);
    const area = (angleDeg / 360) * PI * r * r;
    rows.push(['扇形', '']);
    rows.push(['半徑', fmtDist(r)]);
    rows.push(['張角', `${angleDeg.toFixed(1)}°（${s.startDeg}° → ${s.endDeg}°）`]);
    rows.push(['弧長', fmtDist(arcLen)]);
    rows.push(['面積', fmtArea(area)]);
  } else if (type === 'line') {
    const km = extraKm || 0;
    rows.push(['線段', '']);
    rows.push(['長度', fmtDist(km)]);
    rows.push(['段數', `${(s.coords || []).length - 1} 段`]);
  } else if (type === 'polygon') {
    const latlngs = s.coords.map(p => [p.lat, p.lng]);
    const area = calcPolygonAreaKm2(latlngs);
    let perim = 0;
    for (let i = 0; i < latlngs.length; i++) {
      const j = (i + 1) % latlngs.length;
      perim += calculateDistance(latlngs[i][0], latlngs[i][1], latlngs[j][0], latlngs[j][1]);
    }
    rows.push(['多邊形', '']);
    rows.push(['頂點', `${s.coords.length} 個`]);
    rows.push(['周長', fmtDist(perim)]);
    rows.push(['面積', fmtArea(area)]);
  } else if (type === 'bbox') {
    const { west, south, east, north } = s.bounds;
    const wKm = calculateDistance(south, west, south, east);
    const hKm = calculateDistance(south, west, north, west);
    const area = calcPolygonAreaKm2([
      [south, west], [south, east], [north, east], [north, west]
    ]);
    rows.push(['矩形', '']);
    rows.push(['寬', fmtDist(wKm)]);
    rows.push(['高', fmtDist(hKm)]);
    rows.push(['周長', fmtDist(2 * (wKm + hKm))]);
    rows.push(['面積', fmtArea(area)]);
  } else if (type === 'point') {
    rows.push(['標記點', '']);
    rows.push(['座標', `${s.center.lat.toFixed(5)}°N`]);
    rows.push(['', `${s.center.lng.toFixed(5)}°E`]);
    if (Number.isFinite(s.radiusKm) && s.radiusKm > 0) {
      rows.push(['半徑', fmtDist(s.radiusKm)]);
    }
  }
  const cells = rows.map(([label, val]) => {
    if (!label && !val) return '';
    if (!val) return `<tr><td colspan="2" style="font-weight:600;padding-bottom:2px">${label}</td></tr>`;
    if (!label) return `<tr><td></td><td style="color:#94a3b8">${val}</td></tr>`;
    return `<tr><td style="color:#94a3b8;padding-right:8px;white-space:nowrap">${label}</td><td style="white-space:nowrap">${val}</td></tr>`;
  }).join('');
  return `<table style="font-size:12px;line-height:1.7;border-collapse:collapse">${cells}</table>`;
}

// 建立單條邊的透明互動線段，hover 時顯示該邊長度
function makeEdgeLine(latA, lngA, latB, lngB) {
  const distKm = calculateDistance(latA, lngA, latB, lngB);
  const ttContent = `<table style="font-size:12px;line-height:1.7;border-collapse:collapse">` +
    `<tr><td style="font-weight:600">邊長</td></tr>` +
    `<tr><td style="white-space:nowrap">${fmtDist(distKm)}</td></tr></table>`;
  return L.polyline([[latA, lngA], [latB, lngB]], {
    color: '#ef4444', opacity: 0.001, weight: 14, interactive: true
  }).bindTooltip(ttContent, { sticky: true, direction: 'top', className: 'shape-hover-tooltip' });
}

// 為閉合多邊形的每條邊加透明互動層（latlngs: [[lat,lng],...]，自動首尾相連）
function addPolygonEdgeLines(latlngs, layerGroup) {
  const n = latlngs.length;
  for (let i = 0; i < n; i++) {
    const a = latlngs[i];
    const b = latlngs[(i + 1) % n];
    layerGroup.addLayer(makeEdgeLine(a[0], a[1], b[0], b[1]));
  }
}

// 為折線的每段加透明互動層（open polyline）
function addPolylineEdgeLines(latlngs, layerGroup) {
  for (let i = 0; i < latlngs.length - 1; i++) {
    const a = latlngs[i];
    const b = latlngs[i + 1];
    layerGroup.addLayer(makeEdgeLine(a[0], a[1], b[0], b[1]));
  }
}

// 為扇形加透明互動層：兩條直邊 + 整段弧（hover 弧顯示弧長）
function addSectorEdgeLines(latlngs, radiusKm, angleDeg, layerGroup) {
  // latlngs[0] = center, latlngs[1..N] = arc points
  const center = latlngs[0];
  const arcPts = latlngs.slice(1);
  if (arcPts.length === 0) return;

  // 直邊 1：center → 弧起點
  layerGroup.addLayer(makeEdgeLine(center[0], center[1], arcPts[0][0], arcPts[0][1]));
  // 直邊 2：弧終點 → center
  layerGroup.addLayer(makeEdgeLine(arcPts[arcPts.length - 1][0], arcPts[arcPts.length - 1][1], center[0], center[1]));

  // 弧（整段，顯示弧長）
  const PI = Math.PI;
  const arcLen = 2 * PI * radiusKm * (angleDeg / 360);
  const arcContent = `<table style="font-size:12px;line-height:1.7;border-collapse:collapse">` +
    `<tr><td style="font-weight:600">弧長</td></tr>` +
    `<tr><td style="white-space:nowrap">${fmtDist(arcLen)}</td></tr></table>`;
  L.polyline(arcPts, { color: '#ef4444', opacity: 0.001, weight: 14, interactive: true })
    .bindTooltip(arcContent, { sticky: true, direction: 'top', className: 'shape-hover-tooltip' })
    .addTo(layerGroup);
}

// 根據 shape 規格渲染禁航區與附近點位
function renderShapeMode(shapeSpec, selectedLayer = null, options = {}) {
  const {
    preserveMarkers = false,
    preserveCenterMarker = false,
    skipFeatureMarkers = false,
    skipFitBounds = false
  } = options;

  if (!preserveMarkers) currentMarkers.clearLayers();
  if (!preserveCenterMarker && centerMarker) { try { map.removeLayer(centerMarker); } catch (_) {} centerMarker = null; }
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

  const encodeDataAttr = (value) => encodeURIComponent(
    typeof value === 'string' ? value : JSON.stringify(value ?? null)
  );

  const buildShapeKmlButton = (shapeData) => {
    const dataAttrs = `
      data-shape-type="${shapeData.shapeType}"
      data-title="${encodeDataAttr(shapeData.title || '')}"
      data-description="${encodeDataAttr(shapeData.description || '')}"
      data-geometry="${encodeDataAttr(shapeData.geometry || null)}"
    `;
    return `<button class="link-btn shape-export-btn" onclick="exportShapeAsKml(this)" ${dataAttrs}>匯出成 KML</button>`;
  };

  const buildCopyUrlButton = () => {
    return `<button class="link-btn shape-copy-url-btn" onclick="copyCurrentUrl()">複製網址</button>`;
  };

  const multiShapeNoteConfig = (() => {
    if (shapeSpec.shape !== 'multi' || !Array.isArray(shapeSpec.shapes) || shapeSpec.shapes.length <= 1) {
      return null;
    }
    const groupItems = shapeSpec.shapes
      .map(shape => {
        const exportData = window.shapeUtils.shapeToExportData(shape, shapeSpec.text);
        if (!exportData || !exportData.geometry) return null;
        return {
          name: exportData.name,
          geometry: exportData.geometry
        };
      })
      .filter(Boolean);
    if (groupItems.length <= 1) return null;

    const groupText = window.shapeUtils.parseShapeDisplayText(shapeSpec.text || 'APEINTEL Shapes', '圖形');
    return {
      groupGeometry: {
        type: 'GeometryCollection',
        geometries: groupItems.map(item => item.geometry)
      },
      groupShapeCount: groupItems.length,
      groupTitle: groupText.title || shapeSpec.text || '整組圖形',
      groupItems
    };
  })();

  // 輔助函數：建立含筆記功能的 popup 內容（跟軍事設施彈窗樣式一致）
  // geometry 格式依類型：
  // - Point: { type: 'Point', coordinates: [lng, lat] }
  // - LineString: { type: 'LineString', coordinates: [[lng, lat], ...] }
  // - Polygon: { type: 'Polygon', coordinates: [[lng, lat], ...] }
  // - Circle: { type: 'Circle', center: [lng, lat], radiusKm: number }
  // - Sector: { type: 'Sector', center: [lng, lat], radiusKm: number, startDeg: number, endDeg: number }
  // - Rectangle: { type: 'Rectangle', bounds: { west, south, east, north } }
  const buildShapePopup = (type, text, center, shapeInfo = {}, geometry = null) => {
    const rawText = text || '區域標記';
    const shapeTypeLabels = { 'point': '標記點', 'circle': '圓形區域', 'line': '線段', 'polygon': '多邊形', 'bbox': '矩形區域', 'sector': '扇形區域' };
    const typeLabel = shapeTypeLabels[type] || '圖形';
    const parsedText = window.shapeUtils.parseShapeDisplayText(rawText, typeLabel);

    let popupHtml = `<div class="shape-popup-header">`;
    popupHtml += `<div class="shape-popup-kicker">${typeLabel}</div>`;
    popupHtml += `<h3 class="popup-title">${escapeHtml(parsedText.title)}</h3>`;
    if (parsedText.subtitle) {
      popupHtml += `<div class="shape-popup-subtitle">${escapeHtml(parsedText.subtitle)}</div>`;
    }
    popupHtml += `</div>`;
    if (parsedText.description) {
      popupHtml += `<div class="shape-popup-description">${escapeHtml(parsedText.description)}</div>`;
    }
    popupHtml += `<div class="popup-field"><strong>類型:</strong><span class="popup-field-value">${typeLabel}</span></div>`;
    
    // 添加形狀資訊
    if (shapeInfo.radius) popupHtml += `<div class="popup-field"><strong>半徑:</strong><span class="popup-field-value">${shapeInfo.radius}</span></div>`;
    if (shapeInfo.angle) popupHtml += `<div class="popup-field"><strong>張角:</strong><span class="popup-field-value">${shapeInfo.angle}</span></div>`;
    if (shapeInfo.area) popupHtml += `<div class="popup-field"><strong>面積:</strong><span class="popup-field-value">${shapeInfo.area}</span></div>`;
    if (shapeInfo.arcLength) popupHtml += `<div class="popup-field"><strong>弧長:</strong><span class="popup-field-value">${shapeInfo.arcLength}</span></div>`;
    if (shapeInfo.length) popupHtml += `<div class="popup-field"><strong>長度:</strong><span class="popup-field-value">${shapeInfo.length}</span></div>`;

    // AI 判斷折疊區塊（置於形狀資訊下方）
    if (parsedText.aiAnalysis) {
      popupHtml += `<details class="shape-ai-block"><summary class="shape-ai-summary">AI 判斷</summary><div class="shape-ai-content">${escapeHtml(parsedText.aiAnalysis)}</div></details>`;
    }

    const exportDescription = [
      parsedText.subtitle,
      parsedText.description,
      shapeInfo.radius ? `半徑: ${shapeInfo.radius}` : '',
      shapeInfo.angle ? `張角: ${shapeInfo.angle}` : '',
      shapeInfo.area ? `面積: ${shapeInfo.area}` : '',
      shapeInfo.arcLength ? `弧長: ${shapeInfo.arcLength}` : '',
      shapeInfo.length ? `長度: ${shapeInfo.length}` : '',
      parsedText.aiAnalysis ? `AI 判斷: ${parsedText.aiAnalysis}` : ''
    ].filter(Boolean).join('\n');

    const actionButtons = [
      buildCopyUrlButton(),
      buildShapeKmlButton({
        shapeType: type,
        title: parsedText.title,
        description: exportDescription || parsedText.mainText,
        geometry
      })
    ];

    // 添加儲存筆記按鈕（傳遞完整幾何資料）
    if (window.Notes && typeof window.Notes.getShapeNoteButtonHtml === 'function') {
      actionButtons.unshift(window.Notes.getShapeNoteButtonHtml({
        shapeType: type,
        lat: center.lat,
        lng: center.lng,
        title: parsedText.title,
        text: parsedText.noteText,
        shapeInfo: shapeInfo,
        geometry: geometry,
        groupGeometry: multiShapeNoteConfig?.groupGeometry || null,
        groupShapeCount: multiShapeNoteConfig?.groupShapeCount || 0,
        groupTitle: multiShapeNoteConfig?.groupTitle || parsedText.title,
        groupItems: multiShapeNoteConfig?.groupItems || []
      }));
    }

    popupHtml += `<div class="popup-actions">${actionButtons.join('')}</div>`;
    
    return popupHtml;
  };

  shapeSpec.shapes.forEach(s => {
    try {
      s._bufferPolyline = null;
      if (s.type === 'point') {
        const redIcon = createRedDotIcon();
        const markerText = s.text || shapeSpec.text || '禁航點';
        // 建立 Point 幾何資料
        const pointGeometry = { type: 'Point', coordinates: [s.center.lng, s.center.lat] };
        const popupContent = buildShapePopup('point', markerText, s.center, {}, pointGeometry);
        const m = L.marker([s.center.lat, s.center.lng], { icon: redIcon }).bindPopup(popupContent);
        nfzLayerGroup.addLayer(m);
        extendBounds([[s.center.lat, s.center.lng]]);
        if (Number.isFinite(s.radiusKm) && s.radiusKm > 0) {
          const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
          const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
          const circleText = s.text || shapeSpec.text || '圓形區域';
          // 建立 Circle 幾何資料
          const circleGeometry = { type: 'Circle', center: [s.center.lng, s.center.lat], radiusKm: s.radiusKm };
          const circleAreaKm2a = Math.PI * s.radiusKm * s.radiusKm;
          const circleCircKm2a = 2 * Math.PI * s.radiusKm;
          const circlePopup = buildShapePopup('circle', circleText, s.center, { radius: radiusText, area: fmtArea(circleAreaKm2a), perimeter: fmtDist(circleCircKm2a) }, circleGeometry);
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
        // 建立 LineString 幾何資料（儲存所有頂點座標）
        const lineGeometry = { 
          type: 'LineString', 
          coordinates: s.coords.map(p => [p.lng, p.lat]) // GeoJSON 格式: [lng, lat]
        };
        const linePopup = buildShapePopup('line', lineText, { lat: center.lat, lng: center.lng }, { length: lengthText }, lineGeometry);
        pl.bindPopup(linePopup);
        nfzLayerGroup.addLayer(pl);
        addPolylineEdgeLines(latlngs, nfzLayerGroup);
        extendBounds(latlngs);
      } else if (s.type === 'polygon') {
        const latlngs = s.coords.map(p => [p.lat, p.lng]);
        const poly = L.polygon(latlngs, { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const center = poly.getBounds().getCenter();
        const polyText = s.text || shapeSpec.text || '多邊形區域';
        // 建立 Polygon 幾何資料（儲存所有頂點座標）
        const polygonGeometry = { 
          type: 'Polygon', 
          coordinates: s.coords.map(p => [p.lng, p.lat]) // GeoJSON 格式: [lng, lat]
        };
        const polyAreaKm2 = calcPolygonAreaKm2(latlngs);
        let polyPerim = 0;
        for (let i = 0; i < latlngs.length; i++) {
          const j = (i + 1) % latlngs.length;
          polyPerim += calculateDistance(latlngs[i][0], latlngs[i][1], latlngs[j][0], latlngs[j][1]);
        }
        const polyPopup = buildShapePopup('polygon', polyText, { lat: center.lat, lng: center.lng }, { area: fmtArea(polyAreaKm2), perimeter: fmtDist(polyPerim) }, polygonGeometry);
        poly.bindPopup(polyPopup);
        nfzLayerGroup.addLayer(poly);
        addPolygonEdgeLines(latlngs, nfzLayerGroup);
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
        // 建立 Rectangle 幾何資料
        const rectGeometry = { 
          type: 'Rectangle', 
          bounds: { west: s.bounds.west, south: s.bounds.south, east: s.bounds.east, north: s.bounds.north }
        };
        const rectLatlngs = latlngs;
        const rectAreaKm2 = calcPolygonAreaKm2(rectLatlngs);
        const rectWKm = calculateDistance(s.bounds.south, s.bounds.west, s.bounds.south, s.bounds.east);
        const rectHKm = calculateDistance(s.bounds.south, s.bounds.west, s.bounds.north, s.bounds.west);
        const rectPopup = buildShapePopup('bbox', rectText, { lat: center.lat, lng: center.lng }, { area: fmtArea(rectAreaKm2), perimeter: fmtDist(2 * (rectWKm + rectHKm)) }, rectGeometry);
        rect.bindPopup(rectPopup);
        nfzLayerGroup.addLayer(rect);
        addPolygonEdgeLines(latlngs, nfzLayerGroup);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(latlngs.map(([lat, lng]) => ({ lat, lng })));
        s._bufferPolyline = perimeter;
      } else if (s.type === 'circle') {
        const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
        const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const circleText = s.text || shapeSpec.text || '圓形區域';
        // 建立 Circle 幾何資料
        const circleGeometry = { type: 'Circle', center: [s.center.lng, s.center.lat], radiusKm: s.radiusKm };
        const circleAreaKm2b = Math.PI * s.radiusKm * s.radiusKm;
        const circleCircKm2b = 2 * Math.PI * s.radiusKm;
        const circlePopup = buildShapePopup('circle', circleText, s.center, { radius: radiusText, area: fmtArea(circleAreaKm2b), perimeter: fmtDist(circleCircKm2b) }, circleGeometry);
        c.bindPopup(circlePopup);
        nfzLayerGroup.addLayer(c);
        extendBounds(c.getBounds());
      } else if (s.type === 'sector') {
        const latlngs = window.shapeUtils.buildSectorLatLngs(s.center, s.radiusKm, s.startDeg, s.endDeg);
        const sec = L.polygon(latlngs, { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.12 });
        const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
        const sectorText = s.text || shapeSpec.text || '扇形區域';
        // 建立 Sector 幾何資料
        const sectorGeometry = { 
          type: 'Sector', 
          center: [s.center.lng, s.center.lat], 
          radiusKm: s.radiusKm, 
          startDeg: s.startDeg, 
          endDeg: s.endDeg 
        };
        const sectorAngleDegCw = (((s.endDeg - s.startDeg) + 360) % 360) || 360;
        const sectorArcLen = 2 * Math.PI * s.radiusKm * (sectorAngleDegCw / 360);
        const sectorAreaKm2 = (sectorAngleDegCw / 360) * Math.PI * s.radiusKm * s.radiusKm;
        const sectorPopup = buildShapePopup('sector', sectorText, s.center, {
          radius: radiusText,
          angle: `${sectorAngleDegCw.toFixed(1)}°（${s.startDeg}° → ${s.endDeg}°）`,
          area: fmtArea(sectorAreaKm2),
          arcLength: fmtDist(sectorArcLen)
        }, sectorGeometry);
        sec.bindPopup(sectorPopup);
        nfzLayerGroup.addLayer(sec);
        const sectorAngleDeg = (((s.endDeg - s.startDeg) + 360) % 360) || 360;
        addSectorEdgeLines(latlngs, s.radiusKm, sectorAngleDeg, nfzLayerGroup);
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
    if (!skipFitBounds && bounds) {
      map.fitBounds(bounds.pad(0.2));
    }
  } catch (_) {}

  if (!skipFeatureMarkers) {
    addMarkersForFeatures(matched, null, selectedLayer, null);
  }
}

function downloadTextFile(content, filename, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function slugifyFilename(value, fallback = 'shape') {
  const cleaned = cleanText(value)
    .toLowerCase()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return cleaned || fallback;
}

function exportShapeAsKml(btn) {
  try {
    const title = decodeURIComponent(btn.dataset.title || '');
    const description = decodeURIComponent(btn.dataset.description || '');
    const geometry = JSON.parse(decodeURIComponent(btn.dataset.geometry || 'null'));
    const urlParams = new URLSearchParams(window.location.search);
    const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);
    const isMultiShapeExport = shapeSpec.shape === 'multi' && Array.isArray(shapeSpec.shapes) && shapeSpec.shapes.length > 1;

    let exportName = title || 'APEINTEL Shape';
    let kml = '';

    if (isMultiShapeExport) {
      const groupText = window.shapeUtils.parseShapeDisplayText(shapeSpec.text || title || 'APEINTEL Shapes', '圖形');
      const placemarks = shapeSpec.shapes
        .map(shape => window.shapeUtils.shapeToExportData(shape, shapeSpec.text || title))
        .filter(Boolean);
      exportName = groupText.title || exportName;
      kml = window.shapeUtils.buildShapesKml({
        name: exportName,
        placemarks
      });
    } else {
      kml = window.shapeUtils.buildShapeKml({
        name: exportName,
        description,
        geometry
      });
    }

    if (!kml) {
      throw new Error('無法建立 KML');
    }

    const filename = `${slugifyFilename(title || btn.dataset.shapeType || 'shape')}.kml`;
    downloadTextFile(kml, filename, 'application/vnd.google-earth.kml+xml;charset=utf-8');
    if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast('KML 已匯出');
    }
  } catch (error) {
    console.error('[Map] 匯出 KML 失敗:', error);
    if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast('KML 匯出失敗', 'error');
    }
  }
}

function hasShapeModeInUrl(urlParams = new URLSearchParams(window.location.search)) {
  return !!(urlParams.get('shape') || '').trim();
}

function renderShapeOverlayFromUrl(selectedLayer = null) {
  const urlParams = new URLSearchParams(window.location.search);
  if (!hasShapeModeInUrl(urlParams)) return;

  const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);
  renderShapeMode(shapeSpec, selectedLayer, {
    preserveMarkers: true,
    preserveCenterMarker: true,
    skipFeatureMarkers: true,
    skipFitBounds: true
  });
}
