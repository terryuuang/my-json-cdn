// ==========================================================
// adsb_traffic.js - 周邊航空動態（即時 ADS-B）
// 資料來源：airplanes.live（CORS 開放、免金鑰、公益社群 ADS-B 彙整服務）
// 注意：同族的 api.adsb.lol 實測沒有 CORS header 會被瀏覽器擋下，
//       OpenSky 的 CORS 只允許自己網域，故採用 airplanes.live
// ==========================================================
(function () {
  const API_BASE = 'https://api.airplanes.live/v2/point';
  const DEFAULT_RADIUS_NM = 30;
  const MAX_RADIUS_NM = 50;
  const REQUEST_TIMEOUT_MS = 8000;
  const SHORT_CACHE_MS = 15000; // 同一位置 15 秒內重複查詢直接用記憶體快取，避免使用者連點造成過度請求

  // 疑似軍事／特種航空器 heuristic（僅供線索參考，非官方確認）：
  // - squawk 7400/7401/7402：無人機資料鏈失聯（Lost C2 Link）標準代碼
  // - category B6：ADS-B 發射器類別標準定義之「無人機／遙控載具」
  // - dbFlags 最低位元：部分 ADS-B 彙整服務資料庫標記軍用機的旗標（若有提供才判斷）
  // - type/機型 ICAO 代碼命中已知軍機清單（非窮舉，僅涵蓋較常見機型）
  const UAS_LOST_LINK_SQUAWKS = new Set(['7400', '7401', '7402']);

  // 共軍（中共）機型 ICAO Type Designator，經 ICAO Doc 8643 / doc8643.com 逐一查證：
  // 【已於 doc8643.com 逐筆確認存在對應條目】
  //   Y20（西安運-20）、IL76（伊留申 Il-76，共軍亦有操作）、J10（成都殲-10）、
  //   J20（成都殲-20）、J8A（瀋陽殲-8II）、JH7（西安殲轟-7）、Y12（哈爾濱運-12）、
  //   WZ10（昌河直-10攻擊直升機）、Z9（哈爾濱直-9）
  // 【查有明確來源指出designator但未逐一連結 doc8643 頁面】
  //   J15（瀋陽殲-15艦載機）
  // 【依同一命名慣例（廠牌簡稱+型號、無連字號）推斷，未逐筆查證，僅供參考】
  //   H6（轟-6）、Y9（運-9）、Y8（運-8）、Y7（運-7）、J11（殲-11）、J16（殲-16）、
  //   Z8（直-8）、Z19（直-19）、Z20（直-20）、SU27/SU30/SU35（共軍採購之蘇霍伊系列戰機）
  // 實務上戰鬥機/攻擊直升機執行任務時極少開啟 ADS-B，能被公開 ADS-B 網站接收到的多半是
  // 運輸機/加油機/預警機這類需要在民航空域協調的機型（Y20/Y9/Y8/Y7/Y12/IL76），命中機率較高；
  // 殲擊機/武裝直升機類列入僅為完整性，實際近乎不會被偵測到。
  const KNOWN_MILITARY_TYPES = new Set([
    // 美軍/西方機型
    'F16', 'F15', 'F18', 'F35', 'A10', 'B52', 'B1', 'B2',
    'C130', 'C17', 'C5M', 'KC135', 'KC10', 'KC46',
    'E3TF', 'E3CF', 'E8', 'P8', 'P3', 'U2',
    'H60', 'UH60', 'HH60', 'MH60', 'CH47', 'V22', 'AV8B', 'T38',
    // 共軍運輸/加油/預警機類（命中機率較高）
    'Y20', 'Y9', 'Y8', 'Y7', 'Y12', 'IL76',
    // 共軍轟炸/殲擊機類（幾乎不開 ADS-B，列入僅供完整性）
    'H6', 'J8A', 'JH7', 'J10', 'J11', 'J15', 'J16', 'J20',
    'SU27', 'SU30', 'SU35',
    // 共軍直升機類（幾乎不開 ADS-B，列入僅供完整性）
    'Z9', 'Z8', 'Z19', 'Z20', 'WZ10'
  ]);

  let cache = new Map(); // key: "lat,lng,radius" -> { timestamp, data }
  let dialogEl = null;
  let markerLayerGroup = null;
  let queryMarkers = []; // 全部預設點模式：查詢點圖釘
  let currentAircraftList = []; // 目前結果清單（供「這是什麼？」查維基百科用）
  let currentRequestToken = 0;
  let unitsVisibleBeforeQuery = null;

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function isProbablyMilitary(ac) {
    if (ac.squawk && UAS_LOST_LINK_SQUAWKS.has(String(ac.squawk))) return true;
    if (ac.category === 'B6') return true;
    if (typeof ac.dbFlags === 'number' && (ac.dbFlags & 1) === 1) return true;
    if (ac.t && KNOWN_MILITARY_TYPES.has(String(ac.t).toUpperCase())) return true;
    return false;
  }

  // 查詢時暫時隱藏軍事單位圖示，避免畫面上圖示太多、看不清楚查詢結果
  function hideUnitsForQuery() {
    try {
      if (typeof unitsVisible === 'undefined') return;
      if (unitsVisibleBeforeQuery === null) unitsVisibleBeforeQuery = unitsVisible;
      if (unitsVisible) {
        unitsVisible = false;
        if (typeof applyUnitVisibility === 'function') applyUnitVisibility();
      }
    } catch (_) { /* 忽略 */ }
  }

  function restoreUnitsAfterQuery() {
    try {
      if (unitsVisibleBeforeQuery === true && typeof unitsVisible !== 'undefined') {
        unitsVisible = true;
        if (typeof applyUnitVisibility === 'function') applyUnitVisibility();
      }
    } catch (_) { /* 忽略 */ }
    unitsVisibleBeforeQuery = null;
  }

  async function fetchNearbyAircraft(lat, lng, radiusNm) {
    const cacheKey = `${lat.toFixed(3)},${lng.toFixed(3)},${radiusNm}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < SHORT_CACHE_MS) {
      return cached.data;
    }

    const url = `${API_BASE}/${lat}/${lng}/${radiusNm}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`airplanes.live 回應錯誤（${resp.status}）`);
      const data = await resp.json();
      const list = Array.isArray(data.ac) ? data.ac : [];
      cache.set(cacheKey, { timestamp: Date.now(), data: list });
      return list;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ----------------------------------------------------------
  // 地圖圖示（比照 ais_snapshot.js 依航向旋轉圖示的手法）
  // ----------------------------------------------------------
  function createPlaneIcon(heading, isMilitary) {
    // 提高辨識度：加大尺寸、白色描邊（比照 ais_snapshot.js 船隻圖示的白邊處理手法）+ 陰影
    const color = isMilitary ? '#f97316' : '#2563eb';
    const rotation = Number.isFinite(heading) ? heading : 0;
    return L.divIcon({
      className: 'adsb-plane-marker',
      html: `<svg class="adsb-plane-icon" style="--adsb-heading:${rotation}deg" viewBox="0 0 24 24" fill="${color}" stroke="white" stroke-width="1.2" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2l2 6 7 4v2l-7-1.5V19l3 2v1.5l-5-1.5-5 1.5V21l3-2v-6.5L2 14v-2l7-4 2-6z"/>
      </svg>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });
  }

  function createQueryPointIcon() {
    return L.divIcon({
      className: 'sat-query-marker-wrapper',
      html: `<div class="sat-query-marker" style="background:none;">
        <svg class="sat-query-marker-icon" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none" xmlns="http://www.w3.org/2000/svg" style="background:#2563eb;">
          <path d="M12 2l2 6 7 4v2l-7-1.5V19l3 2v1.5l-5-1.5-5 1.5V21l3-2v-6.5L2 14v-2l7-4 2-6z"/>
        </svg>
      </div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -11]
    });
  }

  function renderMapMarkers(map, aircraftList) {
    if (!map) return;
    if (!markerLayerGroup) {
      markerLayerGroup = L.layerGroup().addTo(map);
    }
    markerLayerGroup.clearLayers();

    aircraftList.forEach(ac => {
      if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) return;
      const heading = ac.track ?? ac.true_heading ?? ac.mag_heading;
      const marker = L.marker([ac.lat, ac.lon], { icon: createPlaneIcon(heading, isProbablyMilitary(ac)) });
      marker.bindPopup(buildAircraftPopupHtml(ac), { className: 'custom-popup', minWidth: 220, maxWidth: 300 });
      // 比照軍事單位 popup 的做法：第一次開啟 popup 時才觸發維基百科查詢，
      // 避免地圖上飛機一多就同時發出大量請求
      marker.once('popupopen', () => processAircraftWikiAsync(marker, ac));
      markerLayerGroup.addLayer(marker);
    });
  }

  // 比照 markers_render.js 的 processEquipmentAsync：popup 開啟時才查詢，查完直接把結果
  // 寫回目前的 popup 內容，而不是像清單那樣要使用者另外按「這是什麼？」按鈕
  async function processAircraftWikiAsync(marker, ac) {
    if (marker._wikiParsingStarted) return;
    marker._wikiParsingStarted = true;

    const searchName = (ac.desc || ac.t || '').trim();
    if (!searchName || !window.equipmentParser) return;

    const injectIntoPopup = (html) => {
      const applyTo = (popup) => {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popup.getContent();
        const existing = tempDiv.querySelector('.adsb-popup-wiki');
        if (existing) existing.remove();
        tempDiv.insertAdjacentHTML('beforeend', html);
        popup.setContent(tempDiv.innerHTML);
      };
      const openPopup = marker.getPopup();
      if (openPopup && openPopup.isOpen()) {
        applyTo(openPopup);
      } else {
        marker.once('popupopen', (e) => applyTo(e.popup));
      }
    };

    const sectionLabel = `<div class="osint-wiki-section-label">機型資訊</div>`;
    const loadingDelay = (typeof isMobileDevice === 'function' && isMobileDevice()) ? 500 : 1000;
    const loadingTimer = setTimeout(() => {
      injectIntoPopup(`<div class="osint-wiki-section adsb-popup-wiki">${sectionLabel}<div class="osint-wiki-loading"><span class="osint-spinner"></span>正在查詢維基百科資料...</div></div>`);
    }, loadingDelay);

    try {
      const info = await window.equipmentParser.fetchWeaponInfo(searchName);
      clearTimeout(loadingTimer);
      injectIntoPopup(`<div class="osint-wiki-section adsb-popup-wiki">${sectionLabel}${renderWikiInfoHtml(info, searchName)}</div>`);
    } catch (error) {
      clearTimeout(loadingTimer);
      injectIntoPopup(`<div class="osint-wiki-section adsb-popup-wiki">${sectionLabel}<div class="osint-wiki-empty">查詢維基百科失敗</div></div>`);
    }
  }

  function buildAircraftPopupHtml(ac) {
    const flight = (ac.flight || ac.hex || '未知呼號').trim();
    const desc = ac.desc || ac.t || '';
    const altitude = Number.isFinite(ac.alt_baro) ? `${ac.alt_baro} 呎` : '未知';
    const speed = Number.isFinite(ac.gs) ? `${Math.round(ac.gs)} 節` : '未知';
    const militaryBadge = isProbablyMilitary(ac)
      ? '<span class="adsb-item-military-badge" title="依機型/信號特徵推測，非官方確認，非公開資料庫查證">疑似軍機</span>'
      : '';
    return `
      <div class="popup-header"><h3 class="popup-title">${escapeHtml(flight)}</h3>${militaryBadge}</div>
      <div class="popup-field"><div class="popup-field-label">機型</div><div class="popup-field-value">${escapeHtml(desc || '未知')}</div></div>
      <div class="popup-field"><div class="popup-field-label">高度</div><div class="popup-field-value">${altitude}</div></div>
      <div class="popup-field"><div class="popup-field-label">地速</div><div class="popup-field-value">${speed}</div></div>
      <div class="popup-field"><div class="popup-field-label">航向</div><div class="popup-field-value">${Number.isFinite(ac.track) ? `${Math.round(ac.track)}°` : '未知'}</div></div>
    `;
  }

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------
  function clearQueryMarkers() {
    queryMarkers.forEach(m => {
      try { window.map.removeLayer(m); } catch (_) { /* 忽略 */ }
    });
    queryMarkers = [];
  }

  function closeDialog() {
    if (dialogEl && dialogEl.parentNode) {
      dialogEl.parentNode.removeChild(dialogEl);
    }
    dialogEl = null;
    if (markerLayerGroup) {
      markerLayerGroup.clearLayers();
    }
    clearQueryMarkers();
    restoreUnitsAfterQuery();
  }

  // 快速定位 chip：預設查詢點常常沒有航班可看，提供中國沿岸／台灣沿岸常用點位，
  // 並加一個「全部預設點」選項一次看所有點位（預設模式，除非使用者指定單一點位）
  function renderPresetChips(mode) {
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    const allChip = `<button type="button" class="osint-preset-chip${mode === 'all' ? ' active' : ''}" data-preset-index="all">全部預設點</button>`;
    const chips = presets.map((p, i) => `<button type="button" class="osint-preset-chip" data-preset-index="${i}">${escapeHtml(p.label)}</button>`).join('');
    return allChip + chips;
  }

  // 把地圖飛到查詢點，讓使用者能實際看到周邊航空動態對應的位置
  // （面板改為右側/底部的側欄樣式、不遮擋地圖，見 .osint-side-panel 樣式）
  function flyToLocation(lat, lng) {
    if (!window.map) return;
    clearQueryMarkers();
    window.map.flyTo([lat, lng], Math.max(window.map.getZoom(), 9), { duration: 1 });
  }

  // 全部預設點模式：每個點位放一顆小圖釘、自動調整 zoom 讓所有點位都在畫面內
  function flyToAllPresets() {
    if (!window.map || !window.L) return;
    clearQueryMarkers();
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    const bounds = [];
    presets.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { icon: createQueryPointIcon() })
        .addTo(window.map)
        .bindPopup(`<div class="popup-header"><h3 class="popup-title">查詢點</h3></div><div class="popup-field"><div class="popup-field-label">位置</div><div class="popup-field-value">${escapeHtml(p.label)}</div></div>`, { className: 'custom-popup', minWidth: 200, maxWidth: 280 });
      queryMarkers.push(marker);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length) {
      window.map.flyToBounds(L.latLngBounds(bounds), { padding: [70, 70], maxZoom: 8, duration: 1 });
    }
  }

  function openAdsbTrafficPanel(lat, lng, label, options = {}) {
    const { allPresets = false } = options;
    closeDialog();

    let currentMode = allPresets ? 'all' : 'single';
    let currentLat = lat;
    let currentLng = lng;
    let currentLabel = label;

    hideUnitsForQuery();

    if (currentMode === 'all') {
      flyToAllPresets();
    } else {
      flyToLocation(currentLat, currentLng);
    }

    dialogEl = document.createElement('div');
    dialogEl.className = 'note-dialog-overlay osint-side-panel';
    dialogEl.innerHTML = `
      <div class="note-dialog note-dialog-large">
        <div class="note-dialog-header">
          <h3>周邊航空動態</h3>
          <button class="note-dialog-close" aria-label="關閉">&times;</button>
        </div>
        <div class="note-dialog-body">
          <div class="note-dialog-feature" data-role="location-label"></div>
          <div class="osint-preset-chip-list">${renderPresetChips(currentMode)}</div>
          <div class="note-dialog-info adsb-disclaimer">
            <span>資料來自公開 ADS-B 彙整服務，僅涵蓋有開啟並被地面站接收到 ADS-B 訊號的航空器，「疑似軍事」標記為機型/信號特徵推測，非官方確認；查詢時已暫時隱藏軍事單位圖示，關閉面板後恢復</span>
          </div>
          <div class="adsb-toolbar">
            <span class="note-dialog-info" id="adsbUpdatedAt"></span>
            <button class="note-btn note-btn-secondary note-btn-sm" data-action="refresh">重新整理</button>
          </div>
          <div class="adsb-results" data-state="idle"></div>
        </div>
        <div class="note-dialog-footer">
          <button class="note-btn note-btn-secondary" data-action="close">關閉</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialogEl);

    const locationLabelEl = dialogEl.querySelector('[data-role="location-label"]');
    function refreshLocationLabel() {
      if (currentMode === 'all') {
        const count = (window.OSINT_PRESET_LOCATIONS || []).length;
        locationLabelEl.textContent = `查詢位置：全部預設點（共 ${count} 處，各半徑 ${DEFAULT_RADIUS_NM} 浬）`;
      } else {
        locationLabelEl.textContent = `查詢位置：${currentLabel ? currentLabel : `緯度 ${currentLat.toFixed(4)}, 經度 ${currentLng.toFixed(4)}`}（半徑 ${DEFAULT_RADIUS_NM} 浬）`;
      }
    }
    refreshLocationLabel();

    function setActiveChip(presetIndexAttr) {
      dialogEl.querySelectorAll('.osint-preset-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.presetIndex === presetIndexAttr);
      });
    }
    setActiveChip(currentMode === 'all' ? 'all' : null);

    function runCurrentQuery() {
      if (currentMode === 'all') {
        runQueryAllPresets();
      } else {
        runQuery(currentLat, currentLng);
      }
    }

    dialogEl.addEventListener('click', (e) => {
      if (e.target === dialogEl) closeDialog();
    });
    dialogEl.querySelector('.note-dialog-close').addEventListener('click', closeDialog);
    dialogEl.querySelector('[data-action="close"]').addEventListener('click', closeDialog);
    dialogEl.querySelectorAll('.osint-preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.presetIndex === 'all') {
          currentMode = 'all';
          flyToAllPresets();
        } else {
          const preset = (window.OSINT_PRESET_LOCATIONS || [])[parseInt(btn.dataset.presetIndex, 10)];
          if (!preset) return;
          currentMode = 'single';
          currentLat = preset.lat;
          currentLng = preset.lng;
          currentLabel = preset.label;
          flyToLocation(currentLat, currentLng);
        }
        refreshLocationLabel();
        setActiveChip(btn.dataset.presetIndex);
        runCurrentQuery();
      });
    });
    dialogEl.querySelector('[data-action="refresh"]').addEventListener('click', runCurrentQuery);

    // 結果清單用事件代理，容器只在每次查詢時換 innerHTML，掛一次即可
    dialogEl.querySelector('.adsb-results').addEventListener('click', handleResultsClick);

    runCurrentQuery();
  }

  // 點擊「這是什麼？」：展開/收合該機型的維基百科簡介（沿用 equipment_parser.js 的查詢邏輯，
  // 內建搜尋比對，解決機型全名跟維基百科實際標題不完全一致的問題）
  async function handleResultsClick(e) {
    const wikiBtn = e.target.closest('[data-action="wiki"]');
    if (!wikiBtn) return;
    const resultsEl = e.currentTarget;
    const idx = parseInt(wikiBtn.dataset.index, 10);
    const ac = currentAircraftList[idx];
    const container = resultsEl.querySelector(`.adsb-item-wiki[data-wiki-for="${idx}"]`);
    if (!ac || !container) return;

    if (container.dataset.loaded === '1') {
      container.style.display = container.style.display === 'none' ? 'block' : 'none';
      return;
    }
    container.style.display = 'block';
    container.dataset.loaded = '1';
    container.innerHTML = `<div class="osint-wiki-loading"><span class="osint-spinner"></span>正在查詢維基百科...</div>`;
    const searchName = ac.desc || ac.t || ac.flight || '';
    try {
      const info = window.equipmentParser ? await window.equipmentParser.fetchWeaponInfo(searchName) : null;
      container.innerHTML = renderWikiInfoHtml(info, searchName);
    } catch (err) {
      container.innerHTML = `<div class="osint-wiki-empty">查詢維基百科失敗</div>`;
    }
  }

  // 查完維基百科後，以 Apple 風格的圖文卡片呈現簡介＋縮圖
  function renderWikiInfoHtml(info, fallbackName) {
    if (!info) {
      return `<div class="osint-wiki-empty">維基百科查無「${escapeHtml(fallbackName)}」的相關資訊</div>`;
    }
    const mediaHtml = info.thumbnail
      ? `<div class="osint-wiki-card-media"><img src="${info.thumbnail}" alt="${escapeHtml(info.title || fallbackName)}" loading="lazy"></div>`
      : '';
    const linkHtml = info.wikipediaUrl
      ? `<a href="${info.wikipediaUrl}" target="_blank" rel="noopener noreferrer" class="osint-wiki-card-link">維基百科原文</a>`
      : '';
    return `
      <div class="osint-wiki-card">
        ${mediaHtml}
        <div class="osint-wiki-card-body">
          <div class="osint-wiki-card-title">${escapeHtml(info.title || fallbackName)}</div>
          <div class="osint-wiki-card-desc">${escapeHtml(info.description || '（無簡介）')}</div>
          ${linkHtml}
        </div>
      </div>
    `;
  }

  function renderAircraftItemHtml(ac, i) {
    const flight = (ac.flight || ac.hex || '未知呼號').trim();
    const desc = ac.desc || ac.t || '未知機型';
    const altitude = Number.isFinite(ac.alt_baro) ? `${ac.alt_baro} 呎` : '高度未知';
    const speed = Number.isFinite(ac.gs) ? `${Math.round(ac.gs)} 節` : '速度未知';
    const dist = Number.isFinite(ac.dst) ? `${ac.dst.toFixed(1)} 浬` : '距離未知';
    const militaryBadge = isProbablyMilitary(ac)
      ? '<span class="adsb-item-military-badge">疑似軍機</span>'
      : '';
    const presetTag = ac._presetLabel ? `<span class="sat-pass-item-hint">${escapeHtml(ac._presetLabel)}</span>` : '';
    return `
      <div class="adsb-item">
        <div class="adsb-item-main">
          <div class="adsb-item-callsign">${escapeHtml(flight)}</div>
          ${militaryBadge}
        </div>
        <div class="adsb-item-type">${escapeHtml(desc)} ${presetTag}</div>
        <div class="adsb-item-detail">
          <span>${altitude}</span>
          <span>${speed}</span>
          <span>距查詢點 ${dist}</span>
        </div>
        <div class="adsb-item-actions">
          <button type="button" class="link-btn" data-action="wiki" data-index="${i}">這是什麼機型？</button>
        </div>
        <div class="adsb-item-wiki" data-wiki-for="${i}" style="display:none;"></div>
      </div>
    `;
  }

  async function runQuery(lat, lng) {
    const resultsEl = dialogEl && dialogEl.querySelector('.adsb-results');
    const updatedAtEl = dialogEl && dialogEl.querySelector('#adsbUpdatedAt');
    if (!resultsEl) return;

    const token = ++currentRequestToken;
    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = `<div class="equipment-loading">正在查詢周邊航空動態...</div>`;

    try {
      const radiusNm = Math.min(DEFAULT_RADIUS_NM, MAX_RADIUS_NM);
      const list = await fetchNearbyAircraft(lat, lng, radiusNm);
      if (token !== currentRequestToken) return;

      if (updatedAtEl) {
        updatedAtEl.textContent = `更新時間：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`;
      }

      renderMapMarkers(window.map, list);

      if (list.length === 0) {
        resultsEl.dataset.state = 'empty';
        resultsEl.innerHTML = `<div class="adsb-empty">目前半徑 ${radiusNm} 浬內沒有偵測到航空器</div>`;
        return;
      }

      const sorted = list.slice().sort((a, b) => (a.dst ?? 999) - (b.dst ?? 999));
      resultsEl.dataset.state = 'success';
      currentAircraftList = sorted;
      resultsEl.innerHTML = sorted.map((ac, i) => renderAircraftItemHtml(ac, i)).join('');
    } catch (error) {
      if (token !== currentRequestToken) return;
      console.error('[AdsbTraffic] 查詢失敗:', error);
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="adsb-empty">查詢失敗（可能是網路問題或服務暫時無法連線），請稍後再試</div>`;
    }
  }

  // 全部預設點模式：平行查詢每個預設點附近的航空器，依 hex 去重後合併顯示
  async function runQueryAllPresets() {
    const resultsEl = dialogEl && dialogEl.querySelector('.adsb-results');
    const updatedAtEl = dialogEl && dialogEl.querySelector('#adsbUpdatedAt');
    if (!resultsEl) return;

    const token = ++currentRequestToken;
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    if (presets.length === 0) {
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="adsb-empty">沒有可用的預設點位</div>`;
      return;
    }

    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = `<div class="equipment-loading">正在查詢全部預設點的周邊航空動態...</div>`;

    try {
      const radiusNm = Math.min(DEFAULT_RADIUS_NM, MAX_RADIUS_NM);
      const listsByPreset = await Promise.all(presets.map(p =>
        fetchNearbyAircraft(p.lat, p.lng, radiusNm)
          .then(list => list.map(ac => ({ ...ac, _presetLabel: p.label })))
          .catch(err => {
            console.warn(`[AdsbTraffic] ${p.label} 查詢失敗:`, err);
            return [];
          })
      ));

      if (token !== currentRequestToken) return;

      // 依 hex（機身識別碼）去重，同一架飛機若同時落在多個預設點半徑內只留一筆
      const merged = new Map();
      listsByPreset.flat().forEach(ac => {
        const key = ac.hex || `${ac.flight || ''}-${ac.lat}-${ac.lon}`;
        if (!merged.has(key)) merged.set(key, ac);
      });
      const list = Array.from(merged.values());

      if (updatedAtEl) {
        updatedAtEl.textContent = `更新時間：${new Date().toLocaleTimeString('zh-TW', { hour12: false })}`;
      }

      renderMapMarkers(window.map, list);

      if (list.length === 0) {
        resultsEl.dataset.state = 'empty';
        resultsEl.innerHTML = `<div class="adsb-empty">全部預設點半徑 ${radiusNm} 浬內都沒有偵測到航空器</div>`;
        return;
      }

      const sorted = list.slice().sort((a, b) => (a.dst ?? 999) - (b.dst ?? 999));
      resultsEl.dataset.state = 'success';
      currentAircraftList = sorted;
      resultsEl.innerHTML = sorted.map((ac, i) => renderAircraftItemHtml(ac, i)).join('');
    } catch (error) {
      if (token !== currentRequestToken) return;
      console.error('[AdsbTraffic] 全部預設點查詢失敗:', error);
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="adsb-empty">查詢失敗（可能是網路問題或服務暫時無法連線），請稍後再試</div>`;
    }
  }

  window.openAdsbTrafficPanel = openAdsbTrafficPanel;
  // 供 popup 內連結按鈕使用（指定單一設施＝使用者已指定點位）
  window.openAdsbTrafficPanelFromEl = function(el) {
    const lat = parseFloat(el.dataset.lat);
    const lng = parseFloat(el.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    openAdsbTrafficPanel(lat, lng, el.dataset.label || '');
  };
  // 供地圖工具列使用：預設一次查看全部預設點
  window.openAdsbTrafficPanelAllPresets = function() {
    openAdsbTrafficPanel(null, null, '', { allPresets: true });
  };
})();
