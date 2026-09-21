// ==========================================================
// mnd_overlay.js - 國防部每日「臺海周邊海、空域活動示意圖」地圖疊加
//
// 為什麼可以直接疊：官方示意圖本身是帶經緯格線的網麥卡托（Web Mercator）製圖，
// 與 Leaflet 的投影相同，所以只要知道圖框格線落在哪些像素，就能把整張圖換算成
// 一組 LatLngBounds 精準貼上去，而不是「大概對一下」。
//
// 量測自 2026-09 的官方原圖（連續多日檢查皆相同）：
//   影像 720×1040；經線 117°E 在 x=124、123°E 在 x=612.5（81.42 px/度）
//   緯線 29°N 在 y=181、21°N 在 y=901，其餘緯線與麥卡托預測值誤差 <0.4 px
// 由此外推整張圖（含標題與圖例留白）的四角座標即為 IMAGE_BOUNDS。
//
// 安全閥：每次載入都檢查原圖尺寸是否仍是 720×1040。國防部若換了版面，
// 舊的像素基準就不再成立，此時寧可不疊也不要把位置畫錯。
// ==========================================================

window.MndOverlay = (() => {
  const TEMPLATE = { width: 720, height: 1040 };
  const IMAGE_BOUNDS = [[19.39890, 115.47697], [30.92455, 124.32037]];
  // 圖框本身（格線範圍）——縮放時用這個，避免把整片留白也框進畫面
  const FRAME_BOUNDS = [[21, 117], [29, 123]];
  const DEFAULT_OPACITY = 0.75;

  let map = null;
  let layer = null;
  let bar = null;
  let opacity = DEFAULT_OPACITY;
  let currentDate = '';

  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div');
    bar.className = 'mnd-overlay-bar';
    bar.hidden = true;
    bar.innerHTML = `
      <span class="mnd-overlay-title"></span>
      <label class="mnd-overlay-opacity">
        <span>透明度</span>
        <input type="range" min="20" max="100" step="5" aria-label="示意圖透明度">
      </label>
      <button type="button" class="mnd-overlay-close">移除</button>`;
    const slider = bar.querySelector('input');
    slider.value = String(Math.round(opacity * 100));
    slider.addEventListener('input', () => {
      opacity = Number(slider.value) / 100;
      layer?.setOpacity(opacity);
    });
    bar.querySelector('.mnd-overlay-close').addEventListener('click', hide);
    document.body.appendChild(bar);
    return bar;
  }

  function fail(message) {
    hide();
    window.IslandActivity?.transient(message, 'warning');
  }

  function show(imageUrl, date) {
    if (!imageUrl || !window.map || !window.L) return;
    map = window.map;
    currentDate = date || '';

    if (layer) {
      layer.setUrl(imageUrl);
    } else {
      layer = L.imageOverlay(imageUrl, IMAGE_BOUNDS, {
        opacity,
        interactive: false,
        className: 'mnd-overlay-image',
        alt: '國防部臺海周邊海、空域活動示意圖疊加'
      }).addTo(map);
      layer.on('error', () => fail('官方示意圖載入失敗，已移除疊加'));
    }

    // 尺寸驗證只能在圖片真的載入後做；setUrl 會重新觸發 load
    layer.once('load', () => {
      const element = layer?.getElement();
      if (!element) return;
      if (element.naturalWidth !== TEMPLATE.width || element.naturalHeight !== TEMPLATE.height) {
        fail('官方示意圖版面與圖臺的定位基準不符，已移除疊加');
      }
    });

    layer.setOpacity(opacity);
    ensureBar();
    bar.querySelector('.mnd-overlay-title').textContent = `國防部示意圖 · ${currentDate}`;
    bar.hidden = false;
    map.fitBounds(FRAME_BOUNDS, { padding: [24, 60], animate: false });
  }

  function hide() {
    if (layer && map) map.removeLayer(layer);
    layer = null;
    if (bar) bar.hidden = true;
  }

  return { show, hide, isVisible: () => !!layer, getDate: () => currentDate };
})();
