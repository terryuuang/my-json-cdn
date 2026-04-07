/**
 * 防空識別區（ADIZ）圖層模組
 * 顯示中華民國防空識別區範圍及臺海中線
 * 預設關閉，白色虛線樣式
 */

const ADIZ = (() => {
  const ADIZ_GEOJSON = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { name: '中華民國防空識別區', type: 'adiz' },
        geometry: {
          type: 'Polygon',
          coordinates: [[
            [123.00, 29.00],
            [123.00, 23.00],
            [121.30, 21.00],
            [117.30, 21.00],
            [117.30, 29.00],
            [123.00, 29.00]
          ]]
        }
      },
      {
        type: 'Feature',
        properties: { name: '臺海中線', type: 'median' },
        geometry: {
          type: 'LineString',
          coordinates: [
            [122.0, 27.0],
            [118.0, 23.0]
          ]
        }
      }
    ]
  };

  const ADIZ_STYLE = {
    color: '#ffffff',
    weight: 2,
    opacity: 0.9,
    fillColor: '#ffffff',
    fillOpacity: 0.05,
    dashArray: '8, 6',
  };

  const MEDIAN_STYLE = {
    color: '#ffffff',
    weight: 1.5,
    opacity: 0.75,
    dashArray: '4, 4',
  };

  let _map = null;
  let _layerGroup = null;
  let _visible = false;
  let _btnEl = null;

  function styleFor(feature) {
    return feature.properties.type === 'median' ? MEDIAN_STYLE : ADIZ_STYLE;
  }

  function init(map) {
    _map = map;
    _layerGroup = L.layerGroup();

    L.geoJSON(ADIZ_GEOJSON, {
      style: (feature) => ({
        ...styleFor(feature),
        className: 'adiz-path',
      }),
      onEachFeature: (feature, layer) => {
        layer.bindPopup(
          `<strong>${feature.properties.name}</strong>`,
          { className: 'custom-popup' }
        );
      },
    }).addTo(_layerGroup);

    _btnEl = document.getElementById('adizToggleBtn');
    if (_btnEl) {
      _btnEl.addEventListener('click', toggle);
      updateBtn();
    }
  }

  function updateBtn() {
    if (!_btnEl) return;
    if (_visible) {
      _btnEl.classList.add('active');
      _btnEl.title = '隱藏防空識別區';
    } else {
      _btnEl.classList.remove('active');
      _btnEl.title = '顯示防空識別區';
    }
  }

  function toggle() {
    if (!_map) return;
    _visible = !_visible;
    if (_visible) {
      _layerGroup.addTo(_map);
    } else {
      _map.removeLayer(_layerGroup);
    }
    updateBtn();
  }

  return { init, toggle };
})();

window.ADIZ = ADIZ;
