/**
 * 12/24 海浬圖層模組
 * 預設關閉；AIS hash 快照頁面自動顯示。
 */

const MaritimeZones = (() => {
  const LAYER_DEFS = [
    {
      url: 'static/geojson/taiwan_24nm.geojson',
      label: '24 海浬鄰接區',
      color: '#f59e0b',
      fillOpacity: 0.06,
      weight: 2,
      dashArray: '10, 6'
    },
    {
      url: 'static/geojson/taiwan_12nm.geojson',
      label: '12 海浬領海',
      color: '#22d3ee',
      fillOpacity: 0.08,
      weight: 2.5,
      dashArray: null
    }
  ];

  let _map = null;
  let _layerGroup = null;
  let _visible = false;
  let _loaded = false;
  let _loadingPromise = null;
  let _btnEl = null;

  function hasAisHash() {
    const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
    return hash === 'ais' || hash.startsWith('ais=');
  }

  function addGeoJson(data, def) {
    L.geoJSON(data, {
      style: () => ({
        color: def.color,
        weight: def.weight,
        opacity: 0.95,
        fillColor: def.color,
        fillOpacity: def.fillOpacity,
        dashArray: def.dashArray,
        className: 'maritime-zone-path'
      })
    }).addTo(_layerGroup);
  }

  async function load() {
    if (_loaded) return;
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = Promise.all(LAYER_DEFS.map(async (def) => {
      const res = await fetch(def.url);
      if (!res.ok) throw new Error(`${def.label} HTTP ${res.status}`);
      const data = await res.json();
      addGeoJson(data, def);
    }))
      .then(() => {
        _loaded = true;
        console.log('[MaritimeZones] 圖層載入完成');
      })
      .catch((err) => {
        console.error('[MaritimeZones] 載入失敗:', err);
      })
      .finally(() => {
        _loadingPromise = null;
      });

    return _loadingPromise;
  }

  function updateBtn() {
    if (!_btnEl) return;
    if (_visible) {
      _btnEl.classList.add('active');
      _btnEl.title = '隱藏 12/24 海浬線';
    } else {
      _btnEl.classList.remove('active');
      _btnEl.title = '顯示 12/24 海浬線';
    }
  }

  async function setVisible(visible) {
    if (!_map || !_layerGroup) return;
    _visible = !!visible;

    if (_visible) {
      _layerGroup.addTo(_map);
      await load();
    } else if (_map.hasLayer(_layerGroup)) {
      _map.removeLayer(_layerGroup);
    }

    updateBtn();
  }

  function toggle() {
    return setVisible(!_visible);
  }

  function init(map, options = {}) {
    _map = map;
    _layerGroup = L.layerGroup();
    _btnEl = document.getElementById('maritimeZonesToggleBtn');

    if (_btnEl) {
      _btnEl.addEventListener('click', toggle);
      updateBtn();
    }

    window.addEventListener('hashchange', () => {
      if (hasAisHash()) setVisible(true);
    });

    if (options.visible || hasAisHash()) {
      setVisible(true);
    }
  }

  return { init, toggle, setVisible, hasAisHash };
})();

window.MaritimeZones = MaritimeZones;
