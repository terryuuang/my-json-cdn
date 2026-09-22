/**
 * PLA 戰區圖層模組
 * 載入並管理 PLA_Theater_Commands.geojson 多邊形圖層
 * 預設關閉，可透過地圖上方切換按鈕開啟/關閉
 */

const PLA_THEATER = (() => {
  const GEOJSON_URL = './geojson/PLA_Theater_Commands.geojson';

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
  let _data = null;
  let _loading = null;
  let _selection = null;
  let _revision = 0;
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
    if (_data) return _data;
    if (!_loading) {
      _loading = (async () => {
        const res = await fetch(GEOJSON_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!Array.isArray(data.features)) throw new Error('戰區資料格式錯誤');
        _data = data;
        return data;
      })().finally(() => { _loading = null; });
    }
    return _loading;
  }

  function syncUrl() {
    // 走 UrlParams：theater= 若原本來自 #，就得寫回 #，否則會被 # 覆蓋而無效
    const params = window.UrlParams.read();
    if (_visible) params.set('theater', _selection || 'all');
    else params.delete('theater');
    window.UrlParams.commit(params);
  }

  async function show(name = null, { fit = true } = {}) {
    if (!_map) throw new Error('地圖尚未載入');
    if (name && !THEATER_STYLES[name]) throw new Error('未知戰區');
    const revision = ++_revision;
    const data = await load();
    if (revision !== _revision) return;
    const features = data.features.filter(feature => !name || feature.properties.name === name);
    if (!features.length) throw new Error('找不到此戰區範圍');
    _layerGroup.clearLayers();
    _layerGroup.addData({ type: 'FeatureCollection', features });
    _layerGroup.addTo(_map);
    _selection = name;
    _visible = true;
    updateBtn();
    syncUrl();
    if (fit) _map.fitBounds(_layerGroup.getBounds(), { padding: [24, 72], animate: false });
  }

  function updateBtn() {
    if (!_btnEl) return;
    _btnEl.setAttribute('aria-checked', String(_visible));
    if (_visible) {
      _btnEl.classList.add('active');
      _btnEl.title = `隱藏${_selection || '共軍戰區'}`;
    } else {
      _btnEl.classList.remove('active');
      _btnEl.title = '顯示共軍戰區';
    }
  }

  async function toggle() {
    if (!_map) return;
    if (_visible) {
      ++_revision;
      _map.removeLayer(_layerGroup);
      _visible = false;
      updateBtn();
      syncUrl();
    } else {
      try { await show(null, { fit: false }); }
      catch (_) { window.IslandActivity?.transient('戰區載入失敗，請再試一次', 'error'); }
    }
  }

  function init(map) {
    _map = map;
    _layerGroup = L.geoJSON(null, {
      style: feature => ({ ...getStyle(feature.properties.name), className: 'theater-path' }),
      onEachFeature: (feature, layer) => {
        const title = document.createElement('strong');
        title.textContent = feature.properties.name;
        layer.bindPopup(title, { className: 'custom-popup' });
        layer.on('mouseover', () => layer.setStyle({ fillOpacity: 0.25, weight: 3 }));
        layer.on('mouseout', () => layer.setStyle({ fillOpacity: LAYER_FILL_OPACITY, weight: LAYER_WEIGHT }));
      }
    });

    // 建立切換按鈕
    _btnEl = document.getElementById('theaterToggleBtn');
    if (_btnEl) {
      _btnEl.addEventListener('click', toggle);
      updateBtn();
    }
    const initial = window.UrlParams.read().get('theater');
    if (initial === 'all' || THEATER_STYLES[initial]) {
      show(initial === 'all' ? null : initial, { fit: false }).catch(() => {
        window.IslandActivity?.transient('戰區載入失敗，請再試一次', 'error');
      });
    }
  }

  return { init, toggle, show };
})();

window.PLATheater = PLA_THEATER;
