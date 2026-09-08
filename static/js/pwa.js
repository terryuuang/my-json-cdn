/** Installation, offline status and explicit app updates. No framework required. */
(() => {
  let registration;
  let installPrompt;
  let updateRequested = false;
  let dataOffline = false;
  let installedThisSession = false;
  let version = '0.6.2';
  let lastFocus;
  let toastTimer;
  const standalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const byId = id => document.getElementById(id);

  function toast(message) {
    const el = byId('app-feedback');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 4500);
  }

  function workerMessage(type) {
    return new Promise((resolve, reject) => {
      const worker = navigator.serviceWorker?.controller || registration?.active;
      if (!worker) return reject(new Error('App 尚未準備完成'));
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('回應逾時')); }, 5000);
      channel.port1.onmessage = event => {
        clearTimeout(timer);
        channel.port1.close();
        resolve(event.data);
      };
      worker.postMessage({ type }, [channel.port2]);
    });
  }

  function renderInstall() {
    const installed = standalone() || installedThisSession;
    byId('app-install').hidden = installed;
    byId('app-install').textContent = installPrompt ? '安裝到主畫面' : '如何加入主畫面';
    byId('app-mode').textContent = standalone() ? '主畫面 App' : installedThisSession ? '已加入主畫面' : '瀏覽器模式';
    byId('app-install-help').hidden = installed;
    byId('app-install-help').textContent = ios()
      ? '開啟瀏覽器的「分享」選單，選擇「加入主畫面」，再點「新增」。若有「作為 Web App 打開」，請保持開啟；找不到選項時可改用 Safari。'
      : '使用瀏覽器選單的「安裝應用程式」或「加入主畫面」。支援直接安裝時，上方按鈕會開啟安裝確認。';
    document.body.classList.toggle('app-standalone', standalone());
  }

  function renderConnection() {
    const offline = !navigator.onLine || dataOffline;
    byId('app-connection').textContent = offline ? '目前離線' : '網路已連線';
    byId('app-connection').classList.toggle('is-offline', offline);
    byId('app-offline').hidden = !offline;
    byId('app-launcher').classList.toggle('is-offline', offline);
  }

  async function refreshStatus() {
    renderConnection();
    if (!navigator.serviceWorker?.controller && !registration?.active) return;
    try {
      const [info, status] = await Promise.all([workerMessage('GET_VERSION'), workerMessage('OFFLINE_STATUS')]);
      version = info.version;
      const versionLabel = byId('app-version');
      if (versionLabel) versionLabel.textContent = `版本 ${version}`;
      byId('app-cache-state').textContent = status.ready ? '地理資料已儲存' : '尚未儲存地理資料';
      byId('app-cache-date').textContent = status.cachedAt
        ? `儲存於 ${new Date(status.cachedAt).toLocaleString('zh-TW')}；此時間不是來源發布時間。`
        : '連線開啟地圖後會自動儲存；完成後可離線查看點位。';
    } catch (error) {
      console.warn('[PWA] 無法讀取離線狀態', error);
      byId('app-cache-state').textContent = '暫時無法讀取離線狀態';
    }
  }

  function open() {
    const sheet = byId('app-sheet');
    if (sheet.open) return;
    lastFocus = document.activeElement;
    renderInstall();
    refreshStatus();
    if (registration) showUpdate();
    sheet.appendChild(byId('app-feedback'));
    sheet.showModal();
    byId('app-close').focus();
  }

  async function install() {
    if (!installPrompt) {
      open();
      byId('app-install-help').focus();
      return;
    }
    const prompt = installPrompt;
    installPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === 'accepted') toast('已送出安裝要求');
    } catch (_) { toast('請使用瀏覽器選單加入主畫面'); }
    renderInstall();
  }

  async function showUpdate() {
    registration = await navigator.serviceWorker.getRegistration();
    const ready = !!navigator.serviceWorker.controller &&
      registration?.waiting?.state === 'installed' &&
      registration.waiting !== navigator.serviceWorker.controller;
    byId('app-update').hidden = !ready;
    byId('app-check').textContent = ready ? '有新版本可用' : '檢查更新';
  }

  async function checkUpdate() {
    if (!registration || !navigator.onLine) { toast('請連線後再檢查更新'); return; }
    const button = byId('app-check');
    button.disabled = true;
    try {
      await registration.update();
      await showUpdate();
      toast(registration.waiting ? '新版本已準備好' : registration.installing ? '正在下載新版本' : '已完成更新檢查');
    } catch (_) { toast('暫時無法檢查更新，請稍後再試'); }
    finally { button.disabled = false; }
  }

  async function applyUpdate() {
    registration = await navigator.serviceWorker.getRegistration();
    const worker = registration?.waiting;
    if (!worker || worker.state !== 'installed') return;
    // Only the requesting tab reloads, and only after the controller changes.
    if (typeof window.buildShareUrl === 'function') {
      history.replaceState(history.state, '', window.buildShareUrl());
    }
    updateRequested = true;
    byId('app-apply-update').disabled = true;
    worker.postMessage({ type: 'SKIP_WAITING' });
    toast('正在更新，將保留目前網址');
  }

  async function register() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      byId('app-cache-state').textContent = '此環境不支援離線儲存';
      return;
    }
    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'DATA_CONNECTION') {
        dataOffline = !event.data.online;
        renderConnection();
      }
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) {
        updateRequested = false;
        window.location.reload();
      } else {
        showUpdate();
        refreshStatus();
      }
    });
    try {
      registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' });
      showUpdate();
      const watched = new WeakSet();
      const watch = worker => {
        if (!worker || watched.has(worker)) return;
        watched.add(worker);
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed') {
            setTimeout(() => showUpdate(), 0);
            if (navigator.serviceWorker.controller) toast('新版本已準備好，可在 App 面板更新');
          } else if (worker.state === 'redundant' && !registration.active) {
            byId('app-cache-state').textContent = '離線準備未完成，請連線後重試';
          }
        });
      };
      registration.addEventListener('updatefound', event => watch(event.target.installing));
      watch(registration.installing);
      navigator.serviceWorker.ready.then(() => refreshStatus());
      let lastCheck = Date.now();
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        refreshStatus();
        if (navigator.onLine && Date.now() - lastCheck > 30 * 60 * 1000) {
          lastCheck = Date.now();
          registration.update().catch(() => {});
        }
      });
    } catch (_) {
      byId('app-cache-state').textContent = '離線準備未完成，請連線後重試';
    }
  }

  function init() {
    byId('app-launcher').addEventListener('click', open);
    byId('app-close').addEventListener('click', () => byId('app-sheet').close());
    byId('app-sheet').addEventListener('click', event => {
      if (event.target !== byId('app-sheet')) return;
      const rect = event.target.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) event.target.close();
    });
    byId('app-sheet').addEventListener('close', () => {
      document.body.appendChild(byId('app-feedback'));
      lastFocus?.focus();
    });
    byId('app-install').addEventListener('click', install);
    byId('app-check').addEventListener('click', checkUpdate);
    byId('app-apply-update').addEventListener('click', applyUpdate);
    byId('app-share').addEventListener('click', () => window.shareCurrentView());
    byId('app-clear').addEventListener('click', async () => {
      try {
        await workerMessage('CLEAR_CACHE');
        await refreshStatus();
        toast('已清除下載資料，個人筆記仍保留');
      } catch (_) { toast('暫時無法清除下載資料'); }
    });
    window.addEventListener('online', () => { dataOffline = false; refreshStatus(); });
    window.addEventListener('offline', refreshStatus);
    window.addEventListener('appinstalled', () => {
      installPrompt = null;
      installedThisSession = true;
      renderInstall();
      toast('已加入主畫面，可從 App 圖示開啟');
    });
    matchMedia('(display-mode: standalone)').addEventListener('change', renderInstall);
    renderInstall();
    renderConnection();
    register();
  }

  // Capture early; no automatic modal interrupts map use.
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    if (byId('app-install')) renderInstall();
  });
  document.addEventListener('DOMContentLoaded', init);
  window.PWA = {
    open, install, checkUpdate, getVersion: () => version, showToast: toast,
    clearCache: () => workerMessage('CLEAR_CACHE').then(result => result.success)
  };
})();
