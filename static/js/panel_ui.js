// ==========================================================
// panel_ui.js - 控制面板顯示/隱藏、資訊面板、變更日誌 modal
// ==========================================================


// 更新資訊面板
// 更新資訊面板，顯示點位統計資訊
function updateInfoPanel(message) {
  const infoPanel = document.getElementById('infoPanel');
  const infoText = document.getElementById('infoText');
  if (!infoPanel || !infoText) return;
  infoText.innerHTML = `
    <div class="info-panel-content">
      <span class="info-message">${message}</span>
      <span class="changelog-link" onclick="showChangelog(event)">更新資訊</span>
    </div>
  `;
  infoPanel.style.display = 'block';
}

// 顯示更新日誌彈窗
function showChangelog(event) {
  event.stopPropagation();
  
  // 關閉控制面板（如果是手機版）
  const controlPanel = document.getElementById('controlPanel');
  const panelBackdrop = document.getElementById('panelBackdrop');
  if (window.innerWidth <= 768) {
    controlPanel.classList.remove('active');
    panelBackdrop.style.display = 'none';
  }
  
  // 動態生成更新日誌內容
  const changelogBody = document.querySelector('.changelog-body');
  if (changelogBody) {
    changelogBody.innerHTML = CHANGELOG.map(item => `
      <div class="changelog-item">
        <span class="changelog-date">${item.date}：</span>
        <span class="changelog-desc">${item.description}</span>
      </div>
    `).join('');
  }
  
  // 顯示更新日誌 modal
  const modal = document.getElementById('changelogModal');
  if (modal) {
    modal.style.display = 'flex';
  }
}

// 關閉更新日誌彈窗
function closeChangelog() {
  const modal = document.getElementById('changelogModal');
  if (modal) {
    modal.style.display = 'none';
  }
}

// 組出可還原「目前畫面狀態」的分享連結
// layers=/osm= 已由 unified_dropdown.js / osm_facilities.js 即時同步進 URL，這裡只需
// 補上尚未即時同步的地圖中心點／縮放層級（base= 已由 map_init.js 的 switchBaseLayer 同步）
function buildShareUrl() {
  const urlParams = new URLSearchParams(window.location.search);

  try {
    if (window.map && typeof window.map.getCenter === 'function' && typeof window.map.getZoom === 'function') {
      const center = window.map.getCenter();
      urlParams.set('lat', center.lat.toFixed(6));
      urlParams.set('lng', center.lng.toFixed(6));
      urlParams.set('zoom', window.map.getZoom());
    }
  } catch (_) {
    // 地圖尚未初始化時，退回目前 URL 既有參數
  }

  return `${window.location.origin}${window.location.pathname}?${urlParams.toString()}${window.location.hash}`;
}

// 將文字複製到剪貼簿，並顯示成功/失敗提示（共用於各種「複製連結」按鈕）
async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }

    if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast('網址已複製');
    }
  } catch (error) {
    console.error('[Map] 複製網址失敗:', error);
    if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast('複製網址失敗', 'error');
    }
  }
}

// 沿用既有 URL（shape 模式等既有深連結參數不變，僅補上目前實際的地圖中心/縮放）
async function copyCurrentUrl() {
  const url = (() => {
    try {
      return decodeURI(buildShareUrl());
    } catch (_) {
      return buildShareUrl();
    }
  })();
  await copyTextToClipboard(url);
}

// 「分享目前畫面」按鈕：完整重建分享連結並複製
async function shareCurrentView() {
  await copyTextToClipboard(buildShareUrl());
}

// 隱藏/顯示控制面板
function closeControlPanel() {
  const panel = document.getElementById('controlPanel');
  const toggleBtn = document.querySelector('.toggle-panel:not(.toggle-panel-mobile)');
  if (!panel) return;

  panel.classList.remove('show-mobile');
  if (isMobileDevice()) {
    panel.classList.remove('hidden');
  } else {
    panel.classList.add('hidden');
  }

  // 桌面版按鈕使用 class 控制顯示
  if (toggleBtn) toggleBtn.classList.remove('panel-open');
}

function togglePanel() {
  const panel = document.getElementById('controlPanel');
  const toggleBtn = document.querySelector('.toggle-panel:not(.toggle-panel-mobile)');

  // 面板開啟時關閉目前的 popup，避免地圖因 popup-elevated 提升的 z-index 蓋住剛開啟的面板
  if (window.map && typeof window.map.closePopup === 'function') {
    window.map.closePopup();
  }

  if (isMobileDevice()) {
    // 手機版使用 show-mobile class
    panel.classList.toggle('show-mobile');
  } else {
    // 桌面版使用 hidden class
    panel.classList.toggle('hidden');
    // 面板展開時隱藏按鈕，避免重疊
    if (toggleBtn) {
      if (!panel.classList.contains('hidden')) {
        toggleBtn.classList.add('panel-open');
      } else {
        toggleBtn.classList.remove('panel-open');
      }
    }
  }
}

// 初始化面板顯示狀態
function initializePanelState() {
  const panel = document.getElementById('controlPanel');
  const mobileHint = document.getElementById('mobileHint');
  const toggleBtn = document.querySelector('.toggle-panel:not(.toggle-panel-mobile)');

  if (isMobileDevice()) {
    // 手機版預設隱藏
    panel.classList.remove('show-mobile');
    // 確保不使用桌面版的 hidden class
    panel.classList.remove('hidden');
    // 顯示手機版提示（如果存在）
    if (mobileHint) {
      mobileHint.style.display = 'block';
    }
  } else {
    // 桌面版預設顯示
    panel.classList.remove('hidden');
    panel.classList.remove('show-mobile');
    // 面板預設展開，按鈕需要隱藏
    if (toggleBtn) {
      toggleBtn.classList.add('panel-open');
    }
    // 隱藏手機版提示（如果存在）
    if (mobileHint) {
      mobileHint.style.display = 'none';
    }
  }
}

// 監聽視窗大小變化
function handleResize() {
const panel = document.getElementById('controlPanel');
const mobileHint = document.getElementById('mobileHint');
const toggleBtn = document.querySelector('.toggle-panel');

if (isMobileDevice()) {
    // 切換到手機版
    panel.classList.remove('hidden');
    if (mobileHint) {
        mobileHint.style.display = 'block';
    }
    if (!panel.classList.contains('show-mobile')) {
    // 如果面板是開啟狀態，保持開啟
    const wasVisible = !panel.classList.contains('hidden');
    if (wasVisible) {
        panel.classList.add('show-mobile');
    }
    }
    if (toggleBtn) {
        toggleBtn.style.zIndex = panel.classList.contains('show-mobile') ? '1400' : '1600';
    }
} else {
    // 切換到桌面版
    panel.classList.remove('show-mobile');
    if (mobileHint) {
        mobileHint.style.display = 'none';
    }
    // 桌面版預設顯示
    panel.classList.remove('hidden');
    if (toggleBtn) {
        toggleBtn.style.zIndex = '1400';
    }
}
}

// 清除目前繪製的圖形
function clearDrawings() {
  try {
    if (drawnItems) drawnItems.clearLayers();
  } catch (e) {
    console.warn('[Map] clearDrawings 失敗:', e);
  }
}

// 頂部提醒：滑入+3秒後淡出
function showTopNotice() {
  try {
    const el = document.getElementById('topNotice');
    if (!el) return;
    // 下一幀加入 .show 以觸發過渡
    requestAnimationFrame(() => {
      el.classList.add('show');
    });
    const DISPLAY_MS = 5000; // 顯示5秒
    setTimeout(() => {
      el.classList.add('hide');
      el.addEventListener('transitionend', () => {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      }, { once: true });
    }, DISPLAY_MS);
  } catch (e) {
    // 靜默失敗，不影響主流程
    console.warn('[Map] top notice 失敗:', e);
  }
}

// ==========================================================
// OSINT 工具浮動工具列（分享目前畫面／衛星過境預測／周邊航空動態）
// 視覺與互動比照 notes.js 的 addNotesControlToMap()，掛在地圖右下角
// ==========================================================
function initOsintToolbar(map) {
  if (!map || !window.L) return;

  const buttons = [
    {
      title: '分享目前畫面',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="18" cy="5" r="3"/>
        <circle cx="6" cy="12" r="3"/>
        <circle cx="18" cy="19" r="3"/>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
      </svg>`,
      onClick: () => shareCurrentView()
    },
    {
      title: '衛星過境預測',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 11a9 9 0 0 1 9 9"/>
        <path d="M4 4a16 16 0 0 1 16 16"/>
        <circle cx="5" cy="19" r="1.5" fill="currentColor" stroke="none"/>
      </svg>`,
      onClick: () => {
        if (!window.openSatellitePassPanelAllPresets) return;
        window.openSatellitePassPanelAllPresets();
      }
    },
    {
      title: '周邊航空動態',
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>`,
      onClick: () => {
        if (!window.openAdsbTrafficPanelAllPresets) return;
        window.openAdsbTrafficPanelAllPresets();
      }
    }
  ];

  const OsintToolbarControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const container = L.DomUtil.create('div', 'leaflet-control osint-toolbar');
      const stack = L.DomUtil.create('div', 'osint-toolbar-stack', container);

      buttons.forEach(btn => {
        const el = L.DomUtil.create('a', 'osint-toolbar-btn', stack);
        el.href = '#';
        el.title = btn.title;
        el.setAttribute('role', 'button');
        el.setAttribute('aria-label', btn.title);
        el.innerHTML = btn.svg;
        L.DomEvent.disableClickPropagation(el);
        L.DomEvent.on(el, 'click', function (e) {
          L.DomEvent.preventDefault(e);
          btn.onClick();
        });
      });

      return container;
    }
  });

  new OsintToolbarControl().addTo(map);
}
