/**
 * 統一下拉選單系統
 * 支持分層篩選和公共設施的多選下拉選單
 */

// 所有軍事圖層列表（預設勾選，排除公共設施）
const ALL_MILITARY_LAYERS = [
  "中國軍工及航天產業",
  "武裝警察、海外軍事設施及其他分類",
  "解放軍海軍、海軍陸戰隊基地及設施",
  "解放軍火箭軍",
  "解放軍空軍、海軍航空兵基地及設施",
  "解放軍軍事航天部隊、網路空間部隊、信息支援部隊",
  "解放軍軍事院校、教育單位",
  "解放軍重要訓場/特殊設施",
  "解放軍陸軍、陸軍防空單位、聯勤保障設施、預備役部隊(部分設施為個人推斷)",
  "黨和國家重要政經軍事機關"
];

// 追蹤已選擇的圖層
let selectedLayers = new Set();

// 設置下拉選單
function setupDropdowns() {
  // 點擊外部關閉所有下拉選單
  document.addEventListener('click', function(e) {
    const dropdowns = document.querySelectorAll('.dropdown-menu');
    const isDropdownClick = e.target.closest('.unified-dropdown');

    if (!isDropdownClick) {
      dropdowns.forEach(menu => {
        if (menu.style.display !== 'none') {
          menu.style.display = 'none';
          const toggle = menu.previousElementSibling;
          if (toggle) toggle.classList.remove('active');
        }
      });
    }
  });

  // 從 URL 載入圖層選擇狀態
  loadLayerSelectionFromUrl();
}

// 判斷是否為手機設備 (如果尚未定義)
if (!window.isMobileDevice) {
  window.isMobileDevice = function() {
    return window.innerWidth <= 768;
  };
}

function isMobileDevice() {
  return window.isMobileDevice();
}

// 切換圖層篩選下拉選單
function toggleLayerDropdown() {
  const menu = document.getElementById('layerDropdownMenu');
  const btn = menu.previousElementSibling;
  const container = menu.parentElement;

  if (menu.style.display === 'none' || !menu.style.display) {
    // 關閉其他下拉選單
    closeAllDropdowns();

    // 計算並設置位置 (桌面版)
    if (!isMobileDevice()) {
      // 儲存原始父元素
      menu.dataset.originalParent = container.id || 'layerDropdownParent';
      container.id = menu.dataset.originalParent;

      // 移動到 body 以避免 backdrop-filter 的定位影響
      document.body.appendChild(menu);

      positionDropdown(menu, btn);
    }

    menu.style.display = 'flex';
    btn.classList.add('active');
  } else {
    menu.style.display = 'none';
    btn.classList.remove('active');

    // 桌面版：將選單移回原位
    if (!isMobileDevice() && menu.dataset.originalParent) {
      const originalParent = document.getElementById(menu.dataset.originalParent);
      if (originalParent) {
        originalParent.appendChild(menu);
      }
    }
  }
}

// 智能定位下拉選單（向上或向下顯示）
function positionDropdown(menu, btn, forceDownward = false) {
  const rect = btn.getBoundingClientRect();
  const menuMaxHeight = 360; // 與 CSS 中的 max-height 一致
  const spacing = 4;

  if (forceDownward) {
    // 強制向下顯示
    menu.style.top = `${rect.bottom + spacing}px`;
    menu.style.bottom = 'auto';
    menu.classList.remove('show-above');
  } else {
    // 智能判斷顯示方向
    // 計算下方和上方的可用空間
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // 判斷是否向上顯示
    const showAbove = spaceBelow < menuMaxHeight && spaceAbove > spaceBelow;

    if (showAbove) {
      // 向上顯示
      menu.style.bottom = `${window.innerHeight - rect.top + spacing}px`;
      menu.style.top = 'auto';
      menu.classList.add('show-above');
    } else {
      // 向下顯示
      menu.style.top = `${rect.bottom + spacing}px`;
      menu.style.bottom = 'auto';
      menu.classList.remove('show-above');
    }
  }

  menu.style.left = `${rect.left}px`;
  menu.style.width = `${Math.max(rect.width, 280)}px`;
}

// 處理圖層選擇變化
function handleLayerChange(checkbox) {
  const layer = checkbox.value;

  if (checkbox.checked) {
    selectedLayers.add(layer);
  } else {
    selectedLayers.delete(layer);
  }

  updateLayerCount();
  applyLayerFilter();
}

// 更新圖層選擇計數顯示
function updateLayerCount() {
  const el = document.getElementById('layerSelectedCount');
  if (!el) return;

  const count = selectedLayers.size;
  if (count === 0) {
    el.textContent = '顯示全部分層';
  } else if (count === 1) {
    const layer = Array.from(selectedLayers)[0];
    // 顯示簡短名稱
    const shortName = layer.replace('解放軍', '').replace('及設施', '').replace('、', '/');
    el.textContent = shortName.length > 15 ? shortName.substring(0, 15) + '...' : shortName;
  } else {
    el.textContent = `已選 ${count} 項`;
  }
}

// 應用圖層篩選
function applyLayerFilter() {
  // 優先從 URL 獲取座標，如果沒有則從輸入框獲取
  let urlCoords = window.parseUrlCoordinates ? window.parseUrlCoordinates() : null;
  const urlParams = new URLSearchParams(window.location.search);
  let radius = parseFloat(urlParams.get('radius')) || 50;

  // 如果 URL 沒有座標，從輸入框獲取（輸入框在初始化時已包含預設值）
  if (!urlCoords) {
    const latInput = document.getElementById('latInput');
    const lngInput = document.getElementById('lngInput');
    const radiusInput = document.getElementById('radiusInput');

    const lat = parseFloat(latInput?.value);
    const lng = parseFloat(lngInput?.value);

    if (!isNaN(lat) && !isNaN(lng)) {
      urlCoords = { lat, lng };
      radius = parseFloat(radiusInput?.value) || 100;
    }
  }

  // 檢查是否所有軍事圖層都被勾選
  const isAllMilitaryLayersSelected = ALL_MILITARY_LAYERS.every(layer => selectedLayers.has(layer));

  // 更新 URL 參數
  // 只有在不是所有軍事圖層都被勾選時，才添加 layers 參數
  if (selectedLayers.size > 0 && !isAllMilitaryLayersSelected) {
    urlParams.set('layers', Array.from(selectedLayers).join(','));
  } else {
    urlParams.delete('layers');
  }

  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
  window.history.pushState({}, '', newUrl);

  // 重新渲染
  const layersArray = Array.from(selectedLayers);
  const shapeParam = (urlParams.get('shape') || '').trim().toLowerCase();

  if (shapeParam && window.shapeUtils && window.renderShapeMode) {
    const shapeSpec = window.shapeUtils.parseShapeParams(urlParams);

    // 處理多圖層選擇：預先過濾特徵
    if (layersArray.length > 0) {
      const originalFeatures = window.allFeatures;
      const filteredFeatures = getFilteredFeatures(layersArray);

      // 暫時替換 allFeatures
      window.allFeatures = filteredFeatures;

      // 渲染（selectedLayer 設為 null 因為已經預先過濾）
      window.renderShapeMode(shapeSpec, null);

      // 恢復原始特徵
      window.allFeatures = originalFeatures;
    } else {
      window.renderShapeMode(shapeSpec, null);
    }
  } else {
    renderMapWithMultipleLayers(urlCoords, radius, layersArray);
  }
}

// 獲取過濾後的特徵（返回特徵陣列）
function getFilteredFeatures(layers) {
  if (!window.allFeatures) return [];

  if (layers.length === 0) {
    return window.allFeatures;
  }

  let filteredFeatures = [];

  layers.forEach(layer => {
    const layerFeatures = window.filterFeaturesByLayer
      ? window.filterFeaturesByLayer(window.allFeatures, layer)
      : window.allFeatures;

    const features = layerFeatures.features || layerFeatures;
    if (Array.isArray(features)) {
      filteredFeatures = filteredFeatures.concat(features);
    }
  });

  return filteredFeatures;
}

// 渲染多圖層模式
function renderMapWithMultipleLayers(coords, radius, layers) {
  if (!window.allFeatures || !window.renderMap) return;

  if (layers && layers.length > 0) {
    const filteredFeatures = getFilteredFeatures(layers);

    // 暫時替換 allFeatures
    const originalFeatures = window.allFeatures;
    window.allFeatures = filteredFeatures;

    // 渲染地圖
    window.renderMap(coords, radius, null);

    // 恢復原始特徵
    window.allFeatures = originalFeatures;
  } else {
    window.renderMap(coords, radius, null);
  }
}

// 清除所有圖層選擇
function clearAllLayerSelections() {
  document.querySelectorAll('#layerDropdownMenu input[type="checkbox"]').forEach(cb => {
    cb.checked = false;
  });
  selectedLayers.clear();
  updateLayerCount();
  applyLayerFilter();
}

// 關閉所有下拉選單
function closeAllDropdowns() {
  document.querySelectorAll('.dropdown-menu').forEach(menu => {
    menu.style.display = 'none';

    // 移除 active 狀態（需要找到對應的 toggle 按鈕）
    const menuId = menu.id;
    if (menuId) {
      const toggle = document.querySelector(`[onclick*="${menuId}"]`)?.closest('.unified-dropdown')?.querySelector('.dropdown-toggle');
      if (toggle) toggle.classList.remove('active');
    }

    // 桌面版：將選單移回原位
    if (!isMobileDevice() && menu.dataset.originalParent) {
      const originalParent = document.getElementById(menu.dataset.originalParent);
      if (originalParent) {
        originalParent.appendChild(menu);
      }
    }
  });
}

// 更新 togglePanel 函數以支持背景遮罩
function togglePanel() {
  const panel = document.getElementById('controlPanel');
  const backdrop = document.getElementById('panelBackdrop');
  const toggleBtn = document.querySelector('.toggle-panel');

  if (isMobileDevice()) {
    const isOpen = panel.classList.contains('show-mobile');

    if (isOpen) {
      // 關閉面板
      panel.classList.remove('show-mobile');
      backdrop.classList.remove('show');
      if (toggleBtn) toggleBtn.style.zIndex = '1600';
    } else {
      // 開啟面板
      panel.classList.add('show-mobile');
      backdrop.classList.add('show');
      if (toggleBtn) toggleBtn.style.zIndex = '1400';
    }
  } else {
    // 桌面版
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      if (toggleBtn) toggleBtn.style.zIndex = '1400';
    } else {
      if (toggleBtn) toggleBtn.style.zIndex = '1600';
    }
  }
}

// 關閉面板 (供背景遮罩點擊使用)
function closePanel() {
  const panel = document.getElementById('controlPanel');
  const backdrop = document.getElementById('panelBackdrop');
  const toggleBtn = document.querySelector('.toggle-panel');

  if (isMobileDevice()) {
    panel.classList.remove('show-mobile');
    backdrop.classList.remove('show');
    if (toggleBtn) toggleBtn.style.zIndex = '1600';
  }

  // 同時關閉所有下拉選單
  closeAllDropdowns();
}

// 從 URL 載入圖層選擇狀態
function loadLayerSelectionFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const layersParam = urlParams.get('layers');

  if (layersParam) {
    // 如果 URL 有指定圖層，使用 URL 指定的圖層
    const layers = layersParam.split(',');
    layers.forEach(layer => {
      selectedLayers.add(layer);
      const checkbox = document.querySelector(`#layerDropdownMenu input[value="${layer}"]`);
      if (checkbox) checkbox.checked = true;
    });
    updateLayerCount();
  } else {
    // 如果 URL 沒有指定圖層，預設勾選所有軍事圖層（排除公共設施）
    ALL_MILITARY_LAYERS.forEach(layer => {
      selectedLayers.add(layer);
      const checkbox = document.querySelector(`#layerDropdownMenu input[value="${layer}"]`);
      if (checkbox) checkbox.checked = true;
    });
    updateLayerCount();
  }
}

// 更新 OSM 下拉選單切換函數以使用統一樣式
function toggleOSMDropdown() {
  const menu = document.getElementById('osmDropdownMenu');
  const btn = menu.previousElementSibling;
  const container = menu.parentElement;

  if (menu.style.display === 'none' || !menu.style.display) {
    // 關閉其他下拉選單
    closeAllDropdowns();

    // 計算並設置位置 (桌面版)
    if (!isMobileDevice()) {
      // 儲存原始父元素
      menu.dataset.originalParent = container.id || 'osmDropdownParent';
      container.id = menu.dataset.originalParent;

      // 移動到 body 以避免 backdrop-filter 的定位影響
      document.body.appendChild(menu);

      // 公共設施選單固定向下顯示
      positionDropdown(menu, btn, true);
    }

    menu.style.display = 'flex';
    btn.classList.add('active');
  } else {
    menu.style.display = 'none';
    btn.classList.remove('active');

    // 桌面版：將選單移回原位
    if (!isMobileDevice() && menu.dataset.originalParent) {
      const originalParent = document.getElementById(menu.dataset.originalParent);
      if (originalParent) {
        originalParent.appendChild(menu);
      }
    }
  }
}

// 初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setupDropdowns);
} else {
  setupDropdowns();
}

// 匯出全域函數
window.toggleLayerDropdown = toggleLayerDropdown;
window.handleLayerChange = handleLayerChange;
window.clearAllLayerSelections = clearAllLayerSelections;
window.togglePanel = togglePanel;
window.closePanel = closePanel;
window.toggleOSMDropdown = toggleOSMDropdown;
window.setupDropdowns = setupDropdowns;
window.renderMapWithMultipleLayers = renderMapWithMultipleLayers;
window.getSelectedLayers = function() { return Array.from(selectedLayers); };
