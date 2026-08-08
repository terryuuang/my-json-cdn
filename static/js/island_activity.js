// ==========================================================
// island_activity.js - 動態島活動通知系統
// 將各模組的 loading/成功/錯誤狀態整合到搜尋動態島的收合標籤中顯示，
// 比照 Apple Dynamic Island 的 Live Activity 概念：
// 持續中的任務以「進行中」動畫呈現，完成後短暫顯示結果再回到天氣輪播
// ==========================================================
(function () {
  const RESULT_DISPLAY_MS = 2800;
  const FADE_MS = 180;

  let activityQueue = [];
  let currentActivity = null;
  let resultTimer = null;

  // 取得動態島 DOM 元素
  function getLabelEl() {
    return document.getElementById('searchIslandLabelText');
  }

  function getClipBox() {
    return document.getElementById('searchIslandLabel');
  }

  function getIsland() {
    return document.getElementById('searchIsland');
  }

  // 動態島展開中時不顯示活動（避免干擾搜尋）
  function isIslandExpanded() {
    const island = getIsland();
    return island && island.classList.contains('expanded');
  }

  // 暫停天氣輪播（讓活動通知獨佔標籤顯示區）
  function pauseWeatherCarousel() {
    const island = getIsland();
    if (island) island.dataset.activityActive = '1';
  }

  // 恢復天氣輪播
  function resumeWeatherCarousel() {
    const island = getIsland();
    if (island) delete island.dataset.activityActive;
  }

  // 檢查天氣輪播是否被暫停中
  function isCarouselPaused() {
    const island = getIsland();
    return island && island.dataset.activityActive === '1';
  }

  // 設定標籤文字（含淡入淡出動畫）
  function setLabel(text, opts = {}) {
    const clipBox = getClipBox();
    const inner = getLabelEl();
    if (!clipBox || !inner) return;

    clipBox.classList.add('island-label-fade');
    setTimeout(() => {
      inner.classList.remove('marquee');
      inner.style.transform = '';
      inner.style.removeProperty('--marquee-distance');
      inner.style.animationDuration = '';
      inner.style.animationDelay = '';
      inner.textContent = text;
      clipBox.classList.remove('island-label-fade');

      if (opts.onDone) {
        setTimeout(opts.onDone, 50);
      }
    }, FADE_MS);
  }

  // 更新動態島的活動指示器（島容器加上 class 以顯示旋轉圈圈）
  function setActivityIndicator(active, type = 'loading') {
    const island = getIsland();
    if (!island) return;
    island.classList.toggle('island-activity-loading', active && type === 'loading');
    island.classList.toggle('island-activity-success', active && type === 'success');
    island.classList.toggle('island-activity-error', active && type === 'error');
    island.classList.toggle('island-activity-warning', active && type === 'warning');
    if (!active) {
      island.classList.remove('island-activity-loading', 'island-activity-success', 'island-activity-error', 'island-activity-warning');
    }
  }

  // 開始一個活動（loading 狀態，可被後續 update/finish 更新）
  function startActivity(id, message) {
    if (isIslandExpanded()) {
      activityQueue.push({ id, message });
      return id;
    }

    clearResultTimer();
    pauseWeatherCarousel();
    currentActivity = { id, message, startTime: Date.now() };
    setActivityIndicator(true, 'loading');
    setLabel(message);
    return id;
  }

  // 更新活動文字（例如進度）
  function updateActivity(id, message) {
    if (currentActivity && currentActivity.id === id) {
      setLabel(message);
    }
  }

  // 完成活動，短暫顯示結果後恢復天氣輪播
  function finishActivity(id, message, type = 'success') {
    if (!currentActivity || currentActivity.id !== id) {
      // 活動已被取代或不存在，直接用短暫提示
      showTransient(message, type);
      return;
    }

    currentActivity = null;
    setActivityIndicator(true, type);
    setLabel(message);

    clearResultTimer();
    resultTimer = setTimeout(() => {
      setActivityIndicator(false);
      resumeWeatherCarousel();
      processQueue();
    }, RESULT_DISPLAY_MS);
  }

  // 取消活動（不顯示結果訊息，直接恢復）
  function cancelActivity(id) {
    if (currentActivity && currentActivity.id === id) {
      currentActivity = null;
      setActivityIndicator(false);
      resumeWeatherCarousel();
      processQueue();
    }
    activityQueue = activityQueue.filter(a => a.id !== id);
  }

  // 短暫通知（非綁定活動的一次性提示，例如「網址已複製」）
  function showTransient(message, type = 'success', duration = RESULT_DISPLAY_MS) {
    if (isIslandExpanded()) return;

    clearResultTimer();
    pauseWeatherCarousel();
    currentActivity = null;
    setActivityIndicator(true, type);
    setLabel(message);

    resultTimer = setTimeout(() => {
      setActivityIndicator(false);
      resumeWeatherCarousel();
      processQueue();
    }, duration);
  }

  function clearResultTimer() {
    if (resultTimer) {
      clearTimeout(resultTimer);
      resultTimer = null;
    }
  }

  // 處理佇列中等待的活動
  function processQueue() {
    if (activityQueue.length === 0) return;
    const next = activityQueue.shift();
    startActivity(next.id, next.message);
  }

  // 產生唯一 ID
  let idCounter = 0;
  function generateId(prefix = 'activity') {
    return `${prefix}-${++idCounter}-${Date.now()}`;
  }

  // 公開 API
  window.IslandActivity = {
    start: startActivity,
    update: updateActivity,
    finish: finishActivity,
    cancel: cancelActivity,
    transient: showTransient,
    generateId,
    isCarouselPaused
  };
})();

// ==========================================================
// Apple 風格 Bottom Sheet（手機版 OSINT 面板共用）
// 三段吸附：minimized（僅標題列）/ half（預設半高）/ full（近全螢幕）
// 拖曳拉桿可上下滑動，鬆手後依速度/位置吸附到最近斷點
// ==========================================================
window.setupOsintBottomSheet = function (dialogBox, headerEl, setMinimized, onClose) {
  const isMobile = () => window.innerWidth <= 768;
  const SNAP_MINIMIZED = 0.08;
  const SNAP_HALF = 0.50;
  const SNAP_FULL = 0.92;
  const VELOCITY_THRESHOLD = 0.4;

  let startY = 0;
  let lastY = 0;
  let lastTime = 0;
  let velocityY = 0;
  let isDragging = false;
  let currentSnap = 'half';

  function getSnapPx(snap) {
    const vh = window.innerHeight;
    if (snap === 'full') return vh * SNAP_FULL;
    if (snap === 'half') return vh * SNAP_HALF;
    return vh * SNAP_MINIMIZED;
  }

  function applySnap(snap, animate = true) {
    currentSnap = snap;
    const height = getSnapPx(snap);
    dialogBox.style.transition = animate
      ? 'max-height 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
      : 'none';
    dialogBox.style.maxHeight = `${height}px`;
    dialogBox.style.transform = '';
    setMinimized(snap === 'minimized');
  }

  if (isMobile()) {
    requestAnimationFrame(() => applySnap('half', false));
  }

  headerEl.addEventListener('touchstart', (e) => {
    if (!isMobile()) return;
    isDragging = true;
    startY = e.touches[0].clientY;
    lastY = startY;
    lastTime = Date.now();
    velocityY = 0;
    dialogBox.style.transition = 'none';
  }, { passive: true });

  headerEl.addEventListener('touchmove', (e) => {
    if (!isDragging || !isMobile()) return;
    const touchY = e.touches[0].clientY;
    const now = Date.now();
    const dt = now - lastTime;
    if (dt > 0) velocityY = (touchY - lastY) / dt;
    lastY = touchY;
    lastTime = now;

    const dy = touchY - startY;
    const baseHeight = getSnapPx(currentSnap);
    const newHeight = Math.max(40, Math.min(window.innerHeight * 0.95, baseHeight - dy));
    dialogBox.style.maxHeight = `${newHeight}px`;
  }, { passive: true });

  headerEl.addEventListener('touchend', () => {
    if (!isDragging || !isMobile()) return;
    isDragging = false;

    const currentHeight = dialogBox.getBoundingClientRect().height;
    const vh = window.innerHeight;

    if (Math.abs(velocityY) > VELOCITY_THRESHOLD) {
      if (velocityY < 0) {
        applySnap(currentSnap === 'minimized' ? 'half' : 'full');
      } else {
        if (currentSnap === 'full') applySnap('half');
        else if (currentSnap === 'half') applySnap('minimized');
        else onClose();
      }
      return;
    }

    const snapPoints = [
      { name: 'minimized', h: vh * SNAP_MINIMIZED },
      { name: 'half', h: vh * SNAP_HALF },
      { name: 'full', h: vh * SNAP_FULL }
    ];
    let closest = snapPoints[0];
    let closestDist = Math.abs(currentHeight - closest.h);
    for (const sp of snapPoints) {
      const dist = Math.abs(currentHeight - sp.h);
      if (dist < closestDist) { closest = sp; closestDist = dist; }
    }

    if (currentHeight < vh * SNAP_MINIMIZED * 0.5) {
      onClose();
    } else {
      applySnap(closest.name);
    }
  });

  return { applySnap, getCurrentSnap: () => currentSnap };
};

