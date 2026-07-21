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

// 展開/收合動態島
function expandSearchIsland() {
  const island = document.getElementById('searchIsland');
  if (!island) return;
  island.classList.add('expanded');
  const input = document.getElementById('searchInput');
  if (input) input.focus();
}

function collapseSearchIsland() {
  const island = document.getElementById('searchIsland');
  if (!island) return;
  island.classList.remove('expanded');
  const results = document.getElementById('searchResults');
  if (results) results.style.display = 'none';
  const input = document.getElementById('searchInput');
  if (input) input.blur();
}

// 執行搜尋
async function performSearch() {
  const searchInput = document.getElementById('searchInput');
  const searchResults = document.getElementById('searchResults');
  if (!searchInput || !searchResults) return;
  const query = searchInput.value.trim();

  if (!query) {
    searchResults.style.display = 'none';
    return;
  }

  if (!window.searchUtils) {
    console.error('[Map] Search utils 未載入');
    searchResults.innerHTML = '<div class="search-no-results">搜尋功能載入中，請稍後再試...</div>';
    searchResults.style.display = 'block';
    return;
  }

  const currentRequestId = ++searchRequestId;

  searchResults.innerHTML = '<div class="search-loading">搜尋中...</div>';
  searchResults.style.display = 'block';

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
      searchResults.innerHTML = '<div class="search-no-results">搜尋時發生錯誤</div>';
    }
  }
}

// 顯示搜尋結果
function displaySearchResults(results, query) {
  const searchResults = document.getElementById('searchResults');

  if (!results || results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">找不到相關地點</div>';
    searchResults.style.display = 'block';
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
  searchResults.style.display = 'block';

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

  trigger?.addEventListener('click', expandSearchIsland);

  searchInput.addEventListener('input', function () {
    clearTimeout(searchTimeout);
    const query = this.value.trim();
    selectedResultIndex = -1;

    if (clearBtn) clearBtn.style.display = query.length > 0 ? 'flex' : 'none';

    if (!query) {
      document.getElementById('searchResults').style.display = 'none';
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
    document.getElementById('searchResults').style.display = 'none';
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
