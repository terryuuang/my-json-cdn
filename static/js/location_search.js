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
    alert('請輸入有效的經緯度數值！');
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

// 展開/收合動態島前，先把目前實際寬度鎖成 inline style，
// 讓 class 切換後的目標寬度（CSS .expanded 規則）能跟這個鎖定值之間跑 transition，
// 而不是直接從 width:auto 跳過去（auto 沒辦法平滑動畫）
function lockIslandWidth(island) {
  const currentWidth = island.getBoundingClientRect().width;
  island.style.width = `${currentWidth}px`;
  void island.offsetWidth; // 強制 reflow，確保鎖定寬度已經套用到畫面上
}

// 用兩次 requestAnimationFrame 才放開鎖定的寬度：第一次只是排入下一輪繪製，
// 瀏覽器不保證這時候上一步的 reflow 真的已經定案；等到第二次 rAF 才放開，
// 才能穩定觸發 width 從鎖定值→目標值的 transition（單次 rAF 在部分瀏覽器會直接跳過動畫）
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
  if (focusInput) {
    const input = document.getElementById('searchInput');
    if (input) input.focus();
  }
}

function collapseSearchIsland() {
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
async function performSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  if (!searchInput || !searchResults) return;
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.classList.remove('show');
    return;
  }

  if (!window.searchUtils) {
    console.error('[Map] Search utils 未載入');
    searchResults.innerHTML = '<div class="search-no-results">搜尋功能載入中，請稍後再試...</div>';
    searchResults.classList.add('show');
    return;
  }

  const currentRequestId = ++searchRequestId;

  searchResults.innerHTML = SEARCH_SKELETON_HTML;
  searchResults.classList.add('show');
  // 新查詢一律先收回加寬狀態，等百科卡片真的查到才重新加寬，避免沿用上一次查詢的寬度
  document.getElementById('searchIsland')?.classList.remove('island-wide');

  try {
    // 使用混合搜尋：本地 GeoJSON + Nominatim API
    const results = await window.searchUtils.searchCombined(allFeatures, query, {
      searchFields: ['名稱', '說明', 'layer'],
      maxResults: isMobileDevice() ? 20 : 50,
      includeNominatim: true,
      nominatimMaxResults: 5
    });

    if (currentRequestId === searchRequestId) {
      displaySearchResults(results, query);
      // 百科查詢跟地點結果並行、各自獨立顯示狀態，不會拖慢地點結果的呈現速度
      fetchAndRenderWikiSummary(query, currentRequestId);
    }
  } catch (error) {
    console.error('[Map] 搜尋錯誤:', error);
    if (currentRequestId === searchRequestId) {
      searchResults.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 查詢並顯示專有名詞的維基百科摘要（OSINT 用途：地名/單位/人名等查詢時順便附上百科簡介）
// 跟地點結果各自獨立一個 request id，避免使用者連續輸入時，較慢回來的百科結果蓋掉最新查詢
async function fetchAndRenderWikiSummary(query, searchId) {
  const searchResults = document.getElementById('searchResults');
  if (!searchResults || !window.equipmentParser || query.length < 2) return;

  const currentWikiId = ++wikiRequestId;
  const isStale = () => searchId !== searchRequestId || currentWikiId !== wikiRequestId;

  const renderSection = (innerHtml) => {
    if (isStale()) return;
    let section = searchResults.querySelector('.search-wiki-section');
    if (!section) {
      section = document.createElement('div');
      section.className = 'search-wiki-section';
      // 百科卡片放最上面：比起地點清單，使用者查專有名詞時通常最想先看到的是百科摘要
      searchResults.prepend(section);
    }
    section.innerHTML = `<div class="search-wiki-section-label">百科</div>${innerHtml}`;
  };

  renderSection(`<div class="search-wiki-loading"><span class="search-wiki-spinner"></span>正在查詢維基百科...</div>`);

  // 一般摘要卡片（含消歧義選完之後、回頭再查一次確切條目的情境，兩處共用同一個渲染函式）
  function renderWikiCard(info, fallbackTitle) {
    const mediaHtml = info.thumbnail
      ? `<div class="search-wiki-card-media"><img src="${info.thumbnail}" alt="${escapeHtml(info.title || fallbackTitle)}" loading="lazy"></div>`
      : '';
    const linkHtml = info.wikipediaUrl
      ? `<a href="${info.wikipediaUrl}" target="_blank" rel="noopener noreferrer" class="search-wiki-card-link">維基百科原文</a>`
      : '';
    renderSection(`
      <div class="search-wiki-card">
        ${mediaHtml}
        <div class="search-wiki-card-body">
          <div class="search-wiki-card-title">${escapeHtml(info.title || fallbackTitle)}</div>
          <div class="search-wiki-card-desc">${escapeHtml(info.description || '（無簡介）')}</div>
          ${linkHtml}
        </div>
      </div>
    `);
    // 百科卡片內容比純地點清單多（縮圖+摘要），查到才加寬，讓島隨內容量自適應而不是每次都佔滿最大寬度
    document.getElementById('searchIsland')?.classList.add('island-wide');
  }

  // 消歧義候選清單：直接列出前 3 個候選條目讓使用者自己點，不盲猜第一個避免選錯
  function renderDisambiguation(info) {
    const itemsHtml = info.candidates.map(c => `
      <button type="button" class="search-wiki-disambig-item" data-title="${escapeHtml(c.title)}">
        <span class="search-wiki-disambig-title">${escapeHtml(c.title)}</span>
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
        renderSection(`<div class="search-wiki-loading"><span class="search-wiki-spinner"></span>正在查詢維基百科...</div>`);
        try {
          const picked = await window.equipmentParser.fetchPageSummaryByLangTitle('zh', title);
          if (isStale()) return;
          if (!picked) {
            // 理論上候選已過濾掉查無資料的條目，這裡是保底：查失敗時給明確提示而不是整塊悄悄消失
            renderSection(`<div class="search-wiki-empty">查無「${escapeHtml(title)}」的摘要資料</div>`);
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

  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">找不到相關地點</div>';
    searchResults.classList.add('show');
    return;
  }

  let html = '';
  results.forEach((result, index) => {
    const name = result.displayName || result.name || '未命名';
    const layer = toDisplayLayerName(result.layer || '未分類');
    const coords = result.coordinates;
    const coordsText = coords ? `${coords[1].toFixed(4)}, ${coords[0].toFixed(4)}` : '';
    const source = result.source || 'local';

    // 高亮匹配文本（僅對本地結果）
    const displayName = source === 'local'
      ? window.searchUtils.highlightMatch(name, query)
      : name;

    // 來源標記
    const sourceIcon = source === 'nominatim'
      ? '<span class="search-source-badge" title="來自 OpenStreetMap">🌍</span>'
      : '';

    html += `
      <div class="search-result-item ${source === 'nominatim' ? 'nominatim-result' : ''}" onclick="selectSearchResult(${index})">
        <div class="search-result-name">${displayName} ${sourceIcon}</div>
        <div class="search-result-layer">${layer}</div>
        <div class="search-result-coords">${coordsText}</div>
      </div>
    `;
  });

  searchResults.innerHTML = html;
  searchResults.classList.add('show');

  // 保存結果供選擇使用
  window.currentSearchResults = results;
}

// 選擇搜尋結果
function selectSearchResult(index) {
  const results = window.currentSearchResults;
  if (!results || !results[index]) return;

  const result = results[index];
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

  trigger?.addEventListener('click', () => expandSearchIsland());

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
      if (document.activeElement === searchInput) return;
      hoverCollapseTimer = setTimeout(() => {
        if (document.activeElement !== searchInput) collapseSearchIsland();
      }, 350);
    });
  }

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    const query = this.value.trim();
    selectedResultIndex = -1;

    if (clearBtn) clearBtn.style.display = query.length > 0 ? 'flex' : 'none';

    if (!query) {
      document.getElementById('searchResults').classList.remove('show');
      return;
    }

    searchTimeout = setTimeout(() => {
      performSearch();
    }, 300);
  });

  searchInput.addEventListener('keydown', function (e) {
    const searchResults = document.getElementById('searchResults');
    const resultItems = searchResults.querySelectorAll('.search-result-item');

    if (e.key === 'Escape') {
      collapseSearchIsland();
      selectedResultIndex = -1;
      return;
    }

    if (!resultItems.length) return;

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
        selectSearchResult(selectedResultIndex);
      } else {
        performSearch();
      }
    }
  });

  clearBtn?.addEventListener('click', () => {
    searchInput.value = '';
    clearBtn.style.display = 'none';
    document.getElementById('searchResults').classList.remove('show');
    searchInput.focus();
  });

  // 點擊外部收合動態島
  document.addEventListener('click', function (e) {
    if (!island.contains(e.target)) {
      collapseSearchIsland();
      selectedResultIndex = -1;
    }
  });

  function updateSelectedResult(items, index) {
    items.forEach((item, i) => {
      if (i === index) {
        item.classList.add('selected');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('selected');
      }
    });
  }
}
