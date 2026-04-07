/**
 * PLA 戰區圖層模組
 * 載入並管理 PLA_Theater_Commands.geojson 多邊形圖層
 * 預設關閉，可透過地圖上方切換按鈕開啟/關閉
 */

const PLA_THEATER = (() => {
  const GEOJSON_URL = './PLA_Theater_Commands.geojson';

  // 各戰區顏色設定（現代化配色）
  const THEATER_STYLES = {
    '東部戰區': { color: '#f43f5e', fillColor: '#f43f5e' },   // rose-500
    '南部戰區': { color: '#f97316', fillColor: '#f97316' },   // orange-500
    '西部戰區': { color: '#a855f7', fillColor: '#a855f7' },   // purple-500
    '北部戰區': { color: '#38bdf8', fillColor: '#38bdf8' },   // sky-400
    '中部戰區': { color: '#22c55e', fillColor: '#22c55e' },   // green-500
  };
  const DEFAULT_STYLE = { color: '#94a3b8', fillColor: '#94a3b8' };

  const LAYER_WEIGHT = 2;
  const LAYER_FILL_OPACITY = 0.10;
  const LAYER_OPACITY = 0.85;

  let _map = null;
  let _layerGroup = null;
  let _visible = false;
  let _loaded = false;
  let _btnEl = null;

  function getStyle(name) {
    const s = THEATER_STYLES[name] || DEFAULT_STYLE;
    return {
      color: s.color,
      weight: LAYER_WEIGHT,
      opacity: LAYER_OPACITY,
      fillColor: s.fillColor,
      fillOpacity: LAYER_FILL_OPACITY,
    };
  }

  async function load() {
    if (_loaded) return;
    try {
      const res = await fetch(GEOJSON_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      L.geoJSON(data, {
        style: (feature) => ({ ...getStyle(feature.properties.name || ''), className: 'theater-path' }),
        onEachFeature: (feature, layer) => {
          const name = feature.properties.name || '未知戰區';
          layer.bindPopup(`<strong>${name}</strong>`, { className: 'custom-popup' });
          layer.on('mouseover', function () {
            this.setStyle({ fillOpacity: 0.25, weight: 3 });
          });
          layer.on('mouseout', function () {
            this.setStyle({ fillOpacity: LAYER_FILL_OPACITY, weight: LAYER_WEIGHT });
          });
        },
      }).addTo(_layerGroup);

      _loaded = true;
      console.log('[PLA Theater] 圖層載入完成');
    } catch (err) {
      console.error('[PLA Theater] 載入失敗:', err);
    }
  }

  function updateBtn() {
    if (!_btnEl) return;
    if (_visible) {
      _btnEl.classList.add('active');
      _btnEl.title = '隱藏共軍戰區';
    } else {
      _btnEl.classList.remove('active');
      _btnEl.title = '顯示共軍戰區';
    }
  }

  async function toggle() {
    if (!_map) return;
    _visible = !_visible;
    if (_visible) {
      _layerGroup.addTo(_map);
      await load();
    } else {
      _map.removeLayer(_layerGroup);
    }
    updateBtn();
  }

  function init(map) {
    _map = map;
    _layerGroup = L.layerGroup();

    // 建立切換按鈕
    _btnEl = document.getElementById('theaterToggleBtn');
    if (_btnEl) {
      _btnEl.addEventListener('click', toggle);
      updateBtn();
    }
  }

  return { init, toggle };
})();

window.PLATheater = PLA_THEATER;
