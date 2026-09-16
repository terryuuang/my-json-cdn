// ==========================================================
// location_search.js - 地點搜尋（動態島搜尋列，桌面／手機共用同一套 DOM/邏輯）
// ==========================================================


// 搜尋位置功能（讀取控制面板內手動輸入的經緯度/半徑，與動態島搜尋是兩件事）
function searchLocation() {
const latInputEl = document.getElementById('latInput');
const lngInputEl = document.getElementById('lngInput');
const radiusInputEl = document.getElementById('radiusInput');
if (!latInputEl || !lngInputEl) {
    console.error('[Map] searchLocation：找不到經緯度輸入欄位');
    return;
}
const lat = parseFloat(latInputEl.value);
const lng = parseFloat(lngInputEl.value);
const radius = parseFloat(radiusInputEl ? radiusInputEl.value : NaN) || 50;

if (isNaN(lat) || isNaN(lng)) {
    if (window.IslandActivity) {
      window.IslandActivity.transient('請輸入有效的經緯度', 'error');
    }

    return;
}

// 獲取當前選中的圖層
const selectedLayers = window.getSelectedLayers ? window.getSelectedLayers() : [];

updateUrlAndRenderAtCoords(lat, lng, radius, selectedLayers);

// 手機版自動關閉控制面板
if (isMobileDevice()) {
    closeControlPanel();
}
}

// ==========================================================
// 搜尋動態島
// ==========================================================

let searchRequestId = 0;
let wikiRequestId = 0;

// 公開研究入口：只連到原始發布者，不抓取或離線保存其文章。
const OSINT_RESOURCES = [
  { displayName: '國防部 · 臺海周邊海空域動態', keywords: '中共 共軍 解放軍 軍機 軍艦 台海 臺海 國防部 MND OSINT 情報', url: 'https://www.mnd.gov.tw/newslist/2', detail: '國防部公開通報 · 線上開啟原始發布頁' },
  { displayName: 'AMTI · 中國南海島礁追蹤', keywords: '中共 中國 南海 西沙 南沙 島礁 填海 衛星 CSIS AMTI OSINT 情報', url: 'https://amti.csis.org/island-tracker/china/', detail: 'CSIS 島礁資料與影像分析 · 線上開啟原站' },
  { displayName: 'ChinaPower · 中國軍力與臺海研究', keywords: '中共 中國 共軍 解放軍 軍力 台海 臺海 軍演 CSIS ChinaPower OSINT 情報', url: 'https://chinapower.csis.org/', detail: 'CSIS 公開研究與資料 · 線上開啟原站' }
];

function getSearchCatalog(query = '') {
  const entries = [];
  document.querySelectorAll('#layerDropdownMenu input, #osmDropdownMenu input').forEach(control => {
    const military = !!control.closest('#layerDropdownMenu');
    const name = control.closest('label').textContent.trim();
    entries.push({ displayName: name, keywords: `${control.value} ${military ? '軍事單位' : '公共設施'} 資料圖層`,
      source: 'action', control, military, detail: military ? '資料圖層 · 顯示此分層並定位' : '資料圖層 · 在目前地圖範圍啟用' });
  });
  [
    ['theaterToggleBtn', '五大戰區', '中共 共軍 解放軍 東部戰區 南部戰區 西部戰區 北部戰區 中部戰區', [[18, 73], [54, 135]]],
    ['adizToggleBtn', '防空識別區／臺海中線', 'ADIZ 台海 中線', [[21, 117.3], [29, 123]]],
    ['maritimeZonesToggleBtn', '12 / 24 海浬線', '領海 鄰接區 十二 二十四 海里', [[20, 117], [27, 124]]]
  ].forEach(([id, displayName, keywords, bounds]) => {
    entries.push({ displayName, keywords: `${keywords} 疊加範圍`, source: 'action', control: document.getElementById(id), bounds, detail: '疊加範圍 · 開啟並定位' });
  });
  entries.push(...OSINT_RESOURCES.map(resource => ({ ...resource, source: 'resource' })));
  return query ? entries.filter(entry => window.searchUtils.fuzzyMatch(`${entry.displayName} ${entry.keywords}`, query)) : entries;
}

function showSearchHome() {
  const results = document.getElementById('searchResults');
  results.innerHTML = '<div class="search-home-hint">搜尋地點、圖層或 OSINT；選取圖層即可顯示於圖臺。</div><div class="search-location-list"></div>';
  const shortcuts = document.createElement('div');
  shortcuts.className = 'search-shortcuts';
  ['資料圖層', '疊加範圍', 'OSINT'].forEach(query => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = query;
    button.addEventListener('click', () => {
      const input = document.getElementById('searchInput');
      input.value = query;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    shortcuts.appendChild(button);
  });
  results.prepend(shortcuts);
  displaySearchResults(getSearchCatalog().filter(entry => entry.bounds || entry.source === 'resource'), '');
}

function activateSearchAction(result) {
  const control = result.control;
  if (!control || !map) return;
  if (result.military) {
    const features = allFeatures.filter(feature => getFeatureLayerName(feature.properties || {}) === control.value);
    const bounds = L.geoJSON(features).getBounds();
    if (!bounds.isValid()) {
      window.IslandActivity?.transient('此分層尚無資料，請待資料載入後再試', 'warning');
      return;
    }
    selectedLayers.clear();
    selectedLayers.add(control.value);
    document.querySelectorAll('#layerDropdownMenu input').forEach(input => { input.checked = input === control; });
    updateLayerCount();
    unitsVisible = true;
    const center = bounds.getCenter();
    const radius = Math.ceil(Math.max(...[bounds.getNorthEast(), bounds.getNorthWest(), bounds.getSouthEast(), bounds.getSouthWest()].map(corner => center.distanceTo(corner))) / 1000) + 1;
    document.getElementById('latInput').value = center.lat;
    document.getElementById('lngInput').value = center.lng;
    document.getElementById('radiusInput').value = radius;
    updateUrlAndRenderAtCoords(center.lat, center.lng, radius, [control.value]);
    map.fitBounds(bounds, { padding: [32, 72], maxZoom: 12, animate: false });
  } else if (control.type === 'checkbox') {
    if (!control.checked) {
      control.checked = true;
      control.dispatchEvent(new Event('change', { bubbles: true }));
    }
  } else {
    if (!control.classList.contains('active')) control.click();
    if (result.bounds) map.fitBounds(result.bounds, { padding: [24, 72], animate: false });
  }
  collapseSearchIsland();
  if (isMobileDevice()) closeControlPanel();
}

// 展開/收合動態島時，先把目前實際寬度鎖成 inline style，
// 讓 class 切換後目標寬度能跟鎖定值之間跑 CSS transition
function lockIslandWidth(island) {
  const currentWidth = island.getBoundingClientRect().width;
  island.style.width = `${currentWidth}px`;
  getComputedStyle(island).width;
}

// 放開鎖定寬度。雙 rAF 確保瀏覽器已經把鎖定寬度 commit 到繪製管線，
// 第二幀移除 inline style 才能穩定觸發 transition（單幀在部分瀏覽器/負載高時不穩定）
function releaseIslandWidthNextFrame(island) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      island.style.width = '';
    });
  });
}

// 展開/收合動態島
// focusInput 預設為 true（點擊/鍵盤觸發都應該直接把游標放進輸入框）；
// 桌面版滑鼠 hover 展開時傳 false——單純「移過去瞄一眼」不該搶走輸入焦點，
// 這跟真正想輸入而點擊/觸控展開的意圖不同
function expandSearchIsland({ focusInput = true } = {}) {
  const island = document.getElementById('searchIsland');
  if (!island || island.classList.contains('expanded')) return;
  lockIslandWidth(island);
  island.classList.add('expanded');
  releaseIslandWidthNextFrame(island);
  document.getElementById('searchIslandTrigger')?.setAttribute('aria-expanded', 'true');
  if (!document.getElementById('searchInput').value.trim()) showSearchHome();
  else document.getElementById('searchResults').classList.add('show');
  if (focusInput) {
    const input = document.getElementById('searchInput');
    // preventScroll：iOS 預設會為了把輸入框捲進可視區而捲動整份文件，
    // body 是 position:fixed，捲動後所有固定元素會一起錯位、收起鍵盤後也不會自己回來
    if (input) input.focus({ preventScroll: true });
  }
}

function collapseSearchIsland() {
  document.getElementById('searchIslandTrigger')?.setAttribute('aria-expanded', 'false');
  const island = document.getElementById('searchIsland');
  if (island && island.classList.contains('expanded')) {
    lockIslandWidth(island);
    island.classList.remove('expanded');
    releaseIslandWidthNextFrame(island);
  }
  const results = document.getElementById('searchResults');
  if (results) results.classList.remove('show');
  const input = document.getElementById('searchInput');
  if (input) input.blur();
}

// 骨架屏載入畫面：取代純文字「搜尋中...」，展開瞬間先給出結果卡片輪廓
const SEARCH_SKELETON_HTML = `
  <div class="search-skeleton">
    <div class="search-skeleton-row"></div>
    <div class="search-skeleton-row"></div>
    <div class="search-skeleton-row"></div>
  </div>
`;

// 執行搜尋
async function performSearch({ online = false } = {}) {
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  if (!searchInput || !searchResults) return;
  const query = searchInput.value.trim();

  if (!query) {
    showSearchHome();
    return;
  }

  if (!window.searchUtils) {
    console.error('[Map] Search utils 未載入');
    searchResults.innerHTML = '<div class="search-no-results">搜尋功能載入中，請稍後再試...</div>';
    searchResults.classList.add('show');
    return;
  }

  const currentRequestId = ++searchRequestId;

  // 清空整個容器（含上一次查詢殘留的百科卡片），重建乾淨的地點清單容器，
  // 百科區塊之後會用 prepend 插到最前面，兩者互不覆寫彼此的 innerHTML
  searchResults.innerHTML = '';
  searchResults.classList.add('show');
  const locationList = document.createElement('div');
  locationList.className = 'search-location-list';
  locationList.innerHTML = SEARCH_SKELETON_HTML;
  searchResults.appendChild(locationList);
  // 新查詢一律先收回加寬狀態，等百科卡片真的查到才重新加寬，避免沿用上一次查詢的寬度
  document.getElementById('searchIsland')?.classList.remove('island-wide');

  // 百科查詢跟地點結果並行發起（不等地點結果回來才開始查）：
  // 百科卡片一律插在地點清單「最上面」，若等地點結果顯示、使用者已經在點的時候才插入，
  // 會把清單往下推、造成點擊座標對不上（點下去沒反應）。提早並行發起可以讓百科區塊
  // 盡量在地點清單出現前就定位完成，縮小這個位移窗口
  if (navigator.onLine) fetchAndRenderWikiSummary(query, currentRequestId);

  try {
    const catalog = getSearchCatalog(query);
    const options = { searchFields: ['名稱', 'name', '說明', 'layer'], maxResults: isMobileDevice() ? 20 : 50 };
    const local = window.searchUtils.searchFeatures(allFeatures, query, options);
    displaySearchResults([...catalog, ...local], query);
    // Nominatim 不支援自動完成；只有使用者明確送出才查詢外部地名。
    if (online && navigator.onLine) {
      const results = await window.searchUtils.searchCombined(allFeatures, query, { ...options, includeNominatim: true, nominatimMaxResults: 5 });
      if (currentRequestId === searchRequestId) displaySearchResults([...catalog, ...results], query);
    }

  } catch (error) {
    console.error('[Map] 搜尋錯誤:', error);
    if (currentRequestId === searchRequestId) {
      const list = searchResults.querySelector('.search-location-list');
      if (list) list.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 使用者最近是否正在操作結果清單（按下、捲動）。只有這段期間插入/變高的內容會讓點擊座標對不上
const RESULTS_INTERACTION_GRACE_MS = 800;
function isUserInteractingWithResults(searchResults) {
  if (searchResults.scrollTop > 0) return true;
  const last = Number(searchResults.dataset.lastInteraction || 0);
  return Date.now() - last < RESULTS_INTERACTION_GRACE_MS;
}

// 百科卡片理想上放在地點清單「上方」（比起地點清單，查專有名詞時通常最想先看到百科摘要），
// 但百科查詢常常比地點搜尋慢，而且內容還會隨查詢進度變高（loading spinner → 摘要卡片／消歧義清單）。
// 只要百科區塊還壓在地點清單上面，它每次變高都會把已經顯示、可能正要被點擊的地點項目往下推，
// 讓點擊座標跟畫面對不上（點下去沒反應）。這裡在每次更新百科內容「之前」都重新判斷位置：
// 地點清單還沒有實際項目時放最上面（此時沒有人在點東西，放最上面不會有風險）；
// 一旦地點清單已經有項目，就固定改放最下面——不只是建立當下判斷一次，
// 而是每次更新都重新檢查並視需要搬移，這樣就算百科區塊是在地點清單出現「之前」就已經卡在最上面，
// 之後地點清單一出現，下一次百科內容更新也會把它搬到最下面，不會再讓後續的內容變高波及地點項目
//
// v0.6.4 修正：原本「地點清單一有項目就把百科搬到最下面」，在手機上等於百科卡片永遠看不到
// （20 筆結果、45vh 高的清單，卡片被擠到最底）。真正的風險只在「使用者正在點/捲」的那一刻，
// 所以改成：沒在操作 → 放最上面；正在操作 → 位置不動，若在上方就用 scrollTop 抵銷高度變化，
// 讓地點項目在畫面上的位置保持不變。
function placeWikiSection(searchResults) {
  let section = searchResults.querySelector('.search-wiki-section');
  const interacting = isUserInteractingWithResults(searchResults);
  if (!section) {
    section = document.createElement('div');
    section.className = 'search-wiki-section';
    if (interacting) searchResults.appendChild(section);
    else searchResults.prepend(section);
  } else if (!interacting && searchResults.firstElementChild !== section) {
    searchResults.prepend(section);
  }
  return section;
}

// 更新百科區塊內容；區塊在清單上方且使用者正在操作時，補償高度差避免地點項目位移
function updateWikiSection(searchResults, html) {
  const section = placeWikiSection(searchResults);
  const isAbove = searchResults.firstElementChild === section;
  const compensate = isAbove && isUserInteractingWithResults(searchResults);
  const before = compensate ? section.offsetHeight : 0;
  section.innerHTML = html;
  if (compensate) searchResults.scrollTop += section.offsetHeight - before;
  return section;
}

const WIKI_LOADING_HTML = `<div class="search-wiki-loading">${thinkingOrbsHtml('查詢中')}正在查詢維基百科...</div>`;

// 查詢並顯示專有名詞的維基百科摘要（OSINT 用途：地名/單位/人名等查詢時順便附上百科簡介）
// 跟地點結果各自獨立一個 request id，避免使用者連續輸入時，較慢回來的百科結果蓋掉最新查詢
async function fetchAndRenderWikiSummary(query, searchId) {
  const searchResults = document.getElementById('searchResults');
  if (!searchResults || !window.equipmentParser || query.length < 2) return;

  const currentWikiId = ++wikiRequestId;
  const isStale = () => searchId !== searchRequestId || currentWikiId !== wikiRequestId;

  const renderSection = (innerHtml) => {
    if (isStale()) return null;
    return updateWikiSection(searchResults, `<div class="search-wiki-section-label">維基百科</div>${innerHtml}`);
  };

  renderSection(WIKI_LOADING_HTML);

  // 一般摘要卡片（含消歧義選完之後、回頭再查一次確切條目的情境，兩處共用同一個渲染函式）
  function renderWikiCard(info, fallbackTitle) {
    const title = info.title || fallbackTitle;
    // 縮圖以「顯影」方式浮現（參考 img-fx 的 reveal：影像從模糊、去飽和逐步清晰），
    // 比起載入完成瞬間跳出來更不突兀；載入失敗就整個縮圖框收掉
    const mediaHtml = info.thumbnail
      ? `<div class="search-wiki-card-media"><img src="${escapeAttr(info.thumbnail)}" alt="${escapeAttr(escapeHtml(title))}" loading="lazy" decoding="async" onload="this.classList.add('is-loaded')" onerror="this.parentNode.remove()"></div>`
      : '';
    const linkHtml = info.wikipediaUrl
      ? `<a href="${escapeAttr(info.wikipediaUrl)}" target="_blank" rel="noopener noreferrer" class="search-wiki-card-link">維基百科原文</a>`
      : '';
    // 正文摘要比 Wikidata 短描述有資訊量；兩者都有時短描述當副標
    const body = info.extract || info.description || '（無簡介）';
    const subtitle = info.extract && info.shortDescription ? info.shortDescription : '';
    renderSection(`
      <div class="search-wiki-card">
        ${mediaHtml}
        <div class="search-wiki-card-body">
          <div class="search-wiki-card-title">${escapeHtml(title)}</div>
          ${subtitle ? `<div class="search-wiki-card-subtitle">${escapeHtml(subtitle)}</div>` : ''}
          <div class="search-wiki-card-desc">${escapeHtml(body)}</div>
          ${linkHtml}
        </div>
      </div>
    `);
    // 百科卡片內容比純地點清單多（縮圖+摘要），查到才加寬，讓島隨內容量自適應而不是每次都佔滿最大寬度。
    // 但動態島是用 left:50% + translateX(-50%) 置中，變寬時兩側會對稱往外展開，
    // 連帶把島內所有內容（包含地點清單項目）一起橫向位移，且這個變寬有 0.4s 動畫。
    // 如果地點清單這時已經顯示出可點擊項目，使用者的點擊座標可能還沒反應過來這個橫移，
    // 導致點下去偏移到旁邊——所以只在地點清單「還沒有實際項目」時才加寬，
    // 已經有項目的話寧可百科卡片維持原本寬度（頂多文字換行多一點），優先保證點擊穩定
    if (!isUserInteractingWithResults(searchResults)) {
      document.getElementById('searchIsland')?.classList.add('island-wide');
    }
  }

  // 消歧義候選清單：直接列出前 3 個候選條目讓使用者自己點，不盲猜第一個避免選錯
  function renderDisambiguation(info) {
    const itemsHtml = info.candidates.map(c => `
      <button type="button" class="search-wiki-disambig-item" data-title="${escapeAttr(escapeHtml(c.title))}">
        <span class="search-wiki-disambig-title">${escapeHtml(c.displayTitle || c.title)}</span>
        <span class="search-wiki-disambig-arrow">›</span>
      </button>
    `).join('');
    renderSection(`
      <div class="search-wiki-disambig">
        <div class="search-wiki-disambig-hint">「${escapeHtml(info.query)}」查到多個同名條目，請選擇：</div>
        ${itemsHtml}
      </div>
    `);
    const section = searchResults.querySelector('.search-wiki-section');
    section?.querySelectorAll('.search-wiki-disambig-item').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (isStale()) return;
        const title = btn.dataset.title;
        renderSection(WIKI_LOADING_HTML);
        try {
          const picked = await window.equipmentParser.fetchPageSummaryByLangTitle('zh', title);
          if (isStale()) return;
          if (!picked) {
            // 理論上候選已過濾掉查無資料的條目，這裡是保底：查失敗時給明確提示而不是整塊悄悄消失
            renderSection(`<div class="search-wiki-empty">查無「${escapeHtml(btn.textContent.trim())}」的摘要資料</div>`);
            return;
          }
          renderWikiCard(picked, title);
        } catch (_) {
          if (isStale()) return;
          renderSection(`<div class="search-wiki-empty">查詢時發生錯誤，請稍後再試</div>`);
        }
      });
    });
  }

  try {
    const info = await window.equipmentParser.fetchGenericSummary(query, 'zh');
    if (isStale()) return;

    if (!info) {
      // 查無資料時直接移除區塊，不佔用空間顯示「查無資料」（地點搜尋為主，百科只是加值資訊）
      const section = searchResults.querySelector('.search-wiki-section');
      if (section) section.remove();
      return;
    }

    if (info.disambiguation) {
      renderDisambiguation(info);
      return;
    }

    renderWikiCard(info, query);
  } catch (_) {
    if (isStale()) return;
    const section = searchResults.querySelector('.search-wiki-section');
    if (section) section.remove();
  }
}

// 顯示搜尋結果
function displaySearchResults(results, query) {
  const searchResults = document.getElementById('searchResults');
  // 地點清單專用容器：跟百科區塊（.search-wiki-section）分開更新，
  // 避免其中一方 innerHTML 覆寫時把另一方也清掉，造成已顯示的結果列表突然被百科卡片頂下去
  let list = searchResults.querySelector('.search-location-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'search-location-list';
    searchResults.appendChild(list);
  }

  window.currentSearchResults = results || [];
  list.replaceChildren();
  if (!results?.length) {
    const empty = document.createElement('div');
    empty.className = 'search-no-results';
    empty.textContent = navigator.onLine ? '沒有結果。可按 Enter 或搜尋按鈕查詢線上地名。' : '沒有本地結果。連線後可查詢線上地名。';
    list.appendChild(empty);
  }
  results?.forEach((result, index) => {
    const item = document.createElement(result.source === 'resource' ? 'a' : 'button');
    item.className = 'search-result-item';
    if (result.source === 'resource') {
      item.href = result.url;
      item.target = '_blank';
      item.rel = 'noopener noreferrer';
    } else {
      item.type = 'button';
      item.addEventListener('click', () => selectSearchResult(index));
    }
    const name = document.createElement('div');
    name.className = 'search-result-name';
    name.textContent = result.displayName || result.name || '未命名';
    const detail = document.createElement('div');
    detail.className = 'search-result-layer';
    detail.textContent = result.detail || `${result.source === 'nominatim' ? 'OpenStreetMap' : '地點'} · ${toDisplayLayerName(result.layer || '未分類')}`;
    item.append(name, detail);
    list.appendChild(item);
  });
  searchResults.classList.add('show');
}

// 選擇搜尋結果
function selectSearchResult(index) {
  const results = window.currentSearchResults;
  if (!results || !results[index]) return;

  const result = results[index];
  if (result.source === 'action') return activateSearchAction(result);
  const coords = result.coordinates;

  if (!coords || coords.length < 2) return;

  const lat = coords[1];
  const lng = coords[0];

  // 填入座標（供控制面板手動調整參考）
  document.getElementById('latInput').value = lat;
  document.getElementById('lngInput').value = lng;

  // 設定預設半徑
  const radiusInput = document.getElementById('radiusInput');
  if (!radiusInput.value || parseFloat(radiusInput.value) > 100) {
    radiusInput.value = 10; // 搜尋結果預設使用較小半徑
  }

  // 獲取當前選中的圖層
  const selectedLayers = window.getSelectedLayers ? window.getSelectedLayers() : [];
  if (result.source === 'local') {
    unitsVisible = true;
    const layerName = getFeatureLayerName(result.feature.properties || {});
    const checkbox = Array.from(document.querySelectorAll('#layerDropdownMenu input')).find(input => input.value === layerName);
    if (checkbox && !checkbox.checked) {
      checkbox.checked = true;
      // 更新共享篩選狀態；下方統一重繪。
      window.enableSearchLayer(layerName);
      selectedLayers.push(layerName);
    }
  }
  const radius = parseFloat(radiusInput.value) || 10;

  updateUrlAndRenderAtCoords(lat, lng, radius, selectedLayers);
  collapseSearchIsland();

  // 手機版自動關閉面板
  if (isMobileDevice()) {
    closeControlPanel();
  }
}

// 設置搜尋動態島的展開/收合與輸入互動
function setupSearchIsland() {
  const island = document.getElementById('searchIsland');
  const trigger = document.getElementById('searchIslandTrigger');
  const searchInput = document.getElementById('searchInput');
  const clearBtn = document.getElementById('searchClearBtn');
  if (!island || !searchInput) return;

  let searchTimeout;
  let selectedResultIndex = -1;

  const searchResultsEl = document.getElementById('searchResults');
  const markInteraction = () => { searchResultsEl.dataset.lastInteraction = String(Date.now()); };
  ['pointerdown', 'touchstart', 'wheel', 'scroll'].forEach(type => {
    searchResultsEl?.addEventListener(type, markInteraction, { passive: true });
  });

  setupViewportStabilizer(island);

  trigger?.addEventListener('click', () => expandSearchIsland());
  document.getElementById('searchCloseBtn')?.addEventListener('click', () => { collapseSearchIsland(); trigger?.focus({ preventScroll: true }); });
  document.getElementById('searchSubmitBtn')?.addEventListener('click', () => { clearTimeout(searchTimeout); performSearch({ online: true }); });

  // 桌面滑鼠 hover 展開，比照 macOS 選單列／Dock 靠近即放大的手感——
  // 觸控裝置沒有真正的 hover 概念（長按會被誤判成 hover），用 (hover:hover) + (pointer:fine)
  // 限定只在滑鼠桌機生效，手機/平板仍維持原本的點擊展開
  const supportsHoverExpand = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (supportsHoverExpand) {
    let hoverExpandTimer = null;
    let hoverCollapseTimer = null;

    island.addEventListener('mouseenter', () => {
      clearTimeout(hoverCollapseTimer);
      // 短暫延遲：滑鼠快速掃過去不應該觸發展開，只有「停留」才算有意圖
      hoverExpandTimer = setTimeout(() => {
        if (!island.classList.contains('expanded')) expandSearchIsland({ focusInput: false });
      }, 150);
    });

    island.addEventListener('mouseleave', () => {
      clearTimeout(hoverExpandTimer);
      // 使用者已經點進輸入框打字的話，滑鼠移開不該把正在輸入的搜尋收合掉，
      // 這時只保留原本的 Escape／點擊外部收合
      if (island.contains(document.activeElement)) return;
      hoverCollapseTimer = setTimeout(() => {
        if (!island.contains(document.activeElement)) collapseSearchIsland();
      }, 350);
    });
  }

  searchInput.addEventListener('input', function (event) {
    clearTimeout(searchTimeout);
    searchRequestId++;
    wikiRequestId++;
    const query = this.value.trim();
    selectedResultIndex = -1;

    if (clearBtn) clearBtn.style.display = query.length > 0 ? 'flex' : 'none';

    if (!query) {
      showSearchHome();
      return;
    }

    if (event.isComposing) return;
    searchTimeout = setTimeout(() => {
      performSearch();
    }, 300);
  });

  searchInput.addEventListener('keydown', function (e) {
    const searchResults = document.getElementById('searchResults');
    const resultItems = searchResults.querySelectorAll('.search-result-item');

    if (e.key === 'Escape') {
      collapseSearchIsland();
      trigger?.focus({ preventScroll: true });
      selectedResultIndex = -1;
      return;
    }

    if (e.isComposing) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedResultIndex = Math.min(selectedResultIndex + 1, resultItems.length - 1);
      updateSelectedResult(resultItems, selectedResultIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedResultIndex = Math.max(selectedResultIndex - 1, -1);
      updateSelectedResult(resultItems, selectedResultIndex);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedResultIndex >= 0) {
        resultItems[selectedResultIndex]?.click();
      } else {
        clearTimeout(searchTimeout);
        performSearch({ online: true });
      }
    }
  });

  clearBtn?.addEventListener('click', () => {
    clearTimeout(searchTimeout);
    searchRequestId++;
    wikiRequestId++;
    selectedResultIndex = -1;
    searchInput.value = '';
    clearBtn.style.display = 'none';
    showSearchHome();
    document.getElementById('searchIsland')?.classList.remove('island-wide');
    searchInput.focus({ preventScroll: true });
  });

  // 點擊外部收合動態島
  // 用 composedPath() 而不是 island.contains(e.target)：點擊處理器可能在事件冒泡到 document 之前
  // 就把被點的元素換掉（例如點消歧義候選後整塊重繪成載入中），此時 e.target 已脫離 DOM，
  // contains() 會回傳 false，島就被誤判為「點了外面」而收合
  document.addEventListener('click', function (e) {
    if (!e.composedPath().includes(island)) {
      collapseSearchIsland();
      selectedResultIndex = -1;
    }
  });

  function updateSelectedResult(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}

// 手機鍵盤彈出時的版面穩定：
// 1. iOS 開鍵盤會平移 visual viewport，position:fixed 的元素是相對 layout viewport 定位，
//    島會被推到畫面外。把 visualViewport 的偏移與可視高度同步成 CSS 變數，讓島貼著「看得到的頂端」，
//    結果清單高度也不會超出鍵盤上方的剩餘空間。
// 2. 收起鍵盤後 iOS 常留下殘餘的文件捲動量（body 是 fixed，使用者自己捲不回來），
//    所有輸入框失焦後把它歸零——這就是「點一下動態島整個 UI 跑掉」的主要來源。
function setupViewportStabilizer(island) {
  const vv = window.visualViewport;
  if (vv) {
    const sync = () => {
      island.style.setProperty('--vv-offset-top', `${Math.max(0, vv.offsetTop)}px`);
      island.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    sync();
  }

  document.addEventListener('focusout', () => {
    // 等焦點真的落定：輸入框之間切換（例如緯度 → 經度）時不該歸零，免得鍵盤閃一下
    setTimeout(() => {
      const active = document.activeElement;
      if (active && active.matches && active.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (window.scrollX || window.scrollY || document.documentElement.scrollTop || document.body.scrollTop) {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      }
    }, 60);
  });
}
