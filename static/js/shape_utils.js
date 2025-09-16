// 純工具函式：shape 解析與幾何計算（與 Leaflet 無相依）
(function () {
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

  function parseShapeParams(urlParams) {
    const shape = (urlParams.get('shape') || '').trim().toLowerCase();
    const unit = (urlParams.get('unit') || 'nm').toLowerCase();
    const kmPerUnit = unitToKm(unit);
    const shapes = [];
    const globalRadius = parseFloat(urlParams.get('radius'));
    const text = (urlParams.get('text') || '').toString().trim();

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

    if (shape === 'multi') {
      const circleTexts = parseTextList('circle_text');
      const lineTexts = parseTextList('line_text');
      const polyTexts = parseTextList('poly_text');
      const sectorTexts = parseTextList('sector_text');

      urlParams.getAll('circle').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const [lng, lat, r] = (value || '').split(',').map(Number);
        const label = resolveText(inlineText, circleTexts, idx);
        if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(r)) pushCircle(lat, lng, r, label);
      });
      urlParams.getAll('line').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const label = resolveText(inlineText, lineTexts, idx);
        pushLine(parseLngLatList(value), label);
      });
      urlParams.getAll('poly').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const label = resolveText(inlineText, polyTexts, idx);
        pushPoly(parseLngLatList(value), label);
      });
      urlParams.getAll('sector').forEach((val, idx) => {
        const { value, text: inlineText } = extractInlineText(val || '');
        const [lng, lat, r, start, end] = (value || '').split(',').map(Number);
        const label = resolveText(inlineText, sectorTexts, idx);
        if ([lat, lng, r, start, end].every(Number.isFinite)) pushSector(lat, lng, r, start, end, label);
      });
    } else if (shape) {
      if (shape === 'point') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const rKm = Number.isFinite(globalRadius) ? globalRadius * kmPerUnit : 50;
        pushPoint(lat, lng, rKm, text);
      } else if (shape === 'line') {
        pushLine(parseLngLatList(urlParams.get('line') || ''), text);
      } else if (shape === 'polygon') {
        pushPoly(parseLngLatList(urlParams.get('poly') || ''), text);
      } else if (shape === 'bbox') {
        const [w, s, e, n] = (urlParams.get('bbox') || '').split(',').map(Number);
        pushBbox(w, s, e, n, text);
      } else if (shape === 'circle') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const r = parseFloat(urlParams.get('radius'));
        pushCircle(lat, lng, r, text);
      } else if (shape === 'sector') {
        const lat = parseFloat(urlParams.get('lat'));
        const lng = parseFloat(urlParams.get('lng'));
        const r = parseFloat(urlParams.get('radius'));
        const start = parseFloat(urlParams.get('start'));
        const end = parseFloat(urlParams.get('end'));
        pushSector(lat, lng, r, start, end, text);
      }
    }

    // 禁航區附近單位預設距離（線段緩衝）改為 50km
    const lineBufferKm = Number.isFinite(globalRadius) ? globalRadius * kmPerUnit : 50;
    return { shape, unit, kmPerUnit, shapes, lineBufferKm, text };
  }

  window.shapeUtils = {
    unitToKm,
    parseLngLatList,
    pointInPolygon,
    distancePointToPolylineKm,
    bearingDeg,
    angleInRangeCW,
    buildSectorLatLngs,
    parseShapeParams
  };
})();
