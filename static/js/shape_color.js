// ==========================================================
// shape_color.js - 圖形（禁航區/管制區）顏色即時客製化
// ==========================================================
// 設計原則：
// 1. 完全選用（opt-in）。沒有帶顏色參數、也沒有動手調色的連結，渲染結果與舊版一模一樣。
// 2. URL 是唯一真實來源。使用者調色後以 history.replaceState 寫回網址，
//    因此「複製網址」「匯出 KML」「切換圖層後重繪」都會自動沿用調整後的顏色。
// 3. 任何不合法的顏色值都會被 shapeUtils.normalizeShapeColor 擋掉並退回預設色，
//    外部系統即使亂帶參數也不會讓地圖壞掉。
// 4. 本模組若載入失敗，geo_shapes.js 會自動略過選色 UI，其餘功能不受影響。
// ==========================================================
(function () {
  const DEFAULT_COLOR = '#ef4444';

  // 頁面初次載入時的 URL 參數快照，作為「重設顏色」要還原的基準
  const initialParams = new URLSearchParams(window.location.search);

  // uid -> { uid, color, apply, colorParam, colorIndex }
  const registry = new Map();
  // uid -> 這次連結原本（作者指定或預設）的顏色，重設時還原成它
  const baseColors = new Map();

  let attachedMap = null;
  let showApplyAll = false;

  const utils = () => window.shapeUtils || {};

  function normalize(value) {
    const fn = utils().normalizeShapeColor;
    return typeof fn === 'function' ? fn(value) : null;
  }

  function presets() {
    const list = utils().SHAPE_COLOR_PRESETS;
    return Array.isArray(list) ? list : [{ value: DEFAULT_COLOR, label: '預設紅' }];
  }

  function colorParamKeys() {
    const list = utils().SHAPE_COLOR_PARAM_KEYS;
    return Array.isArray(list) ? list : ['circle_color', 'line_color', 'poly_color', 'sector_color'];
  }

  function escapeAttrValue(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  // ==========================================================
  // 註冊/重繪
  // ==========================================================

  // 每次 renderShapeMode 重繪前呼叫：舊的 Leaflet 圖層即將被清掉，註冊表要跟著重來
  function beginRender(shapeSpec) {
    registry.clear();
    showApplyAll = !!(shapeSpec && Array.isArray(shapeSpec.shapes) && shapeSpec.shapes.length > 1);
  }

  /**
   * 註冊一個可調色的圖形。
   * @param {string} uid          shapeUtils 解析時給的穩定識別碼
   * @param {object} options      { color, apply(color), colorParam, colorIndex }
   */
  function register(uid, options = {}) {
    if (!uid || typeof options.apply !== 'function') return;
    const color = normalize(options.color) || DEFAULT_COLOR;
    // 第一次註冊時記錄基準色（之後的重繪不覆寫，才能正確「重設」）
    if (!baseColors.has(uid)) baseColors.set(uid, color);
    registry.set(uid, {
      uid,
      color,
      apply: options.apply,
      colorParam: options.colorParam || 'color',
      colorIndex: Number.isFinite(options.colorIndex) ? options.colorIndex : 0
    });
  }

  // popup 重新開啟時，HTML 是渲染當下產生的靜態字串，需依註冊表把選中狀態補正
  function ensureAttached(map) {
    if (!map || attachedMap === map || typeof map.on !== 'function') return;
    attachedMap = map;
    map.on('popupopen', () => refreshPickers());
  }

  function getColor(uid) {
    const entry = registry.get(uid);
    return entry ? entry.color : DEFAULT_COLOR;
  }

  // ==========================================================
  // popup 內的選色 UI
  // ==========================================================
  // 預設收合：popup 一開啟只看到一行摘要（標題 + 目前色），需要調色時才展開，
  // 與「AI 判斷原因」使用同一種 details/summary 互動語彙。
  function buildPickerHtml(uid, currentColor) {
    if (!uid) return '';
    const color = normalize(currentColor) || DEFAULT_COLOR;
    const swatches = presets().map(preset => {
      const active = preset.value.toLowerCase() === color.toLowerCase();
      return `<button type="button" class="shape-color-swatch${active ? ' is-active' : ''}"`
        + ` style="--swatch-color:${preset.value}" data-color="${preset.value}"`
        + ` role="radio" aria-checked="${active}" aria-label="${escapeAttrValue(preset.label)}"`
        + ` title="${escapeAttrValue(preset.label)}" onclick="ShapeColor.onSwatchClick(this)"></button>`;
    }).join('');

    const isCustom = !presets().some(p => p.value.toLowerCase() === color.toLowerCase());

    const applyAllBtn = showApplyAll
      ? `<button type="button" class="shape-color-action" onclick="ShapeColor.onApplyAllClick(this)">套用到所有圖形</button>`
      : '';

    // 輸出成與 popup 其他資訊列一致的「群組式清單摺疊列」，
    // 收合時右側顯示目前顏色（色點 + hex），展開才出現色票與操作按鈕。
    return `<details class="shape-disclosure shape-color-block" data-shape-uid="${escapeAttrValue(uid)}">`
      + `<summary class="shape-disclosure-summary">`
      + `<span class="shape-row-label">禁航/管制區顏色</span>`
      + `<span class="shape-row-value shape-color-current">`
      + `<i class="shape-color-dot" style="--swatch-color:${color}"></i>`
      + `<code class="shape-color-hex">${color.toUpperCase()}</code></span>`
      + `</summary>`
      + `<div class="shape-disclosure-body shape-color-picker">`
      + `<div class="shape-color-swatches" role="radiogroup" aria-label="禁航/管制區顏色">`
      + swatches
      + `<label class="shape-color-custom${isCustom ? ' is-active' : ''}" style="--swatch-color:${color}" title="自訂顏色">`
      + `<input type="color" class="shape-color-input" value="${color}" aria-label="自訂顏色"`
      + ` oninput="ShapeColor.onCustomInput(this)" onchange="ShapeColor.onCustomInput(this)">`
      + `<span aria-hidden="true">+</span></label>`
      + `</div>`
      + `<div class="shape-color-footer">${applyAllBtn}`
      + `<button type="button" class="shape-color-action" onclick="ShapeColor.onResetClick(this)">重設顏色</button>`
      + `</div></div></details>`;
  }

  // 依註冊表同步畫面上所有選色器的選中狀態（popup 重開、或套用到全部時使用）
  function refreshPickers() {
    document.querySelectorAll('.shape-color-block').forEach(picker => {
      const uid = picker.getAttribute('data-shape-uid');
      const entry = registry.get(uid);
      if (!entry) return;
      const color = entry.color;

      let matchedPreset = false;
      picker.querySelectorAll('.shape-color-swatch').forEach(swatch => {
        const active = (swatch.getAttribute('data-color') || '').toLowerCase() === color.toLowerCase();
        swatch.classList.toggle('is-active', active);
        swatch.setAttribute('aria-checked', active ? 'true' : 'false');
        if (active) matchedPreset = true;
      });

      const custom = picker.querySelector('.shape-color-custom');
      if (custom) {
        custom.classList.toggle('is-active', !matchedPreset);
        custom.style.setProperty('--swatch-color', color);
        const input = custom.querySelector('.shape-color-input');
        if (input && input.value.toLowerCase() !== color.toLowerCase()) input.value = color;
      }

      const dot = picker.querySelector('.shape-color-dot');
      if (dot) dot.style.setProperty('--swatch-color', color);
      const hex = picker.querySelector('.shape-color-hex');
      if (hex) hex.textContent = color.toUpperCase();
    });
  }

  // ==========================================================
  // URL 同步
  // ==========================================================
  function deleteParamVariants(params, name) {
    const toDelete = [];
    params.forEach((_, key) => {
      if (key === name || new RegExp(`^${name}\\[\\d+\\]$`).test(key)) toDelete.push(key);
    });
    Array.from(new Set(toDelete)).forEach(key => params.delete(key));
  }

  function restoreParamVariants(params, name) {
    deleteParamVariants(params, name);
    initialParams.forEach((value, key) => {
      if (key === name || new RegExp(`^${name}\\[\\d+\\]$`).test(key)) params.append(key, value);
    });
  }

  // 只還原單一鍵（單一圖形重設時用，避免動到同類型其他圖形的顏色）
  function restoreSingleParam(params, key) {
    params.delete(key);
    initialParams.getAll(key).forEach(value => params.append(key, value));
  }

  function explicitParamName(entry) {
    return entry.colorParam === 'color' ? 'color' : `${entry.colorParam}[${entry.colorIndex}]`;
  }

  // 用真正的解析器驗證：這組參數下，該圖形實際會被解析成什麼顏色
  function resolvedColorFor(params, uid) {
    try {
      const spec = utils().parseShapeParams(params);
      const found = (spec.shapes || []).find(s => s.uid === uid);
      return found ? found.color : null;
    } catch (_) {
      return null;
    }
  }

  function commitParams(params) {
    try {
      const query = params.toString();
      const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
      window.history.replaceState(null, '', next);
    } catch (error) {
      console.warn('[ShapeColor] 無法更新網址列:', error);
    }
  }

  // ==========================================================
  // 套用 / 重設
  // ==========================================================
  function applyColor(uid, rawColor, options = {}) {
    const color = normalize(rawColor);
    if (!color) return;
    const all = !!options.all;
    const targets = all ? Array.from(registry.keys()) : [uid];
    if (!targets.length) return;

    const params = new URLSearchParams(window.location.search);

    if (all) {
      // 全域色 + 清掉所有個別覆寫，語意最單純也讓網址最短
      params.set('color', color);
      colorParamKeys().forEach(key => deleteParamVariants(params, key));
    }

    targets.forEach(id => {
      const entry = registry.get(id);
      if (!entry) return;
      entry.color = color;
      try { entry.apply(color); } catch (error) { console.warn('[ShapeColor] 套用顏色失敗:', error); }
      if (!all) params.set(explicitParamName(entry), color);
    });

    commitParams(params);
    refreshPickers();
  }

  function resetColor(uid, options = {}) {
    const all = !!options.all;
    const targets = all ? Array.from(registry.keys()) : [uid];
    if (!targets.length) return;

    const params = new URLSearchParams(window.location.search);

    if (all) {
      restoreParamVariants(params, 'color');
      colorParamKeys().forEach(key => restoreParamVariants(params, key));
    } else {
      const entry = registry.get(uid);
      if (!entry) return;
      restoreSingleParam(params, explicitParamName(entry));
    }

    targets.forEach(id => {
      const entry = registry.get(id);
      if (!entry) return;
      const base = baseColors.get(id) || DEFAULT_COLOR;
      // 還原參數後若解析結果仍不等於基準色（例如稍早按過「套用到所有圖形」留下的全域 color），
      // 就補上明確的個別參數，確保畫面與網址一致
      if (resolvedColorFor(params, id) !== base) params.set(explicitParamName(entry), base);
      entry.color = base;
      try { entry.apply(base); } catch (error) { console.warn('[ShapeColor] 重設顏色失敗:', error); }
    });

    commitParams(params);
    refreshPickers();
  }

  // ==========================================================
  // DOM 事件入口（popup 內以 inline handler 呼叫，與專案既有寫法一致）
  // ==========================================================
  function uidFromElement(el) {
    const picker = el && el.closest ? el.closest('.shape-color-block') : null;
    return picker ? picker.getAttribute('data-shape-uid') : null;
  }

  function onSwatchClick(el) {
    applyColor(uidFromElement(el), el.getAttribute('data-color'));
  }

  function onCustomInput(el) {
    // 拖曳原生色盤時會連續觸發，用 rAF 節流避免每一格都重繪 Leaflet 圖層
    const uid = uidFromElement(el);
    const color = el.value;
    if (el._shapeColorFrame) cancelAnimationFrame(el._shapeColorFrame);
    el._shapeColorFrame = requestAnimationFrame(() => {
      el._shapeColorFrame = null;
      applyColor(uid, color);
    });
  }

  function onApplyAllClick(el) {
    const uid = uidFromElement(el);
    applyColor(uid, getColor(uid), { all: true });
    toast('已套用到所有圖形');
  }

  function onResetClick(el) {
    resetColor(uidFromElement(el));
  }

  function toast(message) {
    if (window.IslandActivity) {
      window.IslandActivity.transient(message, 'success');
    } else if (window.Notes && typeof window.Notes.showToast === 'function') {
      window.Notes.showToast(message);
    }
  }

  window.ShapeColor = {
    DEFAULT_COLOR,
    beginRender,
    register,
    ensureAttached,
    getColor,
    buildPickerHtml,
    refreshPickers,
    applyColor,
    resetColor,
    onSwatchClick,
    onCustomInput,
    onApplyAllClick,
    onResetClick
  };
})();
