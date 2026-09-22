/**
 * 海底電纜圖層模組
 * 資料來源：geojson/submarinecablemap.json
 * 預設關閉，透過公共設施 checkbox 控制顯示
 *
 * 也支援用網址參數開啟（查詢字串與 hash 等價，見 url_params.js）：
 *   cable=all / cable=1        → 全部電纜（等同勾選 checkbox）
 *   cable=taiwan-matsu-no-4    → 只這一條，自動 fitBounds 並開 popup
 *   cable=tpkm2,tpkm3          → 多條；也可重複寫 cable= 參數
 *
 * 刻意不用 cable=1~N 這種序號：序號是資料檔裡的陣列位置，
 * 上下架電纜就整排位移，昨天分享的連結今天會指到別條。
 */

const SubmarineCable = (() => {
  const GEOJSON_URL = './geojson/submarinecablemap.json';
  const URL_PARAM = 'cable';
  // cable=all / cable=1 都代表「全開」。1 只是為了讓「我只想打開圖層」的直覺寫法能用。
  const ALL_TOKENS = new Set(['all', '1', 'true', 'yes', 'on']);

  // 現代化電纜配色：用明亮、高對比的色票取代原始暗色
  // 原始資料每條電纜有自己的 color，但大量是暗灰或低飽和色
  // 策略：亮度 < 0.45 的顏色強制提升為高飽和版本，其餘保留
  const FALLBACK_COLORS = [
    '#38bdf8', '#f472b6', '#a78bfa', '#34d399', '#fbbf24',
    '#fb923c', '#60a5fa', '#e879f9', '#4ade80', '#f87171',
  ];

  function brightenColor(hex, index) {
    // 若原色過暗或接近灰色，改用 fallback 色票循環
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    const saturation = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
    if (luminance < 0.45 || saturation < 0.25) {
      return FALLBACK_COLORS[index % FALLBACK_COLORS.length];
    }
    return hex;
  }

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
  }

  // 比對用的正規化：去掉大小寫與所有非英數字元。
  // 這樣 cable=TPKM2 命中 taiwan-penghu-kinmen-matsu-no-2-tpkm2，使用者不必背完整 slug。
  function normalize(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  let _map = null;
  let _layerGroup = null;
  let _loaded = false;
  let _loadingPromise = null;
  let _visible = false;
  // id → { id, name, layers: [], normId, normName }；一條電纜可能拆成多段 feature（例如 echo 有 3 段），
  // 必須同進同出，所以以 id 分組而不是以 feature 為單位。
  let _cables = new Map();
  let _selection = null;   // null = 全部；否則為電纜 id 陣列
  let _urlDriven = false;

  function init(map) {
    _map = map;
    _layerGroup = L.layerGroup();
  }

  function load() {
    if (_loaded) return Promise.resolve();
    if (_loadingPromise) return _loadingPromise;

    _loadingPromise = (async () => {
      const res = await fetch(GEOJSON_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      data.features.forEach((feature, i) => {
        const props = feature.properties || {};
        const rawColor = props.color || '#38bdf8';
        const color = brightenColor(rawColor, i);
        const name = props.name || '未知電纜';
        const id = props.id || `cable-${i}`;

        const layer = L.geoJSON(feature, {
          style: {
            color,
            weight: 2,
            opacity: 0.85,
            className: 'submarine-cable-path',
          },
        });

        layer.bindPopup(`<strong>${escapeHtml(name)}</strong>`, { className: 'custom-popup' });

        let cable = _cables.get(id);
        if (!cable) {
          cable = { id, name, layers: [], normId: normalize(id), normName: normalize(name) };
          _cables.set(id, cable);
        }
        cable.layers.push(layer);
      });

      _loaded = true;
      console.log(`[SubmarineCable] 載入完成，共 ${data.features.length} 段、${_cables.size} 條電纜`);
    })().catch(err => {
      console.error('[SubmarineCable] 載入失敗:', err);
      _loadingPromise = null;
    });

    return _loadingPromise;
  }

  // 依 _selection 決定哪些電纜進 _layerGroup
  function applySelection(options = {}) {
    if (!_loaded || !_layerGroup) return;
    _layerGroup.clearLayers();

    const ids = _selection || Array.from(_cables.keys());
    const chosen = ids.map(id => _cables.get(id)).filter(Boolean);
    chosen.forEach(cable => cable.layers.forEach(layer => _layerGroup.addLayer(layer)));

    if (!options.focus || !_map || !_selection || !chosen.length) return;

    // 只選了部分電纜時才移動視野，全開時不該把使用者的視角搶走
    const bounds = L.latLngBounds([]);
    chosen.forEach(cable => cable.layers.forEach(layer => bounds.extend(layer.getBounds())));
    if (bounds.isValid()) {
      _map.fitBounds(bounds, { padding: [60, 60], maxZoom: 9 });
      if (chosen.length === 1) {
        try { chosen[0].layers[0].openPopup(); } catch (_) {}
      }
    }
  }

  // 把使用者給的 token 解析成電纜 id。比對順序：id 完全相同 → 正規化後完全相同 → 正規化後 substring。
  function resolveTokens(tokens) {
    const resolved = [];
    const unmatched = [];
    const seen = new Set();
    const cables = Array.from(_cables.values());

    tokens.forEach(token => {
      const norm = normalize(token);
      if (!norm) return;
      let hits = _cables.has(token) ? [_cables.get(token)] : [];
      if (!hits.length) hits = cables.filter(c => c.normId === norm || c.normName === norm);
      if (!hits.length) hits = cables.filter(c => c.normId.includes(norm) || c.normName.includes(norm));

      if (!hits.length) {
        unmatched.push(token);
        return;
      }
      hits.forEach(c => {
        if (seen.has(c.id)) return;
        seen.add(c.id);
        resolved.push(c.id);
      });
    });

    return { resolved, unmatched };
  }

  function setCheckboxState(checked) {
    const box = document.querySelector('input[type="checkbox"][value="submarine_cable"]');
    if (box) box.checked = checked;
  }

  async function show(options = {}) {
    if (!_map) return;
    _layerGroup.addTo(_map);
    _visible = true;
    await load();
    applySelection(options);
  }

  function hide() {
    if (!_map) return;
    _map.removeLayer(_layerGroup);
    _visible = false;
  }

  // 讀網址裡的 cable=，可重複，也可用逗號分隔
  function tokensFromUrl() {
    if (!window.UrlParams) return null;
    const values = window.UrlParams.read().getAll(URL_PARAM);
    if (!values.length) return null;
    return values
      .flatMap(value => String(value).split(','))
      .map(token => token.trim())
      .filter(Boolean);
  }

  // 依網址開啟／篩選圖層。init 時呼叫一次，hashchange 時再呼叫。
  async function applyUrlSelection() {
    const tokens = tokensFromUrl();

    if (!tokens) {
      // 參數被移除：只收掉「當初是網址打開的」圖層，不干涉使用者自己勾的
      if (_urlDriven) {
        _urlDriven = false;
        _selection = null;
        hide();
        setCheckboxState(false);
      }
      return;
    }

    _urlDriven = true;
    setCheckboxState(true);
    await load();
    if (!_loaded) return;

    const wantsAll = tokens.some(token => ALL_TOKENS.has(token.toLowerCase()));
    if (wantsAll) {
      _selection = null;
      await show();
      return;
    }

    const { resolved, unmatched } = resolveTokens(tokens);
    if (unmatched.length) {
      console.warn(`[SubmarineCable] 找不到對應電纜：${unmatched.join(', ')}`);
    }
    if (!resolved.length) {
      // 全部比對失敗就退回全開，不要讓圖層靜默消失
      console.warn('[SubmarineCable] cable= 沒有任何命中，改為顯示全部電纜');
      _selection = null;
      await show();
      return;
    }

    _selection = resolved;
    await show({ focus: true });
  }

  return { init, show, hide, applyUrlSelection, isVisible: () => _visible };
})();

window.SubmarineCable = SubmarineCable;
