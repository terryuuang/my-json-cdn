// 純工具函式：shape 解析與幾何計算（與 Leaflet 無相依）
(function () {
  // ==========================================================
  // 圖形顏色（選用參數，未帶時行為與舊版完全相同）
  // ==========================================================
  // 預設紅色與歷史版本一致，任何未帶顏色參數的舊連結渲染結果不變。
  const SHAPE_DEFAULT_COLOR = '#ef4444';

  // popup 內顏色選擇器的預設色票。
  // 以預設紅 #ef4444 的濃度為基準（感知亮度約 0.47），其餘色相取相同深度的一階，
  // 讓整排色票在衛星影像上的份量一致，不會有幾顆特別跳、特別淡。
  // 只保留 6 個色相夠分開的重點色（任兩顆相差 ≥38°），避免色票之間互相雷同；
  // 其餘顏色仍可由自訂色盤或 color= 參數指定。
  const SHAPE_COLOR_PRESETS = [
    { value: '#ef4444', label: '警戒紅' },
    { value: '#d97706', label: '警示黃' },
    { value: '#16a34a', label: '行動綠' },
    { value: '#0891b2', label: '海洋青' },
    { value: '#2563eb', label: '戰術藍' },
    { value: '#9333ea', label: '判讀紫' }
  ];

  // 允許外部 API 直接帶語意化色名（比 %23ef4444 好讀好寫）
  // 主要色名與上方色票同深度；white/black 保留原本的極端值供需要高反差時使用
  const SHAPE_COLOR_ALIASES = {
    red: '#ef4444', orange: '#ea580c', amber: '#d97706', yellow: '#d97706',
    green: '#16a34a', emerald: '#059669', teal: '#0d9488', cyan: '#0891b2',
    blue: '#2563eb', indigo: '#4f46e5', violet: '#7c3aed', purple: '#9333ea',
    pink: '#db2777', magenta: '#db2777', rose: '#e11d48',
    white: '#f8fafc', black: '#111827', gray: '#64748b', grey: '#64748b'
  };

  // 多圖形模式下，每種子圖形對應的顏色參數名稱（與既有 *_text 參數同樣的索引語法）
  const SHAPE_COLOR_PARAM_KEYS = ['circle_color', 'line_color', 'poly_color', 'sector_color'];

  /**
   * 將任意輸入正規化成 #rrggbb；無法解析時回傳 null（呼叫端一律退回預設色）。
   * 支援：#rgb / #rrggbb / rgb / rrggbb / 語意色名，大小寫不拘。
   */
  function normalizeShapeColor(input) {
    if (typeof input !== 'string') return null;
    const raw = input.trim().toLowerCase();
    if (!raw) return null;
    if (SHAPE_COLOR_ALIASES[raw]) return SHAPE_COLOR_ALIASES[raw];
    const hex = raw.startsWith('#') ? raw.slice(1) : raw;
    if (/^[0-9a-f]{3}$/.test(hex)) return '#' + hex.split('').map(ch => ch + ch).join('');
    if (/^[0-9a-f]{6}$/.test(hex)) return '#' + hex;
    return null;
  }

  // 邊框相對於填色要加深的比例：讓「邊框深、內部淡」的視覺一致套用在每個顏色上
  const SHAPE_STROKE_DARKEN = 0.24;

  /**
   * 把顏色往黑色方向調暗（ratio 0~1），用來由填色推導出對比更明顯的邊框色。
   * 非常暗的顏色（例如接近黑）改為微幅提亮，避免邊框整個糊在一起看不出輪廓。
   */
  function shadeShapeColor(color, ratio = SHAPE_STROKE_DARKEN) {
    const hex = (normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR).slice(1);
    const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    // 感知亮度（ITU-R BT.601），偏暗的顏色調暗後會失去輪廓，改成提亮
    const luma = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    const shifted = rgb.map(channel => (luma < 0.22
      ? Math.round(channel + (255 - channel) * ratio)
      : Math.round(channel * (1 - ratio))));
    return '#' + shifted.map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
  }

  /**
   * 由單一顏色推導出 Leaflet path 樣式：邊框為加深色、填色為原色 + 低不透明度。
   * @param {string} color        圖形顏色
   * @param {object} options      { fillOpacity, weight }
   */
  function buildShapePathStyle(color, options = {}) {
    const resolved = normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR;
    return {
      color: shadeShapeColor(resolved),
      fillColor: resolved,
      fillOpacity: Number.isFinite(options.fillOpacity) ? options.fillOpacity : 0.12,
      weight: Number.isFinite(options.weight) ? options.weight : 2
    };
  }

  // KML 用的 ABGR 色碼（aabbggrr），alphaHex 為兩碼十六進位透明度
  function colorToKmlAbgr(color, alphaHex = 'ff') {
    const hex = (normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR).slice(1);
    return `${alphaHex}${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
  }

  function kmlStyleIdFor(color) {
    return `shapeStyle-${(normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR).slice(1)}`;
  }

  function buildKmlStyleBlock(color) {
    const resolved = normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR;
    // 與地圖上一致：邊線用加深色，填色用原色加透明度
    return `    <Style id="${kmlStyleIdFor(resolved)}">
      <LineStyle>
        <color>${colorToKmlAbgr(shadeShapeColor(resolved), 'ff')}</color>
        <width>3</width>
      </LineStyle>
      <PolyStyle>
        <color>${colorToKmlAbgr(resolved, '33')}</color>
      </PolyStyle>
      <IconStyle>
        <color>${colorToKmlAbgr(resolved, 'ff')}</color>
        <scale>1.1</scale>
      </IconStyle>
    </Style>`;
  }

  function normalizeTextValue(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/\s+/g, ' ').trim();
  }

  function unitToKm(unit) {
    const u = (unit || 'nm').toLowerCase();
    if (u === 'km') return 1;
    if (u === 'm') return 1 / 1000;
    return 1.852; // nm
  }

  function parseLngLatList(s) {
    return (s || '').split(';').map(p => p.trim()).filter(Boolean).map(p => {
      const [lng, lat] = p.split(',').map(Number);
      return { lat, lng };
    }).filter(pt => !Number.isNaN(pt.lat) && !Number.isNaN(pt.lng));
  }

  function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].lng, yi = polygon[i].lat;
      const xj = polygon[j].lng, yj = polygon[j].lat;
      const intersect = ((yi > point.lat) !== (yj > point.lat)) &&
        (point.lng < (xj - xi) * (point.lat - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function distancePointToPolylineKm(point, line) {
    if (!line || line.length === 0) return Infinity;
    const lat0 = point.lat * Math.PI / 180;
    const mPerDegLat = 111132.92 - 559.82 * Math.cos(2 * lat0) + 1.175 * Math.cos(4 * lat0);
    const mPerDegLng = (Math.PI / 180) * 6378137 * Math.cos(lat0);
    const toXY = (pt) => ({ x: pt.lng * mPerDegLng, y: pt.lat * mPerDegLat });
    const P = toXY(point);
    let minM = Infinity;
    for (let i = 1; i < line.length; i++) {
      const A = toXY(line[i - 1]);
      const B = toXY(line[i]);
      const ABx = B.x - A.x, ABy = B.y - A.y;
      const APx = P.x - A.x, APy = P.y - A.y;
      const ab2 = ABx * ABx + ABy * ABy;
      const t = ab2 === 0 ? 0 : Math.max(0, Math.min(1, (APx * ABx + APy * ABy) / ab2));
      const Cx = A.x + t * ABx, Cy = A.y + t * ABy;
      const dx = P.x - Cx, dy = P.y - Cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < minM) minM = d;
    }
    return minM / 1000; // km
  }

  function bearingDeg(fromLat, fromLng, toLat, toLng) {
    const φ1 = fromLat * Math.PI / 180;
    const φ2 = toLat * Math.PI / 180;
    const λ1 = fromLng * Math.PI / 180;
    const λ2 = toLng * Math.PI / 180;
    const y = Math.sin(λ2 - λ1) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ2 - λ1);
    let θ = Math.atan2(y, x) * 180 / Math.PI;
    θ = (θ + 360) % 360;
    return θ;
  }

  function angleInRangeCW(angle, start, end) {
    const a = ((angle % 360) + 360) % 360;
    const s = ((start % 360) + 360) % 360;
    const e = ((end % 360) + 360) % 360;
    if (s <= e) return a >= s && a <= e;
    return a >= s || a <= e;
  }

  function buildSectorLatLngs(center, radiusKm, startDeg, endDeg, stepDeg = 2) {
    const latlngs = [];
    latlngs.push([center.lat, center.lng]);
    const rad = radiusKm * 1000;
    const s = ((startDeg % 360) + 360) % 360;
    const e = ((endDeg % 360) + 360) % 360;
    const cw = (a, b) => (b - a + 360) % 360;
    const total = cw(s, e) || 360;
    const steps = Math.max(1, Math.ceil(total / stepDeg));
    for (let i = 0; i <= steps; i++) {
      const angle = (s + (total * i / steps)) % 360;
      const brng = angle * Math.PI / 180;
      const R = 6371000;
      const φ1 = center.lat * Math.PI / 180;
      const λ1 = center.lng * Math.PI / 180;
      const φ2 = Math.asin(Math.sin(φ1) * Math.cos(rad / R) + Math.cos(φ1) * Math.sin(rad / R) * Math.cos(brng));
      const λ2 = λ1 + Math.atan2(Math.sin(brng) * Math.sin(rad / R) * Math.cos(φ1), Math.cos(rad / R) - Math.sin(φ1) * Math.sin(φ2));
      latlngs.push([φ2 * 180 / Math.PI, ((λ2 * 180 / Math.PI + 540) % 360) - 180]);
    }
    return latlngs;
  }

  function parseShapeDisplayText(rawText, typeLabel = '圖形') {
    const fallback = normalizeTextValue(rawText) || typeLabel;
    const aiMatch = fallback.match(/([\s\S]*?)(?:[，,\s]*)(AI判斷[：:]\s*)([\s\S]+)/);
    const mainText = normalizeTextValue(aiMatch ? aiMatch[1] : fallback) || typeLabel;
    const aiAnalysis = normalizeTextValue(aiMatch ? aiMatch[3] : '');
    const segments = mainText.split(/\s+-\s+/).map(normalizeTextValue).filter(Boolean);

    let title = mainText;
    let subtitle = '';
    let description = '';

    if (segments.length >= 3) {
      title = segments[0];
      subtitle = segments[1];
      description = segments.slice(2).join(' - ');
    } else if (segments.length === 2) {
      title = segments[0];
      description = segments[1];
    } else if (segments.length === 1) {
      title = segments[0];
    }

    const noteText = [subtitle, description].filter(Boolean).join('\n') || title;

    return {
      rawText: fallback,
      mainText,
      title,
      subtitle,
      description,
      noteText,
      aiAnalysis
    };
  }

  function escapeXml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function ensureClosedCoordinates(coords) {
    if (!Array.isArray(coords) || coords.length === 0) return [];
    const closed = coords.map(coord => coord.slice(0, 2));
    const first = closed[0];
    const last = closed[closed.length - 1];
    if (!first || !last || first[0] !== last[0] || first[1] !== last[1]) {
      closed.push(first.slice());
    }
    return closed;
  }

  function formatKmlCoordinates(coords) {
    return coords
      .map(coord => `${coord[0]},${coord[1]},0`)
      .join(' ');
  }

  function destinationPoint(center, distanceKm, bearingDegValue) {
    const radiusM = distanceKm * 1000;
    const bearing = bearingDegValue * Math.PI / 180;
    const earthRadius = 6371000;
    const lat1 = center[1] * Math.PI / 180;
    const lng1 = center[0] * Math.PI / 180;
    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(radiusM / earthRadius) +
      Math.cos(lat1) * Math.sin(radiusM / earthRadius) * Math.cos(bearing)
    );
    const lng2 = lng1 + Math.atan2(
      Math.sin(bearing) * Math.sin(radiusM / earthRadius) * Math.cos(lat1),
      Math.cos(radiusM / earthRadius) - Math.sin(lat1) * Math.sin(lat2)
    );
    return [((lng2 * 180 / Math.PI + 540) % 360) - 180, lat2 * 180 / Math.PI];
  }

  function buildCircleCoordinates(center, radiusKm, steps = 72) {
    const coords = [];
    for (let i = 0; i < steps; i++) {
      coords.push(destinationPoint(center, radiusKm, i * (360 / steps)));
    }
    return ensureClosedCoordinates(coords);
  }

  function buildSectorCoordinates(center, radiusKm, startDeg, endDeg, stepDeg = 2) {
    const latlngs = buildSectorLatLngs(
      { lat: center[1], lng: center[0] },
      radiusKm,
      startDeg,
      endDeg,
      stepDeg
    );
    return ensureClosedCoordinates(latlngs.map(([lat, lng]) => [lng, lat]));
  }

  function geometryToKml(geometry) {
    if (!geometry || !geometry.type) return '';

    if (geometry.type === 'Point' && Array.isArray(geometry.coordinates)) {
      return `<Point><coordinates>${formatKmlCoordinates([geometry.coordinates])}</coordinates></Point>`;
    }

    if (geometry.type === 'LineString' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
      return `<LineString><tessellate>1</tessellate><coordinates>${formatKmlCoordinates(geometry.coordinates)}</coordinates></LineString>`;
    }

    if (geometry.type === 'Polygon' && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 3) {
      const ring = ensureClosedCoordinates(geometry.coordinates);
      return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }

    if (geometry.type === 'Rectangle' && geometry.bounds) {
      const { west, south, east, north } = geometry.bounds;
      const ring = ensureClosedCoordinates([
        [west, south],
        [east, south],
        [east, north],
        [west, north]
      ]);
      return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }

    if (geometry.type === 'Circle' && Array.isArray(geometry.center) && Number.isFinite(geometry.radiusKm)) {
      const ring = buildCircleCoordinates(geometry.center, geometry.radiusKm);
      return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }

    if (
      geometry.type === 'Sector' &&
      Array.isArray(geometry.center) &&
      Number.isFinite(geometry.radiusKm) &&
      Number.isFinite(geometry.startDeg) &&
      Number.isFinite(geometry.endDeg)
    ) {
      const ring = buildSectorCoordinates(geometry.center, geometry.radiusKm, geometry.startDeg, geometry.endDeg);
      return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${formatKmlCoordinates(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
    }

    return '';
  }

  function buildShapeKml(options = {}) {
    const {
      name = 'APEINTEL Shape',
      description = '',
      geometry = null,
      color = SHAPE_DEFAULT_COLOR
    } = options;

    const geometryMarkup = geometryToKml(geometry);
    if (!geometryMarkup) return '';

    const resolvedColor = normalizeShapeColor(color) || SHAPE_DEFAULT_COLOR;

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${buildKmlStyleBlock(resolvedColor)}
    <Placemark>
      <name>${escapeXml(name)}</name>
      <description>${escapeXml(description)}</description>
      <styleUrl>#${kmlStyleIdFor(resolvedColor)}</styleUrl>
      ${geometryMarkup}
    </Placemark>
  </Document>
</kml>`;
  }

  function shapeToExportData(shape, fallbackText = '', aiMetadata = {}) {
    if (!shape || !shape.type) return null;

    const shapeTypeLabels = {
      point: '標記點',
      circle: '圓形區域',
      line: '線段',
      polygon: '多邊形',
      bbox: '矩形區域',
      sector: '扇形區域'
    };

    const typeLabel = shapeTypeLabels[shape.type] || '圖形';
    const parsedText = parseShapeDisplayText(shape.text || fallbackText || typeLabel, typeLabel);
    const activityType = normalizeTextValue(aiMetadata.activityType);
    const aiJudgment = normalizeTextValue(aiMetadata.aiJudgment) || parsedText.aiAnalysis;
    let geometry = null;
    let detailText = '';

    if (shape.type === 'point' && shape.center) {
      geometry = { type: 'Point', coordinates: [shape.center.lng, shape.center.lat] };
    } else if (shape.type === 'line' && Array.isArray(shape.coords)) {
      geometry = { type: 'LineString', coordinates: shape.coords.map(p => [p.lng, p.lat]) };
    } else if (shape.type === 'polygon' && Array.isArray(shape.coords)) {
      geometry = { type: 'Polygon', coordinates: shape.coords.map(p => [p.lng, p.lat]) };
    } else if (shape.type === 'bbox' && shape.bounds) {
      geometry = { type: 'Rectangle', bounds: { ...shape.bounds } };
    } else if (shape.type === 'circle' && shape.center && Number.isFinite(shape.radiusKm)) {
      geometry = { type: 'Circle', center: [shape.center.lng, shape.center.lat], radiusKm: shape.radiusKm };
      detailText = `半徑: ${shape.radiusKm.toFixed(2)} 公里`;
    } else if (shape.type === 'sector' && shape.center && Number.isFinite(shape.radiusKm)) {
      geometry = {
        type: 'Sector',
        center: [shape.center.lng, shape.center.lat],
        radiusKm: shape.radiusKm,
        startDeg: shape.startDeg,
        endDeg: shape.endDeg
      };
      detailText = `半徑: ${shape.radiusKm.toFixed(2)} 公里\n角度: ${shape.startDeg}° - ${shape.endDeg}°`;
    }

    if (!geometry) return null;

    const description = [
      parsedText.subtitle,
      parsedText.description,
      detailText,
      activityType ? `AI 任務初判: ${activityType}` : '',
      aiJudgment ? `AI 判斷原因: ${aiJudgment}` : ''
    ].filter(Boolean).join('\n');

    return {
      name: parsedText.title,
      description: description || parsedText.mainText,
      geometry,
      color: normalizeShapeColor(shape.color) || SHAPE_DEFAULT_COLOR
    };
  }

  function buildShapesKml(options = {}) {
    const {
      name = 'APEINTEL Shapes',
      placemarks = []
    } = options;

    // 每個 placemark 可帶自己的顏色，這裡依實際用到的顏色去重後產生 Style 區塊
    const usedColors = [];
    const items = placemarks
      .map(item => {
        const geometryMarkup = geometryToKml(item.geometry);
        if (!geometryMarkup) return '';
        const itemColor = normalizeShapeColor(item.color) || SHAPE_DEFAULT_COLOR;
        if (!usedColors.includes(itemColor)) usedColors.push(itemColor);
        return `    <Placemark>
      <name>${escapeXml(item.name || name)}</name>
      <description>${escapeXml(item.description || '')}</description>
      <styleUrl>#${kmlStyleIdFor(itemColor)}</styleUrl>
      ${geometryMarkup}
    </Placemark>`;
      })
      .filter(Boolean);

    if (items.length === 0) return '';

    const styles = (usedColors.length ? usedColors : [SHAPE_DEFAULT_COLOR])
      .map(buildKmlStyleBlock)
      .join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(name)}</name>
${styles}
${items.join('\n')}
  </Document>
</kml>`;
  }

  function parseShapeParams(urlParams) {
    const shape = (urlParams.get('shape') || '').trim().toLowerCase();
    const unit = (urlParams.get('unit') || 'nm').toLowerCase();
    const kmPerUnit = unitToKm(unit);
    const shapes = [];
    const globalRadius = parseFloat(urlParams.get('radius'));
    const text = (urlParams.get('text') || '').toString().trim();
    const activityType = (urlParams.get('activity_type') || '').toString().trim();
    const aiJudgment = (urlParams.get('ai_judgment') || '').toString().trim();

    function normalizeText(value) {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed ? trimmed : null;
    }

    function attachText(shape, textValue) {
      const label = normalizeText(textValue);
      if (label) shape.text = label;
      return shape;
    }

    function extractInlineText(raw) {
      if (typeof raw !== 'string') return { value: raw, text: null };
      const parts = raw.split('|');
      if (parts.length <= 1) return { value: raw, text: null };
      return { value: parts[0].trim(), text: parts.slice(1).join('|') };
    }

    function resolveText(inline, arr, idx) {
      const inlineLabel = normalizeText(inline);
      if (inlineLabel) return inlineLabel;
      if (!arr || idx >= arr.length) return null;
      return normalizeText(arr[idx]);
    }

    function parseTextList(paramName) {
      const sequential = [];
      const indexed = [];

      const pushSequential = (raw) => {
        if (typeof raw !== 'string') return;
        const trimmed = raw.trim();
        if (!trimmed) return;
        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              parsed.forEach(item => {
                if (typeof item === 'string' && item.trim()) sequential.push(item.trim());
              });
              return;
            }
          } catch (_) {}
        }
        sequential.push(trimmed);
      };

      const assignIndexed = (raw, idx) => {
        if (typeof raw !== 'string') return;
        const trimmed = raw.trim();
        if (!trimmed || !Number.isFinite(idx)) return;
        indexed[idx] = trimmed;
      };

      urlParams.forEach((value, key) => {
        if (key === paramName) {
          pushSequential(value);
          return;
        }
        const match = key.match(new RegExp('^' + paramName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\[(\\d+)\\]$'));
        if (match) {
          const idx = Number.parseInt(match[1], 10);
          assignIndexed(value, idx);
        }
      });

      const result = sequential.slice();
      indexed.forEach((val, idx) => {
        if (typeof val === 'string' && val.trim()) {
          result[idx] = val.trim();
        }
      });
      return result;
    }

    const pushPoint = (lat, lng, rKm, textValue) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const shape = { type: 'point', center: { lat, lng } };
      if (Number.isFinite(rKm)) shape.radiusKm = rKm;
      shapes.push(attachText(shape, textValue));
    };
    const pushLine = (list, textValue) => {
      if (list.length < 2) return;
      shapes.push(attachText({ type: 'line', coords: list }, textValue));
    };
    const pushPoly = (list, textValue) => {
      if (list.length < 3) return;
      shapes.push(attachText({ type: 'polygon', coords: list }, textValue));
    };
    const pushBbox = (w, s, e, n, textValue) => {
      if (![w, s, e, n].every(Number.isFinite)) return;
      shapes.push(attachText({ type: 'bbox', bounds: { west: w, south: s, east: e, north: n } }, textValue));
    };
    const pushCircle = (lat, lng, r, textValue) => {
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(r)) return;
      shapes.push(attachText({ type: 'circle', center: { lat, lng }, radiusKm: r * kmPerUnit }, textValue));
    };
    const pushSector = (lat, lng, r, start, end, textValue) => {
      if ([lat, lng, r, start, end].some(v => !Number.isFinite(v))) return;
      shapes.push(attachText({ type: 'sector', center: { lat, lng }, radiusKm: r * kmPerUnit, startDeg: start, endDeg: end }, textValue));
    };

    // 標記這次 push 出來的圖形（若有成功建立）該讀哪個顏色參數，
    // 供 popup 顏色選擇器把使用者調整的顏色寫回對應的 URL 參數。
    const withColorParam = (colorParam, colorIndex, pushFn) => {
      const before = shapes.length;
      pushFn();
      if (shapes.length > before) {
        const created = shapes[shapes.length - 1];
        created.colorParam = colorParam;
        created.colorIndex = colorIndex;
      }
    };

    if (shape === 'multi') {
      const circleTexts = parseTextList('circle_text');
      const lineTexts = parseTextList('line_text');
      const polyTexts = parseTextList('poly_text');
      const sectorTexts = parseTextList('sector_text');

      urlParams.getAll('circle').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const [lng, lat, r] = (value || '').split(',').map(Number);
        const label = resolveText(inlineText, circleTexts, idx);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(r)) {
          withColorParam('circle_color', idx, () => pushCircle(lat, lng, r, label));
        }
      });
      urlParams.getAll('line').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const label = resolveText(inlineText, lineTexts, idx);
        withColorParam('line_color', idx, () => pushLine(parseLngLatList(value), label));
      });
      urlParams.getAll('poly').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const label = resolveText(inlineText, polyTexts, idx);
        withColorParam('poly_color', idx, () => pushPoly(parseLngLatList(value), label));
      });
      urlParams.getAll('sector').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const [lng, lat, r, start, end] = (value || '').split(',').map(Number);
        const label = resolveText(inlineText, sectorTexts, idx);
        if ([lat, lng, r, start, end].every(Number.isFinite)) {
          withColorParam('sector_color', idx, () => pushSector(lat, lng, r, start, end, label));
        }
      });
    } else if (shape) {
      // 單一圖形模式只有一個圖形，顏色直接對應全域的 color 參數
      if (shape === 'point') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const rKm = Number.isFinite(globalRadius) ? globalRadius * kmPerUnit : 50;
        withColorParam('color', 0, () => pushPoint(lat, lng, rKm, text));
      } else if (shape === 'line') {
        withColorParam('color', 0, () => pushLine(parseLngLatList(urlParams.get('line') || ''), text));
      } else if (shape === 'polygon') {
        withColorParam('color', 0, () => pushPoly(parseLngLatList(urlParams.get('poly') || ''), text));
      } else if (shape === 'bbox') {
        const [w, s, e, n] = (urlParams.get('bbox') || '').split(',').map(Number);
        withColorParam('color', 0, () => pushBbox(w, s, e, n, text));
      } else if (shape === 'circle') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const r = parseFloat(urlParams.get('radius'));
        withColorParam('color', 0, () => pushCircle(lat, lng, r, text));
      } else if (shape === 'sector') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const r = parseFloat(urlParams.get('radius'));
        const start = parseFloat(urlParams.get('start'));
        const end = parseFloat(urlParams.get('end'));
        withColorParam('color', 0, () => pushSector(lat, lng, r, start, end, text));
      }
    }

    // 解析顏色：優先序為「該圖形專屬顏色 > 全域 color > 預設紅」。
    // 三者皆無或格式不合法時一律退回預設紅，確保沒帶參數的舊連結行為完全不變。
    const globalColor = normalizeShapeColor(urlParams.get('color'));
    const colorLists = {};
    SHAPE_COLOR_PARAM_KEYS.forEach(key => { colorLists[key] = parseTextList(key); });

    shapes.forEach((s, idx) => {
      s.uid = `sh${idx}`;
      if (!s.colorParam) { s.colorParam = 'color'; s.colorIndex = 0; }
      const perShape = s.colorParam !== 'color'
        ? normalizeShapeColor((colorLists[s.colorParam] || [])[s.colorIndex])
        : null;
      s.color = perShape || globalColor || SHAPE_DEFAULT_COLOR;
    });

    // 禁航區附近單位預設距離（線段緩衝）提高為 100km
    const lineBufferKm = Number.isFinite(globalRadius) ? globalRadius * kmPerUnit : 100;
    return {
      shape,
      unit,
      kmPerUnit,
      shapes,
      lineBufferKm,
      text,
      activityType,
      aiJudgment,
      color: globalColor || null
    };
  }

  window.shapeUtils = {
    SHAPE_DEFAULT_COLOR,
    SHAPE_COLOR_PRESETS,
    SHAPE_COLOR_PARAM_KEYS,
    normalizeShapeColor,
    shadeShapeColor,
    buildShapePathStyle,
    colorToKmlAbgr,
    unitToKm,
    parseLngLatList,
    pointInPolygon,
    distancePointToPolylineKm,
    bearingDeg,
    angleInRangeCW,
    buildSectorLatLngs,
    parseShapeDisplayText,
    buildShapeKml,
    buildShapesKml,
    shapeToExportData,
    parseShapeParams
  };
})();
