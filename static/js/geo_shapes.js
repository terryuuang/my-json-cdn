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

// 格式化距離（僅 km/m，不含 nm，用於外接長寬等組合欄位避免過長）
function fmtKmShort(km) {
  return km < 1 ? `${(km * 1000).toFixed(0)} m` : `${km.toFixed(2)} km`;
}

// 計算一組座標點的外接框尺寸（寬、高）與對角跨度
function boundingBoxMetrics(points) {
  if (!points || points.length === 0) return null;
  let south = Infinity, north = -Infinity, west = Infinity, east = -Infinity;
  points.forEach(([lat, lng]) => {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lng < west) west = lng;
    if (lng > east) east = lng;
  });
  return {
    south, north, west, east,
    widthKm: calculateDistance(south, west, south, east),
    heightKm: calculateDistance(south, west, north, west),
    diagonalKm: calculateDistance(south, west, north, east)
  };
}

// 格式化緯經度座標（帶南北東西方向）
function fmtLatLng(lat, lng) {
  const latDir = lat >= 0 ? 'N' : 'S';
  const lngDir = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(5)}°${latDir}, ${Math.abs(lng).toFixed(5)}°${lngDir}`;
}

// 取得目前 shape 圖形應使用的顏色（未指定時為預設紅）
function resolveShapeColor(shape) {
  const normalize = window.shapeUtils && window.shapeUtils.normalizeShapeColor;
  const fallback = (window.shapeUtils && window.shapeUtils.SHAPE_DEFAULT_COLOR) || '#ef4444';
  if (!normalize) return fallback;
  return normalize(shape && shape.color) || fallback;
}

// shape 模式圖形的 className。
// main.css 有一條 Leaflet.draw 紅色主題規則會用 CSS 強制把 path 的 stroke 設成紅色，
// 而 CSS 的 stroke 優先於 Leaflet 寫在 SVG 上的 stroke 屬性，因此必須掛上這個
// className 讓該規則以 :not() 排除，setStyle({ color }) 才會真的改到邊框顏色。
const NFZ_SHAPE_PATH_CLASS = 'nfz-shape-path';

// 由圖形顏色推導出「邊框深、內部淡」的 Leaflet path 樣式
function shapePathStyle(color, fillOpacity = 0.12) {
  return { ...window.shapeUtils.buildShapePathStyle(color, { fillOpacity }), className: NFZ_SHAPE_PATH_CLASS };
}

// 只描邊不填色的線段樣式
function shapeStrokeStyle(color, weight = 3) {
  return { color: window.shapeUtils.shadeShapeColor(color), weight, className: NFZ_SHAPE_PATH_CLASS };
}

// shape popup 的顯示參數：依視窗寬度自適應，小螢幕不會被硬撐出水平捲動
function buildShapePopupOptions() {
  const viewportWidth = window.innerWidth || 360;
  const mobile = typeof isMobileDevice === 'function' ? isMobileDevice() : viewportWidth <= 768;
  const maxWidth = Math.max(240, Math.min(mobile ? 400 : 430, viewportWidth - 32));
  // 高度上限交給 CSS（.shape-popup .leaflet-popup-content）以便用 vh/dvh 自適應
  return {
    className: 'shape-popup',
    maxWidth,
    minWidth: Math.min(268, maxWidth),
    autoPan: true,
    autoPanPadding: [16, 16],
    keepInView: true,
    closeOnEscapeKey: true
  };
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
    color: '#ef4444', opacity: 0.001, weight: 14, interactive: true, className: NFZ_SHAPE_PATH_CLASS
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
  L.polyline(arcPts, { color: '#ef4444', opacity: 0.001, weight: 14, interactive: true, className: NFZ_SHAPE_PATH_CLASS })
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
      data-shape-uid="${shapeData.uid || ''}"
      data-shape-color="${shapeData.color || ''}"
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
        const exportData = window.shapeUtils.shapeToExportData(shape, shapeSpec.text, shapeSpec);
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
  const buildShapePopup = (type, text, center, shapeInfo = {}, geometry = null, colorContext = {}) => {
    const rawText = text || '區域標記';
    const shapeTypeLabels = { 'point': '標記點', 'circle': '圓形區域', 'line': '線段', 'polygon': '多邊形', 'bbox': '矩形區域', 'sector': '扇形區域', 'multi': '複合圖形' };
    const typeLabel = shapeTypeLabels[type] || '圖形';
    const perimeterLabel = type === 'circle' ? '圓周' : '周長';
    const parsedText = window.shapeUtils.parseShapeDisplayText(rawText, typeLabel);
    const activityType = cleanText(shapeSpec.activityType);
    const aiJudgment = cleanText(shapeSpec.aiJudgment) || parsedText.aiAnalysis;

    // 度量欄位統一收斂成 [標籤, 值] 清單，畫面與 KML 說明共用同一份資料來源
    const metrics = [
      ['座標', shapeInfo.coordinates],
      ['半徑', shapeInfo.radius],
      ['直徑', shapeInfo.diameter],
      ['張角', shapeInfo.angle],
      ['弧長', shapeInfo.arcLength],
      ['邊界總長', shapeInfo.boundaryLength],
      ['路徑總長', shapeInfo.length],
      ['首尾跨度', shapeInfo.startEndSpan],
      ['外接長寬', shapeInfo.boundingBox],
      ['對角跨度', shapeInfo.diagonalSpan],
      [perimeterLabel, shapeInfo.perimeter],
      ['面積', shapeInfo.area],
      ['頂點數', shapeInfo.vertexCount],
      ['節點數', shapeInfo.nodeCount]
    ].filter(([, value]) => value);

    // 版面採 iOS 設定頁的「群組式清單」：同一群資訊收在一張圓角卡裡、以髮絲線分隔，
    // 標籤靠左、數值靠右，不再每個欄位各自一個框，讓資訊密度高但視覺安靜。
    const listRow = (label, value) => `<div class="shape-row">`
      + `<span class="shape-row-label">${escapeHtml(label)}</span>`
      + `<span class="shape-row-value">${escapeHtml(value)}</span></div>`;

    const listDisclosure = (label, value, body) => `<details class="shape-disclosure">`
      + `<summary class="shape-disclosure-summary">`
      + `<span class="shape-row-label">${escapeHtml(label)}</span>`
      + `<span class="shape-row-value">${escapeHtml(value)}</span></summary>`
      + `<div class="shape-disclosure-body">${escapeHtml(body)}</div></details>`;

    // 不再輸出區塊標題：圓角群組卡本身已足以分區，省下的高度讓 popup 大多數情況免捲動
    const section = (body) => `<section class="shape-section"><div class="shape-list">${body}</div></section>`;

    let popupHtml = `<header class="shape-popup-header">`
      + `<p class="shape-popup-kicker">${escapeHtml(typeLabel)}</p>`
      + `<h3 class="popup-title">${escapeHtml(parsedText.title)}</h3>`
      + (parsedText.subtitle ? `<p class="shape-popup-subtitle">${escapeHtml(parsedText.subtitle)}</p>` : '')
      + `</header>`;

    if (parsedText.description) {
      popupHtml += `<section class="shape-section">`
        + `<div class="shape-note">${escapeHtml(parsedText.description)}</div></section>`;
    }

    if (metrics.length) {
      popupHtml += section(metrics.map(([label, value]) => listRow(label, value)).join(''));
    }

    // AI 任務初判與判斷原因合併成單一可摺疊列（預設收合）：
    // 收合時右側直接顯示任務類型，展開才看完整推論，資訊層級一次到位。
    const detailRows = [];
    if (activityType && aiJudgment) {
      detailRows.push(listDisclosure('AI 研判', activityType, aiJudgment));
    } else if (activityType) {
      detailRows.push(listRow('AI 研判', activityType));
    } else if (aiJudgment) {
      detailRows.push(listDisclosure('AI 研判', '', aiJudgment));
    }

    // 選色器：ShapeColor 模組未載入時整段略過，popup 其餘功能不受影響
    if (colorContext.uid && window.ShapeColor && typeof window.ShapeColor.buildPickerHtml === 'function') {
      detailRows.push(window.ShapeColor.buildPickerHtml(colorContext.uid, colorContext.color));
    }
    if (detailRows.length) popupHtml += section(detailRows.join(''));

    const exportDescription = [
      parsedText.subtitle,
      parsedText.description,
      ...metrics.map(([label, value]) => `${label}: ${value}`),
      activityType ? `AI 任務初判: ${activityType}` : '',
      aiJudgment ? `AI 判斷原因: ${aiJudgment}` : ''
    ].filter(Boolean).join('\n');

    const actionButtons = [
      buildCopyUrlButton(),
      buildShapeKmlButton({
        shapeType: type,
        uid: colorContext.uid || '',
        color: colorContext.color || '',
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

  // 交給選色模組管理本次渲染出來的圖層（模組未載入時全部退化成 no-op）
  const colorApi = window.ShapeColor || null;
  if (colorApi) {
    try {
      colorApi.beginRender(shapeSpec);
      colorApi.ensureAttached(map);
    } catch (_) {}
  }
  const registerShapeColor = (shape, color, applyFn) => {
    if (!colorApi || !shape || !shape.uid) return;
    try {
      colorApi.register(shape.uid, {
        color,
        apply: applyFn,
        colorParam: shape.colorParam,
        colorIndex: shape.colorIndex
      });
    } catch (_) {}
  };
  const colorContextFor = (shape, color) => ({ uid: shape && shape.uid, color });
  const popupOptions = buildShapePopupOptions();

  shapeSpec.shapes.forEach(s => {
    try {
      s._bufferPolyline = null;
      const shapeColor = resolveShapeColor(s);
      const colorContext = colorContextFor(s, shapeColor);
      if (s.type === 'point') {
        const markerText = s.text || shapeSpec.text || '禁航點';
        // 建立 Point 幾何資料
        const pointGeometry = { type: 'Point', coordinates: [s.center.lng, s.center.lat] };
        const popupContent = buildShapePopup('point', markerText, s.center, { coordinates: fmtLatLng(s.center.lat, s.center.lng) }, pointGeometry, colorContext);
        const m = L.marker([s.center.lat, s.center.lng], { icon: createShapeDotIcon(shapeColor) }).bindPopup(popupContent, popupOptions);
        nfzLayerGroup.addLayer(m);
        extendBounds([[s.center.lat, s.center.lng]]);
        let radiusCircle = null;
        if (Number.isFinite(s.radiusKm) && s.radiusKm > 0) {
          const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
          const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, ...shapePathStyle(shapeColor) });
          const circleText = s.text || shapeSpec.text || '圓形區域';
          // 建立 Circle 幾何資料
          const circleGeometry = { type: 'Circle', center: [s.center.lng, s.center.lat], radiusKm: s.radiusKm };
          const circleAreaKm2a = Math.PI * s.radiusKm * s.radiusKm;
          const circleCircKm2a = 2 * Math.PI * s.radiusKm;
          const circlePopup = buildShapePopup('circle', circleText, s.center, {
            radius: radiusText,
            diameter: fmtDist(s.radiusKm * 2),
            perimeter: fmtDist(circleCircKm2a),
            area: fmtArea(circleAreaKm2a)
          }, circleGeometry, colorContext);
          c.bindPopup(circlePopup, popupOptions);
          nfzLayerGroup.addLayer(c);
          extendBounds(c.getBounds());
          radiusCircle = c;
        }
        registerShapeColor(s, shapeColor, (color) => {
          m.setIcon(createShapeDotIcon(color));
          if (radiusCircle) radiusCircle.setStyle(shapePathStyle(color));
        });
      } else if (s.type === 'line') {
        const latlngs = s.coords.map(p => [p.lat, p.lng]);
        const pl = L.polyline(latlngs, shapeStrokeStyle(shapeColor));
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
        const lineBbox = boundingBoxMetrics(latlngs);
        const startEndKm = calculateDistance(
          latlngs[0][0], latlngs[0][1],
          latlngs[latlngs.length - 1][0], latlngs[latlngs.length - 1][1]
        );
        const linePopup = buildShapePopup('line', lineText, { lat: center.lat, lng: center.lng }, {
          length: lengthText,
          startEndSpan: fmtDist(startEndKm),
          boundingBox: lineBbox ? `${fmtKmShort(lineBbox.widthKm)} × ${fmtKmShort(lineBbox.heightKm)}` : '',
          nodeCount: `${s.coords.length} 個`
        }, lineGeometry, colorContext);
        pl.bindPopup(linePopup, popupOptions);
        nfzLayerGroup.addLayer(pl);
        addPolylineEdgeLines(latlngs, nfzLayerGroup);
        extendBounds(latlngs);
        registerShapeColor(s, shapeColor, (color) => pl.setStyle(shapeStrokeStyle(color)));
      } else if (s.type === 'polygon') {
        const latlngs = s.coords.map(p => [p.lat, p.lng]);
        const poly = L.polygon(latlngs, shapePathStyle(shapeColor));
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
        const polyBbox = boundingBoxMetrics(latlngs);
        const polyPopup = buildShapePopup('polygon', polyText, { lat: center.lat, lng: center.lng }, {
          boundingBox: polyBbox ? `${fmtKmShort(polyBbox.widthKm)} × ${fmtKmShort(polyBbox.heightKm)}` : '',
          diagonalSpan: polyBbox ? fmtDist(polyBbox.diagonalKm) : '',
          perimeter: fmtDist(polyPerim),
          area: fmtArea(polyAreaKm2),
          vertexCount: `${s.coords.length} 個`
        }, polygonGeometry, colorContext);
        poly.bindPopup(polyPopup, popupOptions);
        nfzLayerGroup.addLayer(poly);
        addPolygonEdgeLines(latlngs, nfzLayerGroup);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(s.coords.map(p => ({ lat: p.lat, lng: p.lng })));
        s._bufferPolyline = perimeter;
        registerShapeColor(s, shapeColor, (color) => poly.setStyle(shapePathStyle(color)));
      } else if (s.type === 'bbox') {
        const latlngs = [
          [s.bounds.south, s.bounds.west],
          [s.bounds.south, s.bounds.east],
          [s.bounds.north, s.bounds.east],
          [s.bounds.north, s.bounds.west]
        ];
        const rect = L.polygon(latlngs, shapePathStyle(shapeColor, 0.08));
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
        const rectDiagonalKm = calculateDistance(s.bounds.south, s.bounds.west, s.bounds.north, s.bounds.east);
        const rectPopup = buildShapePopup('bbox', rectText, { lat: center.lat, lng: center.lng }, {
          boundingBox: `${fmtKmShort(rectWKm)} × ${fmtKmShort(rectHKm)}`,
          diagonalSpan: fmtDist(rectDiagonalKm),
          perimeter: fmtDist(2 * (rectWKm + rectHKm)),
          area: fmtArea(rectAreaKm2)
        }, rectGeometry, colorContext);
        rect.bindPopup(rectPopup, popupOptions);
        nfzLayerGroup.addLayer(rect);
        addPolygonEdgeLines(latlngs, nfzLayerGroup);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(latlngs.map(([lat, lng]) => ({ lat, lng })));
        s._bufferPolyline = perimeter;
        registerShapeColor(s, shapeColor, (color) => rect.setStyle(shapePathStyle(color, 0.08)));
      } else if (s.type === 'circle') {
        const radiusText = s.radiusKm < 1 ? `${(s.radiusKm * 1000).toFixed(0)} 公尺` : `${s.radiusKm.toFixed(2)} 公里`;
        const c = L.circle([s.center.lat, s.center.lng], { radius: s.radiusKm * 1000, ...shapePathStyle(shapeColor) });
        const circleText = s.text || shapeSpec.text || '圓形區域';
        // 建立 Circle 幾何資料
        const circleGeometry = { type: 'Circle', center: [s.center.lng, s.center.lat], radiusKm: s.radiusKm };
        const circleAreaKm2b = Math.PI * s.radiusKm * s.radiusKm;
        const circleCircKm2b = 2 * Math.PI * s.radiusKm;
        const circlePopup = buildShapePopup('circle', circleText, s.center, {
          radius: radiusText,
          diameter: fmtDist(s.radiusKm * 2),
          perimeter: fmtDist(circleCircKm2b),
          area: fmtArea(circleAreaKm2b)
        }, circleGeometry, colorContext);
        c.bindPopup(circlePopup, popupOptions);
        nfzLayerGroup.addLayer(c);
        extendBounds(c.getBounds());
        registerShapeColor(s, shapeColor, (color) => c.setStyle(shapePathStyle(color)));
      } else if (s.type === 'sector') {
        const latlngs = window.shapeUtils.buildSectorLatLngs(s.center, s.radiusKm, s.startDeg, s.endDeg);
        const sec = L.polygon(latlngs, shapePathStyle(shapeColor));
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
        const sectorBoundaryKm = 2 * s.radiusKm + sectorArcLen;
        const sectorPopup = buildShapePopup('sector', sectorText, s.center, {
          radius: radiusText,
          angle: `${sectorAngleDegCw.toFixed(1)}°（${s.startDeg}° → ${s.endDeg}°）`,
          arcLength: fmtDist(sectorArcLen),
          boundaryLength: fmtDist(sectorBoundaryKm),
          area: fmtArea(sectorAreaKm2)
        }, sectorGeometry, colorContext);
        sec.bindPopup(sectorPopup, popupOptions);
        nfzLayerGroup.addLayer(sec);
        const sectorAngleDeg = (((s.endDeg - s.startDeg) + 360) % 360) || 360;
        addSectorEdgeLines(latlngs, s.radiusKm, sectorAngleDeg, nfzLayerGroup);
        extendBounds(latlngs);
        const perimeter = ensureClosedPolyline(latlngs.map(([lat, lng]) => ({ lat, lng })));
        s._bufferPolyline = perimeter;
        registerShapeColor(s, shapeColor, (color) => sec.setStyle(shapePathStyle(color)));
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
    // 顏色以「目前畫面上的顏色」為準：使用者調色後會寫回 URL，這裡重新解析即可拿到最新值
    const shapeUid = btn.dataset.shapeUid || '';
    const exportColor = (window.ShapeColor && shapeUid && window.ShapeColor.getColor(shapeUid))
      || window.shapeUtils.normalizeShapeColor(btn.dataset.shapeColor)
      || window.shapeUtils.SHAPE_DEFAULT_COLOR;

    let exportName = title || 'APEINTEL Shape';
    let kml = '';

    if (isMultiShapeExport) {
      const groupText = window.shapeUtils.parseShapeDisplayText(shapeSpec.text || title || 'APEINTEL Shapes', '圖形');
      const placemarks = shapeSpec.shapes
        .map(shape => window.shapeUtils.shapeToExportData(shape, shapeSpec.text || title, shapeSpec))
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
        geometry,
        color: exportColor
      });
    }

    if (!kml) {
      throw new Error('無法建立 KML');
    }

    const filename = `${slugifyFilename(title || btn.dataset.shapeType || 'shape')}.kml`;
    downloadTextFile(kml, filename, 'application/vnd.google-earth.kml+xml;charset=utf-8');
    if (window.IslandActivity) {
      window.IslandActivity.transient('✓ KML 已匯出', 'success');
    } else if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast('KML 已匯出');
    }
  } catch (error) {
    console.error('[Map] 匯出 KML 失敗:', error);
    if (window.IslandActivity) {
      window.IslandActivity.transient('KML 匯出失敗', 'error');
    } else if (window.Notes && typeof window.Notes.showToast === 'function') {
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
