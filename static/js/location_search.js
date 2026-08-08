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
  fetchAndRenderWikiSummary(query, currentRequestId);

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
    }
  } catch (error) {
    console.error('[Map] 搜尋錯誤:', error);
    if (currentRequestId === searchRequestId) {
      const list = searchResults.querySelector('.search-location-list');
      if (list) list.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 百科卡片理想上放在地點清單「上方」（比起地點清單，查專有名詞時通常最想先看到百科摘要），
// 但百科查詢常常比地點搜尋慢，而且內容還會隨查詢進度變高（loading spinner → 摘要卡片／消歧義清單）。
// 只要百科區塊還壓在地點清單上面，它每次變高都會把已經顯示、可能正要被點擊的地點項目往下推，
// 讓點擊座標跟畫面對不上（點下去沒反應）。這裡在每次更新百科內容「之前」都重新判斷位置：
// 地點清單還沒有實際項目時放最上面（此時沒有人在點東西，放最上面不會有風險）；
// 一旦地點清單已經有項目，就固定改放最下面——不只是建立當下判斷一次，
// 而是每次更新都重新檢查並視需要搬移，這樣就算百科區塊是在地點清單出現「之前」就已經卡在最上面，
// 之後地點清單一出現，下一次百科內容更新也會把它搬到最下面，不會再讓後續的內容變高波及地點項目
function placeWikiSection(searchResults) {
  let section = searchResults.querySelector('.search-wiki-section');
  if (!section) {
    section = document.createElement('div');
    section.className = 'search-wiki-section';
  }
  const list = searchResults.querySelector('.search-location-list');
  const hasRenderedResults = !!(list && list.querySelector('.search-result-item'));
  if (hasRenderedResults) {
    if (searchResults.lastElementChild !== section) searchResults.appendChild(section);
  } else if (searchResults.firstElementChild !== section) {
    searchResults.prepend(section);
  }
  return section;
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
    const section = placeWikiSection(searchResults);
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
    // 百科卡片內容比純地點清單多（縮圖+摘要），查到才加寬，讓島隨內容量自適應而不是每次都佔滿最大寬度。
    // 但動態島是用 left:50% + translateX(-50%) 置中，變寬時兩側會對稱往外展開，
    // 連帶把島內所有內容（包含地點清單項目）一起橫向位移，且這個變寬有 0.4s 動畫。
    // 如果地點清單這時已經顯示出可點擊項目，使用者的點擊座標可能還沒反應過來這個橫移，
    // 導致點下去偏移到旁邊——所以只在地點清單「還沒有實際項目」時才加寬，
    // 已經有項目的話寧可百科卡片維持原本寬度（頂多文字換行多一點），優先保證點擊穩定
    const list = searchResults.querySelector('.search-location-list');
    const hasRenderedResults = !!(list && list.querySelector('.search-result-item'));
    if (!hasRenderedResults) {
      document.getElementById('searchIsland')?.classList.add('island-wide');
    }
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
  // 地點清單專用容器：跟百科區塊（.search-wiki-section）分開更新，
  // 避免其中一方 innerHTML 覆寫時把另一方也清掉，造成已顯示的結果列表突然被百科卡片頂下去
  let list = searchResults.querySelector('.search-location-list');
  if (!list) {
    list = document.createElement('div');
    list.className = 'search-location-list';
    searchResults.appendChild(list);
  }

  if (!results || results.length === 0) {
    list.innerHTML = '<div class="search-no-results">找不到相關地點</div>';
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

  list.innerHTML = html;
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
