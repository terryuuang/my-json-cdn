/**
 * PWA 功能模組 - APEINTEL ATLAS
 * 功能：Service Worker 註冊、安裝提示、更新通知、iOS 教學
 */

// ============================================
// 全域變數
// ============================================
let deferredPrompt = null; // Android 安裝提示事件
let swRegistration = null; // Service Worker 註冊物件
let currentAppVersion = '0.1.1';

// ============================================
// 初始化
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  initPWA();
});

// 初始化 PWA 功能
function initPWA() {
  // 檢查瀏覽器是否支援 Service Worker
  if (!('serviceWorker' in navigator)) {
    console.log('[PWA] 此瀏覽器不支援 Service Worker');
    return;
  }

  registerServiceWorker();
  setupInstallPrompt();
  checkIOSInstallable();
  setupUpdateNotification();
}

// ============================================
// Service Worker 註冊
// ============================================
async function registerServiceWorker() {
  try {
    swRegistration = await navigator.serviceWorker.register('/sw.js', {
      scope: '/'
    });
    
    console.log('[PWA] Service Worker 註冊成功');

    // 檢查更新
    swRegistration.addEventListener('updatefound', () => {
      const newWorker = swRegistration.installing;
      console.log('[PWA] 發現新版本，正在安裝...');

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          // 新版本已安裝，顯示更新提示
          showUpdateNotification();
        }
      });
    });

    // 監聽 SW 訊息
    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    // 定期檢查更新（每 30 分鐘）
    setInterval(() => {
      swRegistration.update();
    }, 30 * 60 * 1000);

  } catch (error) {
    console.error('[PWA] Service Worker 註冊失敗:', error);
  }
}

// 處理 Service Worker 訊息
function handleSWMessage(event) {
  const { type, version } = event.data || {};

  switch (type) {
    case 'SW_ACTIVATED':
      console.log(`[PWA] Service Worker 已啟動，版本: ${version}`);
      currentAppVersion = version;
      // 新版本啟動後重新載入頁面
      if (sessionStorage.getItem('pwa_update_pending')) {
        sessionStorage.removeItem('pwa_update_pending');
        window.location.reload();
      }
      break;
  }
}

// ============================================
// Android 安裝提示
// ============================================
function setupInstallPrompt() {
  // 捕獲 beforeinstallprompt 事件
  window.addEventListener('beforeinstallprompt', (event) => {
    // 阻止預設的安裝提示
    event.preventDefault();
    deferredPrompt = event;
    console.log('[PWA] 安裝提示已準備就緒');
    
    // 顯示自訂安裝按鈕
    showInstallBanner();
  });

  // 監聽安裝完成事件
  window.addEventListener('appinstalled', () => {
    console.log('[PWA] 應用程式已安裝');
    deferredPrompt = null;
    hideInstallBanner();
    showToast('✅ 應用程式已成功安裝到主畫面！');
  });
}

// 檢查是否為行動裝置
function isMobileDevice() {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
         (navigator.maxTouchPoints > 1 && window.innerWidth < 1024);
}

// 顯示安裝提示（僅手機版，使用 confirm 對話框）
function showInstallBanner() {
  // 僅在手機版顯示，電腦版跳過
  if (!isMobileDevice()) {
    console.log('[PWA] 電腦版不顯示安裝提示');
    return;
  }

  // 檢查是否已經安裝（standalone 模式）
  if (window.matchMedia('(display-mode: standalone)').matches) {
    return;
  }

  // 檢查是否已經顯示過或使用者已拒絕
  const dismissed = localStorage.getItem('pwa_install_dismissed');
  if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) {
    return; // 7 天內不再顯示
  }

  // 延遲顯示 confirm 對話框（避免干擾頁面載入）
  setTimeout(() => {
    const userConfirmed = confirm('📱 安裝 APEINTEL ATLAS\n\n將地圖加入主畫面，享受更佳體驗！\n\n是否立即安裝？');
    if (userConfirmed) {
      installPWA();
    } else {
      dismissInstallBanner();
    }
  }, 1500);
}

// 隱藏安裝橫幅（保留函式相容性，改為 confirm 後不再需要實體移除）
function hideInstallBanner() {
  // 改用 confirm 對話框後，無需移除 DOM 元素
  console.log('[PWA] 安裝提示已關閉');
}

// 拒絕安裝
function dismissInstallBanner() {
  localStorage.setItem('pwa_install_dismissed', Date.now().toString());
  hideInstallBanner();
}

// 觸發安裝
async function installPWA() {
  if (!deferredPrompt) {
    console.log('[PWA] 安裝提示不可用');
    return;
  }

  // 顯示安裝提示
  deferredPrompt.prompt();

  // 等待使用者回應
  const { outcome } = await deferredPrompt.userChoice;
  console.log(`[PWA] 使用者選擇: ${outcome}`);

  if (outcome === 'accepted') {
    hideInstallBanner();
  }

  deferredPrompt = null;
}

// ============================================
// iOS 安裝教學
// ============================================

// 偵測 iOS 裝置類型
function detectIOSDevice() {
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad OS 13+
  const isSafari = /Safari/.test(ua) && !/Chrome|CriOS|FxiOS|EdgiOS/.test(ua);
  const isStandalone = window.navigator.standalone === true || 
                       window.matchMedia('(display-mode: standalone)').matches;
  const isIPad = /iPad/.test(ua) || 
                 (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  
  return { isIOS, isSafari, isStandalone, isIPad };
}

function checkIOSInstallable() {
  const { isIOS, isSafari, isStandalone, isIPad } = detectIOSDevice();

  if (isIOS && isSafari && !isStandalone) {
    // iOS Safari 但尚未安裝
    const dismissed = localStorage.getItem('pwa_ios_guide_dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 14 * 24 * 60 * 60 * 1000) {
      return; // 14 天內不再顯示
    }

    // 延遲顯示教學（避免干擾使用者）
    setTimeout(() => showIOSInstallGuide(isIPad), 3000);
  }
}

// 顯示 iOS 安裝教學
function showIOSInstallGuide(isIPad = false) {
  // 根據裝置類型調整說明
  const shareButtonLocation = isIPad ? '右上角' : '底部';
  const shareIcon = isIPad ? '↑' : '⬆';
  
  const guide = document.createElement('div');
  guide.id = 'pwa-ios-guide';
  guide.className = 'pwa-ios-guide';
  guide.innerHTML = `
    <div class="pwa-ios-content">
      <button class="pwa-ios-close" onclick="dismissIOSGuide()" aria-label="關閉">✕</button>
      <div class="pwa-ios-header">
        <img src="static/assets/APEINTEL ATLAS_192x192.png" alt="App Icon" class="pwa-ios-icon">
        <div class="pwa-ios-header-text">
          <h3>安裝 APEINTEL ATLAS</h3>
          <span class="pwa-ios-subtitle">加入主畫面，享受完整 APP 體驗</span>
        </div>
      </div>
      <div class="pwa-ios-steps">
        <div class="pwa-ios-step">
          <span class="pwa-ios-step-num">1</span>
          <div class="pwa-ios-step-content">
            <span>點擊 Safari ${shareButtonLocation}的「<strong>分享</strong>」按鈕</span>
            <span class="pwa-ios-share-icon">${shareIcon}</span>
          </div>
        </div>
        <div class="pwa-ios-step">
          <span class="pwa-ios-step-num">2</span>
          <div class="pwa-ios-step-content">
            <span>向下滑動選單，點擊「<strong>加入主畫面</strong>」</span>
            <span class="pwa-ios-add-icon">➕</span>
          </div>
        </div>
        <div class="pwa-ios-step">
          <span class="pwa-ios-step-num">3</span>
          <div class="pwa-ios-step-content">
            <span>點擊右上角「<strong>新增</strong>」完成安裝</span>
            <span class="pwa-ios-done-icon">✓</span>
          </div>
        </div>
      </div>
      <div class="pwa-ios-benefits">
        <div class="pwa-ios-benefit">
          <span class="pwa-ios-benefit-icon">📱</span>
          <span>全螢幕體驗</span>
        </div>
        <div class="pwa-ios-benefit">
          <span class="pwa-ios-benefit-icon">📴</span>
          <span>離線可用</span>
        </div>
        <div class="pwa-ios-benefit">
          <span class="pwa-ios-benefit-icon">⚡</span>
          <span>快速啟動</span>
        </div>
      </div>
      <button class="pwa-ios-dismiss-btn" onclick="dismissIOSGuide()">稍後再說</button>
    </div>
  `;
  document.body.appendChild(guide);

  setTimeout(() => guide.classList.add('show'), 100);
}

// 關閉 iOS 教學
function dismissIOSGuide() {
  localStorage.setItem('pwa_ios_guide_dismissed', Date.now().toString());
  const guide = document.getElementById('pwa-ios-guide');
  if (guide) {
    guide.classList.remove('show');
    setTimeout(() => guide.remove(), 300);
  }
}

// ============================================
// 更新通知
// ============================================
function setupUpdateNotification() {
  // 監聽頁面可見性變化，回到頁面時檢查更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && swRegistration) {
      swRegistration.update();
    }
  });
}

// 顯示更新通知
function showUpdateNotification() {
  // 檢查是否已顯示
  if (document.getElementById('pwa-update-toast')) {
    return;
  }

  const toast = document.createElement('div');
  toast.id = 'pwa-update-toast';
  toast.className = 'pwa-update-toast';
  toast.innerHTML = `
    <div class="pwa-update-content">
      <span class="pwa-update-icon">🔄</span>
      <div class="pwa-update-text">
        <strong>有新版本可用</strong>
        <span>點擊更新以取得最新功能</span>
      </div>
    </div>
    <div class="pwa-update-actions">
      <button class="pwa-update-btn pwa-update-btn-primary" onclick="applyUpdate()">立即更新</button>
      <button class="pwa-update-btn pwa-update-btn-secondary" onclick="dismissUpdate()">稍後</button>
    </div>
  `;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 100);
}

// 套用更新
function applyUpdate() {
  sessionStorage.setItem('pwa_update_pending', 'true');
  
  // 通知 SW 跳過等待
  if (swRegistration && swRegistration.waiting) {
    swRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
  }

  dismissUpdate();
  showToast('⏳ 正在更新，請稍候...');
  
  // 延遲重新載入（讓 SW 有時間啟動）
  setTimeout(() => {
    window.location.reload();
  }, 1000);
}

// 關閉更新提示
function dismissUpdate() {
  const toast = document.getElementById('pwa-update-toast');
  if (toast) {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }
}

// ============================================
// 通知權限
// ============================================
async function requestNotificationPermission() {
  if (!('Notification' in window)) {
    console.log('[PWA] 此瀏覽器不支援通知');
    return false;
  }

  // 如果已經允許
  if (Notification.permission === 'granted') {
    return true;
  }

  // 如果尚未決定，請求權限
  if (Notification.permission !== 'denied') {
    const permission = await Notification.requestPermission();
    return permission === 'granted';
  }

  // 如果被拒絕，顯示說明
  showNotificationPermissionGuide();
  return false;
}

// 顯示通知權限說明（當使用者之前拒絕過）
function showNotificationPermissionGuide() {
  const guide = document.createElement('div');
  guide.className = 'pwa-notification-guide';
  guide.innerHTML = `
    <div class="pwa-notification-content">
      <button class="pwa-notification-close" onclick="this.parentElement.parentElement.remove()" aria-label="關閉">✕</button>
      <h4>🔔 開啟通知權限</h4>
      <p>您之前拒絕了通知權限。如需開啟，請依照以下步驟：</p>
      <ol>
        <li>點擊瀏覽器網址列左側的「🔒」或「ⓘ」圖示</li>
        <li>找到「通知」設定</li>
        <li>將設定改為「允許」</li>
        <li>重新整理頁面</li>
      </ol>
      <button class="pwa-notification-dismiss" onclick="this.parentElement.parentElement.remove()">我知道了</button>
    </div>
  `;
  document.body.appendChild(guide);
  setTimeout(() => guide.classList.add('show'), 100);
}

// ============================================
// Toast 通知
// ============================================
function showToast(message, duration = 3000) {
  // 移除現有 toast
  const existing = document.querySelector('.pwa-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'pwa-toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ============================================
// 公開 API
// ============================================
window.PWA = {
  install: installPWA,
  checkUpdate: () => swRegistration?.update(),
  clearCache: async () => {
    if (swRegistration?.active) {
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(event.data.success);
        swRegistration.active.postMessage({ type: 'CLEAR_CACHE' }, [channel.port2]);
      });
    }
    return false;
  },
  getVersion: () => currentAppVersion,
  requestNotification: requestNotificationPermission,
  showToast: showToast
};

// 將安裝函式暴露到全域（供 HTML onclick 使用）
window.installPWA = installPWA;
window.dismissInstallBanner = dismissInstallBanner;
window.dismissIOSGuide = dismissIOSGuide;
window.applyUpdate = applyUpdate;
window.dismissUpdate = dismissUpdate;

