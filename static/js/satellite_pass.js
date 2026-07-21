// ==========================================================
// satellite_pass.js - 衛星過境預測
// 資料來源：Celestrak GP/TLE API（CORS 開放，免金鑰，官方要求 2 小時才更新一次）
// 軌道計算：satellite.js（SGP4，純前端運算，不需額外打 API）
// ==========================================================
(function () {
  const CACHE_PREFIX = 'satTleCache:';
  const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 小時（Celestrak 本身 2 小時才更新，前端沒必要更頻繁請求）
  const SELECTED_CATEGORIES_KEY = 'satPassSelectedCategories';
  const MIN_ELEVATION_DEG = 10; // 低於此仰角視為訊號/可視角太差，不列入
  const LOOKAHEAD_HOURS = 48;
  const COARSE_STEP_SEC = 120; // 2 分鐘粗掃間隔
  const MAX_PASSES_PER_SAT = 3;
  const MAX_RESULTS = 30;
  const REQUEST_TIMEOUT_MS = 10000;
  const CHUNK_SIZE = 5; // 每批處理幾顆衛星後讓出主執行緒

  // 衛星類別：對照真實 OSINT 常用的地球觀測/偵察衛星家族
  const CATEGORIES = [
    { id: 'landsat', label: 'Landsat（美國地球資源）', query: { NAME: 'LANDSAT' } },
    { id: 'sentinel', label: 'Sentinel（歐洲哥白尼）', query: { NAME: 'SENTINEL' } },
    { id: 'pleiades', label: 'Pleiades（法國高解析）', query: { NAME: 'PLEIADES' } },
    { id: 'worldview', label: 'WorldView / GeoEye（美商高解析）', query: { NAME: 'WORLDVIEW' } },
    { id: 'gaofen', label: '高分系列（中國）', query: { NAME: 'GAOFEN' } },
    { id: 'yaogan', label: '遙感系列（中國偵察衛星）', query: { NAME: 'YAOGAN' } },
    { id: 'planet', label: 'Planet SkySat/Dove（高重訪率商用）', query: { GROUP: 'planet' } }
  ];
  const DEFAULT_SELECTED = ['landsat', 'sentinel'];

  let dialogEl = null;
  let currentRequestToken = 0;
  let queryMarker = null; // 單點模式：地圖上標示目前查詢座標的圖釘
  let queryMarkers = []; // 全部預設點模式：多個查詢圖釘
  let currentPasses = []; // 目前結果清單（供點選項目時取回 TLE 重新計算地面軌跡）
  let groundTrackLayer = null; // 目前顯示中的地面軌跡圖層
  let selectedPassIndex = -1;
  let unitsVisibleBeforeQuery = null; // 查詢前的單位顯示狀態，關閉面板時還原

  // ----------------------------------------------------------
  // 查詢時暫時隱藏軍事單位圖示，避免畫面上圖示太多、看不清楚查詢結果
  // ----------------------------------------------------------
  function hideUnitsForQuery() {
    try {
      if (typeof unitsVisible === 'undefined') return;
      if (unitsVisibleBeforeQuery === null) unitsVisibleBeforeQuery = unitsVisible;
      if (unitsVisible) {
        unitsVisible = false;
        if (typeof applyUnitVisibility === 'function') applyUnitVisibility();
      }
    } catch (_) { /* 忽略：不影響主功能 */ }
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

  // ----------------------------------------------------------
  // 快取（localStorage，比照 equipment_parser.js 的兩層快取寫法）
  // ----------------------------------------------------------
  function readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.timestamp !== 'number') return null;
      if (Date.now() - parsed.timestamp > CACHE_TTL_MS) return null;
      return parsed.data;
    } catch (_) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ timestamp: Date.now(), data }));
    } catch (_) {
      // localStorage 已滿或不可用時靜默忽略，不影響主流程
    }
  }

  function loadSelectedCategories() {
    try {
      const raw = localStorage.getItem(SELECTED_CATEGORIES_KEY);
      if (!raw) return DEFAULT_SELECTED.slice();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch (_) { /* 忽略 */ }
    return DEFAULT_SELECTED.slice();
  }

  function saveSelectedCategories(ids) {
    try {
      localStorage.setItem(SELECTED_CATEGORIES_KEY, JSON.stringify(ids));
    } catch (_) { /* 忽略 */ }
  }

  // ----------------------------------------------------------
  // Celestrak 資料抓取與 TLE 解析
  // ----------------------------------------------------------
  async function fetchCategoryTle(category) {
    const cacheKey = CACHE_PREFIX + category.id;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams({ ...category.query, FORMAT: 'tle' });
    const url = `https://celestrak.org/NORAD/elements/gp.php?${params.toString()}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(url, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Celestrak 回應錯誤（${resp.status}）`);
      const text = await resp.text();
      const sats = parseTleText(text, category);
      writeCache(cacheKey, sats);
      return sats;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function parseTleText(text, category) {
    const lines = text.split(/\r?\n/).map(line => line.replace(/\s+$/, '')).filter(Boolean);
    const sats = [];
    for (let i = 0; i + 2 < lines.length; i += 3) {
      const name = lines[i].trim();
      const line1 = lines[i + 1];
      const line2 = lines[i + 2];
      if (!line1 || !line2 || line1[0] !== '1' || line2[0] !== '2') continue;
      if (/\bDEB\b/i.test(name)) continue; // 排除除役碎片，對 OSINT 判讀沒有意義
      sats.push({ name, line1, line2, categoryId: category.id, categoryLabel: category.label });
    }
    return sats;
  }

  // ----------------------------------------------------------
  // SGP4 過境運算
  // ----------------------------------------------------------
  function computeElevationDeg(satrec, observerGd, date) {
    try {
      const gmst = satellite.gstime(date);
      const posVel = satellite.propagate(satrec, date);
      if (!posVel || !posVel.position) return null; // 軌道已衰減/資料異常
      const positionEcf = satellite.eciToEcf(posVel.position, gmst);
      const lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf);
      return satellite.radiansToDegrees(lookAngles.elevation);
    } catch (_) {
      return null;
    }
  }

  function computePassesForSatellite(sat, observerGd, startDate) {
    let satrec;
    try {
      satrec = satellite.twoline2satrec(sat.line1, sat.line2);
    } catch (_) {
      return [];
    }

    const passes = [];
    const stepMs = COARSE_STEP_SEC * 1000;
    const endTime = startDate.getTime() + LOOKAHEAD_HOURS * 3600 * 1000;
    let inPass = false;
    let passStart = null;
    let passMaxElevation = -90;

    for (let t = startDate.getTime(); t <= endTime; t += stepMs) {
      const date = new Date(t);
      const elevation = computeElevationDeg(satrec, observerGd, date);
      if (elevation == null) continue;

      if (elevation >= MIN_ELEVATION_DEG) {
        if (!inPass) {
          inPass = true;
          passStart = date;
          passMaxElevation = elevation;
        } else if (elevation > passMaxElevation) {
          passMaxElevation = elevation;
        }
      } else if (inPass) {
        passes.push({
          satelliteName: sat.name,
          categoryLabel: sat.categoryLabel,
          start: passStart,
          end: date,
          maxElevationDeg: passMaxElevation,
          // 保留 TLE，供使用者點選過境項目時重新計算地面軌跡並畫在地圖上
          line1: sat.line1,
          line2: sat.line2
        });
        inPass = false;
        if (passes.length >= MAX_PASSES_PER_SAT) break;
      }
    }
    return passes;
  }

  async function computeAllPasses(sats, observerGd, onProgress) {
    const startDate = new Date();
    const allPasses = [];
    for (let i = 0; i < sats.length; i += CHUNK_SIZE) {
      const chunk = sats.slice(i, i + CHUNK_SIZE);
      chunk.forEach(sat => {
        allPasses.push(...computePassesForSatellite(sat, observerGd, startDate));
      });
      if (onProgress) onProgress(Math.min(i + CHUNK_SIZE, sats.length), sats.length);
      // 讓出主執行緒，避免多類別/大量衛星時卡住 UI
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    allPasses.sort((a, b) => a.start - b.start);
    return allPasses;
  }

  // ----------------------------------------------------------
  // 地面軌跡：把「衛星過境預測」的抽象時間/仰角數字，轉成使用者點一下就能在
  // 地圖上實際看到的軌跡線，回應「看不出來查詢結果的表現」的問題
  // ----------------------------------------------------------
  function clearGroundTrack() {
    if (groundTrackLayer && window.map) {
      try { window.map.removeLayer(groundTrackLayer); } catch (_) { /* 忽略 */ }
    }
    groundTrackLayer = null;
  }

  function drawGroundTrack(pass) {
    if (!window.map || !window.L || !window.satellite) return;
    clearGroundTrack();

    let satrec;
    try {
      satrec = satellite.twoline2satrec(pass.line1, pass.line2);
    } catch (_) {
      return;
    }

    const stepMs = 20 * 1000; // 20 秒取樣一次，過境通常只有幾分鐘，足夠平滑
    const points = [];
    for (let t = pass.start.getTime(); t <= pass.end.getTime(); t += stepMs) {
      const date = new Date(t);
      try {
        const posVel = satellite.propagate(satrec, date);
        if (!posVel || !posVel.position) continue;
        const gmst = satellite.gstime(date);
        const geo = satellite.eciToGeodetic(posVel.position, gmst);
        points.push([satellite.radiansToDegrees(geo.latitude), satellite.radiansToDegrees(geo.longitude)]);
      } catch (_) { /* 忽略單一取樣點失敗 */ }
    }
    if (points.length < 2) return;

    const group = L.layerGroup();
    const track = L.polyline(points, {
      color: '#8b5cf6',
      weight: 3,
      opacity: 0.85,
      dashArray: '6, 8'
    }).bindPopup(
      `<div class="popup-header"><h3 class="popup-title">${escapeHtml(pass.satelliteName)}</h3></div>
       ${pass.presetLabel ? `<div class="popup-field"><div class="popup-field-label">觀測點</div><div class="popup-field-value">${escapeHtml(pass.presetLabel)}</div></div>` : ''}
       <div class="popup-field"><div class="popup-field-label">過境時間</div><div class="popup-field-value">${formatDateTime(pass.start)} - ${formatDateTime(pass.end)}</div></div>
       <div class="popup-field"><div class="popup-field-label">最大仰角</div><div class="popup-field-value">${pass.maxElevationDeg.toFixed(0)}°</div></div>`,
      { className: 'custom-popup', minWidth: 220, maxWidth: 300 }
    );
    group.addLayer(track);
    group.addLayer(L.circleMarker(points[0], { radius: 6, color: '#22c55e', fillColor: '#22c55e', fillOpacity: 0.9, weight: 2 }).bindTooltip('過境開始', { permanent: false }));
    group.addLayer(L.circleMarker(points[points.length - 1], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.9, weight: 2 }).bindTooltip('過境結束', { permanent: false }));
    group.addTo(window.map);
    groundTrackLayer = group;

    window.map.fitBounds(L.latLngBounds(points), { padding: [60, 60], maxZoom: 8 });
    track.openPopup();
  }

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------
  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }

  function formatDuration(startDate, endDate) {
    const minutes = Math.max(1, Math.round((endDate - startDate) / 60000));
    return `約 ${minutes} 分鐘`;
  }

  function formatDateTime(date) {
    return date.toLocaleString('zh-TW', { hour12: false });
  }

  function clearQueryMarker() {
    if (queryMarker && window.map) {
      try { window.map.removeLayer(queryMarker); } catch (_) { /* 忽略 */ }
    }
    queryMarker = null;
  }

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
    clearQueryMarker();
    clearQueryMarkers();
    clearGroundTrack();
    currentPasses = [];
    selectedPassIndex = -1;
    restoreUnitsAfterQuery();
  }

  function renderCategoryCheckboxes(selectedIds) {
    return CATEGORIES.map(cat => `
      <div class="dropdown-option">
        <label>
          <input type="checkbox" class="sat-pass-category" value="${cat.id}" ${selectedIds.includes(cat.id) ? 'checked' : ''}>
          <span>${escapeHtml(cat.label)}</span>
        </label>
      </div>
    `).join('');
  }

  // 快速定位 chip：預設查詢點常常沒有衛星過境/航班可看，提供中國沿岸／台灣沿岸常用點位，
  // 並加一個「全部預設點」選項一次看所有點位（預設模式，除非使用者指定單一點位）
  function renderPresetChips(mode) {
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    const allChip = `<button type="button" class="osint-preset-chip${mode === 'all' ? ' active' : ''}" data-preset-index="all">全部預設點</button>`;
    const chips = presets.map((p, i) => `<button type="button" class="osint-preset-chip${mode === 'single' && i === 0 ? '' : ''}" data-preset-index="${i}">${escapeHtml(p.label)}</button>`).join('');
    return allChip + chips;
  }

  // 在地圖上標示查詢座標的圖示（單點與全部預設點共用同一個外觀）
  function createSatQueryIcon() {
    return L.divIcon({
      className: 'sat-query-marker-wrapper',
      html: `<div class="sat-query-marker">
        <svg class="sat-query-marker-icon" width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 7l3.5 3.5-1 1a2.5 2.5 0 0 1-3.5 0L10.5 10a2.5 2.5 0 0 1 0-3.5l1-1L13 7Z"/>
          <path d="M9.5 12.5L4 18l1.5 1.5L11 14l-1.5-1.5Z"/>
          <circle cx="18.5" cy="5.5" r="1.5"/>
        </svg>
      </div>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      popupAnchor: [0, -11]
    });
  }

  function buildQueryPopupHtml(label, lat, lng) {
    return `
      <div class="popup-header"><h3 class="popup-title">🛰️ 衛星過境查詢中心</h3></div>
      <div class="popup-field"><div class="popup-field-label">位置</div><div class="popup-field-value">${label ? escapeHtml(label) : `緯度 ${lat.toFixed(4)}, 經度 ${lng.toFixed(4)}`}</div></div>
      <div class="note-dialog-info" style="margin-top:8px;">此標記僅代表衛星過境預測的查詢中心點，不代表衛星本身位置</div>
    `;
  }

  // 單點模式：一顆圖釘＋飛過去
  function updateQueryMarker(lat, lng, label) {
    if (!window.map || !window.L) return;
    clearQueryMarkers();
    const popupHtml = buildQueryPopupHtml(label, lat, lng);
    if (queryMarker) {
      queryMarker.setLatLng([lat, lng]);
      queryMarker.setPopupContent(popupHtml);
    } else {
      queryMarker = L.marker([lat, lng], { icon: createSatQueryIcon() })
        .addTo(window.map)
        .bindPopup(popupHtml, { className: 'custom-popup', minWidth: 220, maxWidth: 300 });
    }
    window.map.flyTo([lat, lng], Math.max(window.map.getZoom(), 9), { duration: 1 });
  }

  // 全部預設點模式：每個點位各一顆圖釘，並自動調整 zoom 讓所有點位都在畫面內
  function updateAllPresetMarkers() {
    if (!window.map || !window.L) return;
    clearQueryMarker();
    clearQueryMarkers();
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    const bounds = [];
    presets.forEach(p => {
      const marker = L.marker([p.lat, p.lng], { icon: createSatQueryIcon() })
        .addTo(window.map)
        .bindPopup(buildQueryPopupHtml(p.label, p.lat, p.lng), { className: 'custom-popup', minWidth: 220, maxWidth: 300 });
      queryMarkers.push(marker);
      bounds.push([p.lat, p.lng]);
    });
    if (bounds.length) {
      window.map.flyToBounds(L.latLngBounds(bounds), { padding: [70, 70], maxZoom: 8, duration: 1 });
    }
  }

  function openSatellitePassPanel(lat, lng, label, options = {}) {
    const { allPresets = false } = options;
    closeDialog();

    let currentMode = allPresets ? 'all' : 'single';
    let currentLat = lat;
    let currentLng = lng;
    let currentLabel = label;
    const selectedIds = loadSelectedCategories();

    hideUnitsForQuery();

    if (currentMode === 'all') {
      updateAllPresetMarkers();
    } else {
      updateQueryMarker(currentLat, currentLng, currentLabel);
    }

    dialogEl = document.createElement('div');
    dialogEl.className = 'note-dialog-overlay osint-side-panel';
    dialogEl.innerHTML = `
      <div class="note-dialog note-dialog-large">
        <div class="note-dialog-header">
          <h3>衛星過境預測</h3>
          <button class="note-dialog-close" aria-label="關閉">&times;</button>
        </div>
        <div class="note-dialog-body">
          <div class="note-dialog-feature" data-role="location-label"></div>
          <div class="osint-preset-chip-list">${renderPresetChips(currentMode)}</div>
          <div class="note-input-group">
            <label>選擇衛星類別</label>
            <div class="sat-pass-category-list">${renderCategoryCheckboxes(selectedIds)}</div>
          </div>
          <div class="note-dialog-info sat-pass-disclaimer">
            <span>仰角/時間為 SGP4 軌道推算之估計值，僅供研判參考，未考慮雲層與實際成像規劃；查詢時已暫時隱藏軍事單位圖示，關閉面板後恢復</span>
          </div>
          <div class="sat-pass-results" data-state="idle"></div>
        </div>
        <div class="note-dialog-footer">
          <button class="note-btn note-btn-secondary" data-action="close">取消</button>
          <button class="note-btn note-btn-primary" data-action="query">查詢未來 48 小時過境</button>
        </div>
      </div>
    `;
    document.body.appendChild(dialogEl);

    const locationLabelEl = dialogEl.querySelector('[data-role="location-label"]');
    function refreshLocationLabel() {
      if (currentMode === 'all') {
        const count = (window.OSINT_PRESET_LOCATIONS || []).length;
        locationLabelEl.textContent = `查詢位置：全部預設點（共 ${count} 處）`;
      } else {
        locationLabelEl.textContent = `查詢位置：${currentLabel ? currentLabel : `緯度 ${currentLat.toFixed(4)}, 經度 ${currentLng.toFixed(4)}`}`;
      }
    }
    refreshLocationLabel();

    function setActiveChip(presetIndexAttr) {
      dialogEl.querySelectorAll('.osint-preset-chip').forEach(el => {
        el.classList.toggle('active', el.dataset.presetIndex === presetIndexAttr);
      });
    }
    setActiveChip(currentMode === 'all' ? 'all' : null);

    dialogEl.addEventListener('click', (e) => {
      if (e.target === dialogEl) closeDialog();
    });
    dialogEl.querySelector('.note-dialog-close').addEventListener('click', closeDialog);
    dialogEl.querySelector('[data-action="close"]').addEventListener('click', closeDialog);
    dialogEl.querySelectorAll('.osint-preset-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.presetIndex === 'all') {
          currentMode = 'all';
          updateAllPresetMarkers();
        } else {
          const preset = (window.OSINT_PRESET_LOCATIONS || [])[parseInt(btn.dataset.presetIndex, 10)];
          if (!preset) return;
          currentMode = 'single';
          currentLat = preset.lat;
          currentLng = preset.lng;
          currentLabel = preset.label;
          updateQueryMarker(currentLat, currentLng, currentLabel);
        }
        refreshLocationLabel();
        setActiveChip(btn.dataset.presetIndex);
      });
    });
    dialogEl.querySelector('[data-action="query"]').addEventListener('click', () => {
      const ids = Array.from(dialogEl.querySelectorAll('.sat-pass-category:checked')).map(el => el.value);
      saveSelectedCategories(ids);
      if (currentMode === 'all') {
        runQueryAllPresets(ids);
      } else {
        runQuery(currentLat, currentLng, ids);
      }
    });

    // 結果清單用事件代理（resultsEl 本身在每次查詢時只換 innerHTML，容器不會重建，
    // 掛在容器上一次即可，避免每次查詢都重複綁定監聽器）
    const resultsEl = dialogEl.querySelector('.sat-pass-results');
    resultsEl.addEventListener('click', handleResultsClick);

    // 從 popup 進來（指定單一設施）就直接查詢；全部預設點模式則等使用者按查詢
    // （多點運算較久，不宜一開面板就自動觸發）
    if (currentMode === 'single' && Number.isFinite(currentLat) && Number.isFinite(currentLng)) {
      runQuery(currentLat, currentLng, selectedIds);
    }
  }

  // 點擊過境項目：在地圖上畫出該次過境的地面軌跡；點擊「這是什麼？」：展開/收合維基百科簡介
  async function handleResultsClick(e) {
    const resultsEl = e.currentTarget;

    const wikiBtn = e.target.closest('[data-action="wiki"]');
    if (wikiBtn) {
      const idx = parseInt(wikiBtn.dataset.index, 10);
      const pass = currentPasses[idx];
      const container = resultsEl.querySelector(`.sat-pass-item-wiki[data-wiki-for="${idx}"]`);
      if (!pass || !container) return;

      if (container.dataset.loaded === '1') {
        container.style.display = container.style.display === 'none' ? 'block' : 'none';
        return;
      }
      container.style.display = 'block';
      container.dataset.loaded = '1';
      container.innerHTML = `<div class="osint-wiki-loading"><span class="osint-spinner"></span>正在查詢維基百科...</div>`;
      try {
        const info = window.equipmentParser ? await window.equipmentParser.fetchWeaponInfo(pass.satelliteName) : null;
        container.innerHTML = renderWikiInfoHtml(info, pass.satelliteName);
      } catch (err) {
        container.innerHTML = `<div class="osint-wiki-empty">查詢維基百科失敗</div>`;
      }
      return;
    }

    const item = e.target.closest('.sat-pass-item');
    if (!item) return;
    const idx = parseInt(item.dataset.index, 10);
    const pass = currentPasses[idx];
    if (!pass) return;
    drawGroundTrack(pass);
    resultsEl.querySelectorAll('.sat-pass-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    selectedPassIndex = idx;
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

  function renderPassItemHtml(pass, i) {
    const locationTag = pass.presetLabel ? `<div class="sat-pass-item-category">${escapeHtml(pass.presetLabel)} · ${escapeHtml(pass.categoryLabel)}</div>` : `<div class="sat-pass-item-category">${escapeHtml(pass.categoryLabel)}</div>`;
    return `
        <div class="sat-pass-item" data-index="${i}" title="點擊在地圖上顯示這次過境的地面軌跡">
          <div class="sat-pass-item-main">
            <div class="sat-pass-item-name">${escapeHtml(pass.satelliteName)}</div>
            ${locationTag}
          </div>
          <div class="sat-pass-item-detail">
            <span>${formatDateTime(pass.start)}</span>
            <span>最大仰角 ${pass.maxElevationDeg.toFixed(0)}°</span>
            <span>${formatDuration(pass.start, pass.end)}</span>
          </div>
          <div class="sat-pass-item-actions">
            <button type="button" class="link-btn" data-action="wiki" data-index="${i}">這是什麼？</button>
            <span class="sat-pass-item-hint">點列可在地圖上看軌跡</span>
          </div>
          <div class="sat-pass-item-wiki" data-wiki-for="${i}" style="display:none;"></div>
        </div>
      `;
  }

  async function runQuery(lat, lng, categoryIds) {
    const resultsEl = dialogEl && dialogEl.querySelector('.sat-pass-results');
    if (!resultsEl) return;

    const token = ++currentRequestToken;

    if (categoryIds.length === 0) {
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="sat-pass-empty">請至少選擇一個衛星類別</div>`;
      return;
    }

    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = `<div class="equipment-loading">正在抓取衛星軌道資料並計算過境時間...</div>`;

    try {
      const categories = CATEGORIES.filter(cat => categoryIds.includes(cat.id));
      const satLists = await Promise.all(categories.map(cat =>
        fetchCategoryTle(cat).catch(err => {
          console.warn(`[SatellitePass] ${cat.label} 資料取得失敗:`, err);
          return [];
        })
      ));
      const sats = satLists.flat();

      if (token !== currentRequestToken) return; // 使用者已切換查詢，捨棄過期結果

      if (sats.length === 0) {
        resultsEl.dataset.state = 'error';
        resultsEl.innerHTML = `<div class="sat-pass-empty">找不到所選類別的衛星軌道資料，請稍後再試</div>`;
        return;
      }

      const observerGd = {
        longitude: satellite.degreesToRadians(lng),
        latitude: satellite.degreesToRadians(lat),
        height: 0.05
      };

      const passes = (await computeAllPasses(sats, observerGd, (done, total) => {
        if (token !== currentRequestToken || !resultsEl.isConnected) return;
        resultsEl.innerHTML = `<div class="equipment-loading">運算中... (${done}/${total} 顆衛星)</div>`;
      })).slice(0, MAX_RESULTS);

      if (token !== currentRequestToken) return;

      if (passes.length === 0) {
        resultsEl.dataset.state = 'empty';
        resultsEl.innerHTML = `<div class="sat-pass-empty">未來 48 小時內，所選類別沒有仰角 ${MIN_ELEVATION_DEG}° 以上的過境</div>`;
        return;
      }

      resultsEl.dataset.state = 'success';
      currentPasses = passes;
      selectedPassIndex = -1;
      resultsEl.innerHTML = passes.map((pass, i) => renderPassItemHtml(pass, i)).join('');
    } catch (error) {
      if (token !== currentRequestToken) return;
      console.error('[SatellitePass] 查詢失敗:', error);
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="sat-pass-empty">查詢失敗（可能是網路問題或 Celestrak 暫時無法連線），請稍後再試</div>`;
    }
  }

  // 全部預設點模式：同一批衛星，對每個預設點各算一次過境，結果依時間合併排序
  async function runQueryAllPresets(categoryIds) {
    const resultsEl = dialogEl && dialogEl.querySelector('.sat-pass-results');
    if (!resultsEl) return;

    const token = ++currentRequestToken;

    if (categoryIds.length === 0) {
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="sat-pass-empty">請至少選擇一個衛星類別</div>`;
      return;
    }

    const presets = window.OSINT_PRESET_LOCATIONS || [];
    if (presets.length === 0) {
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="sat-pass-empty">沒有可用的預設點位</div>`;
      return;
    }

    resultsEl.dataset.state = 'loading';
    resultsEl.innerHTML = `<div class="equipment-loading">正在抓取衛星軌道資料...</div>`;

    try {
      const categories = CATEGORIES.filter(cat => categoryIds.includes(cat.id));
      const satLists = await Promise.all(categories.map(cat =>
        fetchCategoryTle(cat).catch(err => {
          console.warn(`[SatellitePass] ${cat.label} 資料取得失敗:`, err);
          return [];
        })
      ));
      const sats = satLists.flat();

      if (token !== currentRequestToken) return;

      if (sats.length === 0) {
        resultsEl.dataset.state = 'error';
        resultsEl.innerHTML = `<div class="sat-pass-empty">找不到所選類別的衛星軌道資料，請稍後再試</div>`;
        return;
      }

      let allPasses = [];
      for (let p = 0; p < presets.length; p++) {
        const preset = presets[p];
        const observerGd = {
          longitude: satellite.degreesToRadians(preset.lng),
          latitude: satellite.degreesToRadians(preset.lat),
          height: 0.05
        };
        const passes = await computeAllPasses(sats, observerGd, (done, total) => {
          if (token !== currentRequestToken || !resultsEl.isConnected) return;
          resultsEl.innerHTML = `<div class="equipment-loading">運算中...（${escapeHtml(preset.label)} ${p + 1}/${presets.length}，衛星 ${done}/${total}）</div>`;
        });
        passes.forEach(pass => { pass.presetLabel = preset.label; });
        allPasses.push(...passes);
        if (token !== currentRequestToken) return;
      }

      allPasses.sort((a, b) => a.start - b.start);
      allPasses = allPasses.slice(0, MAX_RESULTS);

      if (token !== currentRequestToken) return;

      if (allPasses.length === 0) {
        resultsEl.dataset.state = 'empty';
        resultsEl.innerHTML = `<div class="sat-pass-empty">未來 48 小時內，所選類別在全部預設點都沒有仰角 ${MIN_ELEVATION_DEG}° 以上的過境</div>`;
        return;
      }

      resultsEl.dataset.state = 'success';
      currentPasses = allPasses;
      selectedPassIndex = -1;
      resultsEl.innerHTML = allPasses.map((pass, i) => renderPassItemHtml(pass, i)).join('');
    } catch (error) {
      if (token !== currentRequestToken) return;
      console.error('[SatellitePass] 全部預設點查詢失敗:', error);
      resultsEl.dataset.state = 'error';
      resultsEl.innerHTML = `<div class="sat-pass-empty">查詢失敗（可能是網路問題或 Celestrak 暫時無法連線），請稍後再試</div>`;
    }
  }

  window.openSatellitePassPanel = openSatellitePassPanel;
  // 供 popup 內連結按鈕使用：從觸發元素的 data-lat/data-lng/data-label 讀取參數（單一設施＝使用者已指定點位）
  window.openSatellitePassPanelFromEl = function(el) {
    const lat = parseFloat(el.dataset.lat);
    const lng = parseFloat(el.dataset.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    openSatellitePassPanel(lat, lng, el.dataset.label || '');
  };
  // 供地圖工具列使用：預設一次查看全部預設點
  window.openSatellitePassPanelAllPresets = function() {
    openSatellitePassPanel(null, null, '', { allPresets: true });
  };
})();
