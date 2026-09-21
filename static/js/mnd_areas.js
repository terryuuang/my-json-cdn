// ==========================================================
// mnd_areas.js - 國防部每日通報的「活動範圍」向量圖層（預設開啟）
//
// 範圍不是在前端從圖片抓的：mnd.gov.tw 沒有 CORS 標頭，canvas 讀不到像素。
// 改由 scripts/mnd_chart_areas.py 在資料更新流程（GitHub Actions，每天三次）
// 把官方示意圖上的紅色標註向量化成經緯度環，存進 data/mnd_activity.json 的
// 每日 areas 欄位。這裡只負責畫出來。
//
// 這些是官方示意圖上標註的活動範圍，不是航跡、也不是即時位置。
// ==========================================================

window.MndAreas = (() => {
  const SOURCE = './data/mnd_activity.json';
  const STYLE = {
    className: 'mnd-area-path',   // 必須：main.css 會強制把互動路徑的 stroke 塗紅，
    color: '#dc2626',             // 需要自訂描邊的圖層都要列進那條規則的 :not() 清單
    weight: 2,
    opacity: 0.9,
    fillColor: '#ef4444',
    fillOpacity: 0.12
  };

  let map = null;
  let group = null;
  let button = null;
  let report = null;
  let visible = true;
  let loading = null;

  const escape = text => String(text ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function popupHtml() {
    const counts = [
      ['共機', report.aircraft, '架次'],
      ['共艦', report.vessels, '艘次'],
      ['公務船', report.officialShips, '艘次'],
      ['逾越中線／進入通報空域', report.reportedAreaAircraft, '架次']
    ].filter(([, value]) => Number.isFinite(value))
      .map(([label, value, unit]) => `<div class="mnd-area-count"><span>${label}</span><strong>${value}</strong>${unit}</div>`)
      .join('');
    const source = /^https:\/\/www\.mnd\.gov\.tw\/news\/plaact\//.test(report.sourceUrl || '')
      ? `<a class="link-btn" href="${escape(report.sourceUrl)}" target="_blank" rel="noopener noreferrer">國防部原始通報</a>` : '';
    return `<div class="mnd-area-popup">
      <h3>共軍活動範圍 · ${escape(report.date)}</h3>
      <div class="mnd-area-counts">${counts}</div>
      <p>國防部每日示意圖標註的活動範圍，由圖上紅色標註向量化而成。是示意範圍，不是航跡或即時位置。</p>
      <div class="mnd-area-actions">${source}
        <a class="link-btn" href="#" data-mnd-chart="1">疊加官方示意圖</a>
      </div>
    </div>`;
  }

  function draw() {
    group.clearLayers();
    if (!report || !Array.isArray(report.areas)) return;
    report.areas.forEach(ring => {
      const latlngs = ring.map(([lng, lat]) => [lat, lng]);
      if (latlngs.length < 3) return;
      L.polygon(latlngs, STYLE)
        .bindPopup(popupHtml(), { className: 'custom-popup' })
        .bindTooltip(`共軍活動範圍 · ${report.date}`, { sticky: true })
        .addTo(group);
    });
  }

  function updateButton() {
    if (!button) return;
    button.setAttribute('aria-checked', String(visible));
    button.classList.toggle('active', visible);
    button.title = visible ? '隱藏國防部通報活動範圍' : '顯示國防部通報活動範圍';
    const label = document.getElementById('mndAreasLabel');
    if (label) label.textContent = report ? `通報活動範圍（${report.date.slice(5).replace('-', '/')}）` : '通報活動範圍';
  }

  async function load() {
    if (loading) return loading;
    loading = fetch(SOURCE, { cache: 'no-cache' })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(data => {
        // 有些日子官方圖上沒有任何標註範圍（也有舊報告根本沒附圖），
        // 往前找到最近一天真的有範圍的通報，日期一律在 popup 與控制面板標清楚
        report = (data.reports || []).find(row => Array.isArray(row.areas) && row.areas.length) || null;
        draw();
        updateButton();
      })
      .catch(error => { console.warn('[MndAreas] 活動範圍載入失敗', error); })
      .finally(() => { loading = null; });
    return loading;
  }

  function setVisible(next) {
    visible = !!next;
    if (!map || !group) return;
    if (visible) {
      group.addTo(map);
      if (!report) load();
    } else if (map.hasLayer(group)) {
      map.removeLayer(group);
    }
    updateButton();
  }

  function init(mapInstance) {
    if (!mapInstance || map) return;
    map = mapInstance;
    group = L.layerGroup();

    button = document.getElementById('mndAreasToggleBtn');
    if (button) button.addEventListener('click', () => setVisible(!visible));

    // popup 裡的「疊加官方示意圖」轉交 mnd_overlay.js（同一天的原圖）
    map.on('popupopen', event => {
      const link = event.popup.getElement()?.querySelector('[data-mnd-chart]');
      if (!link || !report) return;
      link.addEventListener('click', clickEvent => {
        clickEvent.preventDefault();
        if (window.MndOverlay && report.imageUrl) window.MndOverlay.show(report.imageUrl, report.date);
      });
    });

    setVisible(true);
    load();
  }

  return { init, setVisible, isVisible: () => visible, getReport: () => report, reload: load };
})();
