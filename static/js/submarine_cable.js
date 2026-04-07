/**
 * 海底電纜圖層模組
 * 資料來源：submarinecablemap-cdn-json-20250618.json
 * 預設關閉，透過公共設施 checkbox 控制顯示
 */

const SubmarineCable = (() => {
  const GEOJSON_URL = './submarinecablemap-cdn-json-20250618.json';

  // 現代化電纜配色：用明亮、高對比的色票取代原始暗色
  // 原始資料每條電纜有自己的 color，但大量是暗灰或低飽和色
  // 策略：亮度 < 0.45 的顏色強制提升為高飽和版本，其餘保留
  const FALLBACK_COLORS = [
    '#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24',
    '#fb923c', '#60a5fa', '#e879f9', '#4ade80', '#f87171',
  ];

  function brightenColor(hex, index) {
    // 若原色過暗或接近灰色，改用 fallback 色票循環
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (luminance < 0.45 || saturation < 0.25) {
      return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    }
    return hex;
  }

  let _map = null;
  let _layerGroup = null;
  let _loaded = false;
  let _loading = false;

  function init(map) {
    _map = map;
    _layerGroup = L.layerGroup();
  }

  async function load() {
    if (_loaded || _loading) return;
    _loading = true;
    try {
      const res = await fetch(GEOJSON_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      data.features.forEach((feature, i) => {
        const rawColor = feature.properties.color || '#38bdf8';
        const color = brightenColor(rawColor, i);
        const name = feature.properties.name || '未知電纜';

        const layer = L.geoJSON(feature, {
          style: {
            color,
            weight: 2,
            opacity: 0.85,
            className: 'submarine-cable-path',
          },
        });

        layer.bindPopup(`<strong>🔌 ${name}</strong>`, { className: 'custom-popup' });
        layer.addTo(_layerGroup);
      });

      _loaded = true;
      console.log(`[SubmarineCable] 載入完成，共 ${data.features.length} 條電纜`);
    } catch (err) {
      console.error('[SubmarineCable] 載入失敗:', err);
    } finally {
      _loading = false;
    }
  }

  async function show() {
    if (!_map) return;
    _layerGroup.addTo(_map);
    await load();
  }

  function hide() {
    if (!_map) return;
    _map.removeLayer(_layerGroup);
  }

  return { init, show, hide };
})();

window.SubmarineCable = SubmarineCable;
