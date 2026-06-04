// AIS 船舶快照 URL 圖層
// 支援 /#ais=<vessel>|<vessel>
(function () {
  const TYPE_LABELS = { c: '陸漁', g: '公務／軍艦', d: '暗船', k: '民兵目標', n: '非漁中共船' };
  const TYPE_COLORS = { c: '#2563eb', g: '#dc2626', d: '#7c3aed', k: '#f97316', n: '#ea580c' };
  const REGION_LABELS = { n: '北部', w: '西部', sw: '西南', e: '東部', se: '東南' };
  const VALID_TYPES = new Set(Object.keys(TYPE_LABELS));
  const VALID_REGIONS = new Set(Object.keys(REGION_LABELS));
  const DEFAULT_COLOR = '#334155';
  const MAX_HASH_LENGTH = 90000;
  const MAX_VESSELS = 1000;
  const MAX_RECORD_LENGTH = 700;
  const MAX_FIELD_LENGTHS = [16, 80, 16, 16, 4, 8, 8, 8, 40, 16, 20];
  const DEFAULT_AIS_CENTER = [23.75, 121.0];
  const DEFAULT_AIS_ZOOM = 7;

  let layerGroup = null;
  let mapRef = null;

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function decodeValue(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    try {
      return decodeURIComponent(raw.replace(/\+/g, '%20')).trim();
    } catch (_) {
      return raw;
    }
  }

  function getRawAisParam() {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.toLowerCase().startsWith('ais=')) return '';
    return hash.slice(4).split('&')[0].slice(0, MAX_HASH_LENGTH);
  }

  function hasAisHash() {
    return !!getRawAisParam();
  }

  function parseNumber(value, fallback = null) {
    const text = decodeValue(value);
    if (text === '') return fallback;
    const num = Number(text);
    return Number.isFinite(num) ? num : fallback;
  }

  function clampNumber(value, min, max, fallback = null) {
    const num = parseNumber(value, fallback);
    if (!Number.isFinite(num)) return fallback;
    return Math.min(max, Math.max(min, num));
  }

  function parseBoundedNumber(value, min, max) {
    const num = parseNumber(value);
    if (!Number.isFinite(num) || num < min || num > max) return null;
    return num;
  }

  function cleanField(value, index) {
    const maxLength = MAX_FIELD_LENGTHS[index] || 80;
    return decodeValue(value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLength);
  }

  function normalizeCog(value) {
    const num = parseNumber(value, 0);
    if (!Number.isFinite(num)) return 0;
    return ((Math.round(num) % 360) + 360) % 360;
  }

  function splitVesselFields(rawRecord) {
    const source = String(rawRecord ?? '').slice(0, MAX_RECORD_LENGTH);
    const normalized = source.replace(/：/g, ':');
    const fields = normalized.includes(':')
      ? normalized.split(':').map((value, index) => cleanField(value, index))
      : decodeValue(normalized).replace(/：/g, ':').split(':').map((value, index) => cleanField(value, index));
    while (fields.length < 11) fields.push('');
    return fields.slice(0, 11);
  }

  function parseVessels() {
    const raw = getRawAisParam();
    if (!raw) return [];

    const vesselRecords = raw
      .replace(/｜/g, '|')
      .replace(/%7C/gi, '|')
      .split('|')
      .slice(0, MAX_VESSELS);

    return vesselRecords
      .map(item => item.trim())
      .filter(Boolean)
      .map(record => {
        const [mmsi, name, lon, lat, type, sog, cog, region, cat, ml, ts] = splitVesselFields(record);
        const vesselType = decodeValue(type).toLowerCase();
        const vesselRegion = decodeValue(region).toLowerCase();
        const vessel = {
          mmsi: decodeValue(mmsi),
          name: decodeValue(name),
          lon: parseBoundedNumber(lon, -180, 180),
          lat: parseBoundedNumber(lat, -90, 90),
          type: VALID_TYPES.has(vesselType) ? vesselType : '',
          sog: clampNumber(sog, 0, 80, 0),
          cog: normalizeCog(cog),
          region: VALID_REGIONS.has(vesselRegion) ? vesselRegion : '',
          cat: decodeValue(cat),
          ml: decodeValue(ml) === '' ? null : parseNumber(ml),
          ts: decodeValue(ts) || null
        };

        if (!/^\d{9}$/.test(vessel.mmsi) || !Number.isFinite(vessel.lon) || !Number.isFinite(vessel.lat) || !vessel.type) {
          return null;
        }
        return vessel;
      })
      .filter(Boolean);
  }

  function buildVesselIcon(vessel) {
    const color = TYPE_COLORS[vessel.type] || DEFAULT_COLOR;
    const heading = Number.isFinite(vessel.cog) ? vessel.cog : 0;

    return L.divIcon({
      className: 'ais-vessel-marker',
      html: `
        <div class="ais-vessel-symbol" style="--ais-color:${color}; --ais-heading:${heading}deg;">
          <svg class="ais-vessel-ship" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path class="ais-vessel-shadow" d="M12 1.6 20.8 22.1 12 17.1 3.2 22.1 12 1.6Z"/>
            <path class="ais-vessel-arrow" d="M12 1.6 20.8 22.1 12 17.1 3.2 22.1 12 1.6Z"/>
          </svg>
        </div>
      `,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
      popupAnchor: [0, -10]
    });
  }

  function buildPopupField(label, value) {
    if (value === null || value === undefined || value === '') return '';
    return `<div class="popup-field"><div class="popup-field-label">${escapeHtml(label)}</div><div class="popup-field-value">${escapeHtml(value)}</div></div>`;
  }

  function formatCog(cog) {
    const normalized = normalizeCog(cog);
    return `${String(normalized).padStart(3, '0')}°`;
  }

  function formatTimestamp(value) {
    if (!value) return '';
    const s = String(value).trim();

    // Unix timestamp (純數字，10位秒 or 13位毫秒)
    if (/^\d{10}$/.test(s)) {
      const d = new Date(Number(s) * 1000);
      if (!isNaN(d)) return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }).replace(/\//g, '-');
    }
    if (/^\d{13}$/.test(s)) {
      const d = new Date(Number(s));
      if (!isNaN(d)) return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false }).replace(/\//g, '-');
    }

    // ISO 8601 / 常見格式：嘗試 Date 解析
    const d = new Date(s.replace(/\s/, 'T'));
    if (!isNaN(d)) {
      // 若原始字串有時區資訊就保留，否則視為台北時間
      const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(s);
      const tz = hasTimezone ? 'UTC' : 'Asia/Taipei';
      return d.toLocaleString('zh-TW', { timeZone: tz, hour12: false,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit' }).replace(/\//g, '-');
    }

    // 無法解析就原樣顯示
    return s;
  }

  function formatMidlineDistance(value) {
    if (!Number.isFinite(value)) return '';
    const side = value > 0 ? '臺灣側' : value < 0 ? '中國側' : '中線';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(1)} km（${side}）`;
  }

  function buildPopup(vessel) {
    const typeLabel = TYPE_LABELS[vessel.type] || vessel.type || '未知';
    const regionLabel = REGION_LABELS[vessel.region] || '';
    const color = TYPE_COLORS[vessel.type] || DEFAULT_COLOR;

    let html = `
      <div class="popup-header">
        <div class="ais-popup-icon" style="background:${color};">${escapeHtml((vessel.type || '?').toUpperCase())}</div>
        <h3 class="popup-title">${escapeHtml(vessel.name || '未知')}</h3>
      </div>
    `;

    html += buildPopupField('MMSI', vessel.mmsi);
    html += buildPopupField('船名', vessel.name || '未知');
    html += buildPopupField('類型', typeLabel);
    html += buildPopupField('區域', regionLabel);
    html += buildPopupField('速度', `${(Number.isFinite(vessel.sog) ? vessel.sog : 0).toFixed(1)} 節`);
    html += buildPopupField('航向', formatCog(vessel.cog));

    if (vessel.type === 'g') {
      html += buildPopupField('類別', vessel.cat);
      html += buildPopupField('中線距離', formatMidlineDistance(vessel.ml));
    }

    html += buildPopupField('最後紀錄', formatTimestamp(vessel.ts));

    return html;
  }

  function shouldUseDefaultAisView() {
    const params = new URLSearchParams(window.location.search);
    return !params.has('lat') &&
      !params.has('lng') &&
      !params.has('coords') &&
      !params.has('shape');
  }

  function render(vessels = parseVessels()) {
    if (!mapRef || !layerGroup) return [];

    layerGroup.clearLayers();
    if (!vessels.length) {
      if (shouldUseDefaultAisView()) {
        try {
          mapRef.setView(DEFAULT_AIS_CENTER, DEFAULT_AIS_ZOOM);
        } catch (_) {}
      }
      return [];
    }

    vessels.forEach(vessel => {
      const latlng = [vessel.lat, vessel.lon];
      const marker = L.marker(latlng, { icon: buildVesselIcon(vessel), zIndexOffset: 500 });
      marker.bindPopup(buildPopup(vessel), {
        className: 'custom-popup ais-popup',
        maxWidth: Math.min(420, window.innerWidth - 32),
        minWidth: Math.min(300, window.innerWidth - 48)
      });
      layerGroup.addLayer(marker);
    });

    layerGroup.addTo(mapRef);

    if (shouldUseDefaultAisView()) {
      try {
        mapRef.setView(DEFAULT_AIS_CENTER, DEFAULT_AIS_ZOOM);
      } catch (_) {}
    }

    if (typeof window.updateInfoPanel === 'function') {
      window.updateInfoPanel(`AIS 船舶快照：${vessels.length} 艘`);
    }

    return vessels;
  }

  function init(map) {
    mapRef = map || window.map;
    if (!mapRef || !window.L) return [];

    if (!layerGroup) {
      layerGroup = L.layerGroup();
      window.addEventListener('hashchange', () => render());
    }

    return render();
  }

  window.AISSnapshot = {
    init,
    render,
    hasAisHash,
    parseVessels
  };
})();
