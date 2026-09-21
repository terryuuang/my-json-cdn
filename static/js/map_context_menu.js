// ==========================================================
// map_context_menu.js - 地圖右鍵／長按選單
// 桌面：在地圖上按右鍵；手機：長按 500ms
// 目前只有一個動作「搜尋此座標」，等同把該點填進控制面板的經緯度後按下搜尋，
// 使用者不必先展開面板、也不用自己抄座標
// ==========================================================

window.MapContextMenu = (() => {
  const LONG_PRESS_MS = 500;
  const MOVE_TOLERANCE_PX = 10;
  const EDGE_GAP_PX = 8;
  // 選單剛開啟後的緩衝：長按放開手指時，瀏覽器會補一次 click、Leaflet 也可能因為手指
  // 微幅移動送出 movestart，兩者都會被當成「點到地圖別處」而立刻關掉選單——這正是手機
  // 上選單閃一下就消失的原因。緩衝期內一律忽略這些關閉來源
  const DISMISS_GUARD_MS = 600;

  let map = null;
  let menuEl = null;
  let currentLatLng = null;
  let longPressTimer = null;
  let longPressStart = null;
  let openedAt = 0;
  // 選單是被這一次長按叫出來的、而手指還沒離開螢幕：補送的 click 要等放開後才會來，
  // 所以緩衝期從「放開手指」算起，長按握久一點也不會一放就關掉
  let holdingAfterOpen = false;

  function buildMenu() {
    const el = document.createElement('div');
    el.className = 'map-context-menu';
    el.setAttribute('role', 'menu');
    el.hidden = true;
    el.innerHTML = `
      <div class="map-context-menu-coords" aria-hidden="true"></div>
      <button type="button" class="map-context-menu-item" data-action="search" role="menuitem">
        <i class="bi bi-search" aria-hidden="true"></i><span>搜尋此座標</span>
      </button>`;
    // Leaflet 會把地圖容器上的指標事件當成地圖操作（拖曳/縮放），選單掛在 body 之外仍會
    // 收到 document 層的事件，所以只擋自己的冒泡即可
    el.addEventListener('click', event => {
      event.stopPropagation();
      const item = event.target.closest('.map-context-menu-item');
      if (!item) return;
      if (item.dataset.action === 'search') searchHere();
      hide();
    });
    el.addEventListener('contextmenu', event => event.preventDefault());
    document.body.appendChild(el);
    return el;
  }

  function show(latlng, clientX, clientY) {
    if (!menuEl) menuEl = buildMenu();
    currentLatLng = latlng;
    menuEl.querySelector('.map-context-menu-coords').textContent =
      `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;

    // 先顯示才量得到尺寸，再夾回視窗內（右下角按下時選單不會被切掉）
    menuEl.hidden = false;
    menuEl.style.visibility = 'hidden';
    const { width, height } = menuEl.getBoundingClientRect();
    const left = Math.min(Math.max(EDGE_GAP_PX, clientX), window.innerWidth - width - EDGE_GAP_PX);
    const top = Math.min(Math.max(EDGE_GAP_PX, clientY), window.innerHeight - height - EDGE_GAP_PX);
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    menuEl.style.visibility = '';
    menuEl.classList.add('is-open');
    openedAt = Date.now();
  }

  function hide() {
    if (!menuEl || menuEl.hidden) return;
    menuEl.classList.remove('is-open');
    menuEl.hidden = true;
    currentLatLng = null;
    openedAt = 0;
    holdingAfterOpen = false;
  }

  // 使用者觸發的關閉（點空白處、拖曳地圖）：剛開啟的瞬間不理會，見 DISMISS_GUARD_MS
  function dismiss() {
    if (holdingAfterOpen) return;
    if (openedAt && Date.now() - openedAt < DISMISS_GUARD_MS) return;
    hide();
  }

  function searchHere() {
    if (!currentLatLng) return;
    const latInput = document.getElementById('latInput');
    const lngInput = document.getElementById('lngInput');
    if (!latInput || !lngInput) return;
    latInput.value = currentLatLng.lat.toFixed(6);
    lngInput.value = currentLatLng.lng.toFixed(6);
    // 半徑沿用控制面板目前的設定，不替使用者改動
    if (typeof window.searchLocation === 'function') window.searchLocation();
    const radius = document.getElementById('radiusInput')?.value || '50';
    window.IslandActivity?.transient(`已查詢此座標周邊 ${radius} 公里`, 'success');
  }

  function cancelLongPress() {
    clearTimeout(longPressTimer);
    longPressTimer = null;
    longPressStart = null;
  }

  // 手機長按：不能只靠瀏覽器的 contextmenu——Android Chrome 會在長按時送出，
  // iOS Safari 在非連結元素上多半不送，所以自己用 touch 事件計時
  function bindLongPress(container) {
    container.addEventListener('touchstart', event => {
      if (event.touches.length !== 1) { cancelLongPress(); return; }
      const touch = event.touches[0];
      longPressStart = { x: touch.clientX, y: touch.clientY };
      longPressTimer = setTimeout(() => {
        longPressTimer = null;
        holdingAfterOpen = true;
        const point = map.mouseEventToContainerPoint(touch);
        show(map.containerPointToLatLng(point), touch.clientX, touch.clientY);
      }, LONG_PRESS_MS);
    }, { passive: true });

    container.addEventListener('touchmove', event => {
      if (!longPressStart) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (Math.abs(touch.clientX - longPressStart.x) > MOVE_TOLERANCE_PX ||
          Math.abs(touch.clientY - longPressStart.y) > MOVE_TOLERANCE_PX) cancelLongPress();
    }, { passive: true });

    const endTouch = () => {
      cancelLongPress();
      if (holdingAfterOpen) {
        holdingAfterOpen = false;
        openedAt = Date.now();
      }
    };
    container.addEventListener('touchend', endTouch, { passive: true });
    container.addEventListener('touchcancel', endTouch, { passive: true });
  }

  function init(mapInstance) {
    if (!mapInstance || map) return;
    map = mapInstance;

    map.on('contextmenu', event => {
      const original = event.originalEvent;
      if (original) original.preventDefault();
      // Android Chrome 長按時除了我們的計時器，還會再送一次原生 contextmenu；
      // 選單剛開就重開會讓開場動畫重播、看起來像閃了一下
      if (openedAt && Date.now() - openedAt < DISMISS_GUARD_MS) return;
      show(event.latlng, original?.clientX ?? 0, original?.clientY ?? 0);
    });

    // 地圖一動（拖曳、縮放、點其他地方）選單就失效，避免選單停在畫面上卻對應到舊位置
    map.on('movestart zoomstart click', dismiss);
    bindLongPress(map.getContainer());

    document.addEventListener('click', dismiss);
    document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
    window.addEventListener('resize', hide);
    window.addEventListener('blur', hide);
  }

  return { init, hide };
})();
