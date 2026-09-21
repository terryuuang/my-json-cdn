/** Public OSINT views: official daily reports, read-only source sheet, marine models. */
(() => {
  const SOURCES = {
    mnd: './data/mnd_activity.json',
    // gviz 的 CSV 匯出帶 CORS 標頭，可以直接讀進圖臺自己排版，
    // 不必再嵌一整頁 Google 試算表（iframe 裡有自己的橫縱捲軸，手機上幾乎不能用）
    sheetCsv: 'https://docs.google.com/spreadsheets/d/1qbfYF0VgDBJoFZN5elpZwNTiKZ4nvCUcs5a7oYwm52g/gviz/tq?tqx=out:csv&gid=905433190',
    sheetView: 'https://docs.google.com/spreadsheets/d/1qbfYF0VgDBJoFZN5elpZwNTiKZ4nvCUcs5a7oYwm52g/htmlview',
    sheetSource: 'https://www.platracker.com/trackers',
    marine: 'https://marine-api.open-meteo.com/v1/marine',
    marineSource: 'https://open-meteo.com/en/docs/marine-weather-api'
  };
  // Fixed reference points are model samples, not vessel or aircraft locations.
  const SEA_POINTS = [
    { name: '臺海北部', lat: 25.5, lng: 120.5 },
    { name: '臺海中部', lat: 24, lng: 119.5 },
    { name: '臺海南部', lat: 22.5, lng: 119.5 },
    { name: '臺灣東部外海', lat: 23.5, lng: 122.5 },
    { name: '巴士海峽', lat: 21, lng: 121 }
  ];
  let panel;
  let content;
  let currentKind;
  let controller;
  let revision = 0;
  let marineLayer;
  let lastFocus;
  const node = (tag, text, className) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  };
  const link = (label, url) => {
    const el = node('a', label);
    el.href = url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
    return el;
  };
  const value = number => Number.isFinite(number) ? String(number) : '未提供';

  function close() {
    revision++;
    controller?.abort();
    if (panel) panel.hidden = true;
    lastFocus?.focus({ preventScroll: true });
  }

  function ensurePanel() {
    if (panel) return;
    panel = node('aside', undefined, 'osint-data-panel');
    panel.hidden = true;
    panel.setAttribute('aria-labelledby', 'osint-data-title');
    const header = node('div', undefined, 'osint-data-header');
    const title = node('h2');
    title.id = 'osint-data-title';
    const refresh = node('button', '更新');
    refresh.type = 'button';
    refresh.addEventListener('click', () => open(currentKind));
    const dismiss = node('button', '關閉');
    dismiss.type = 'button';
    dismiss.addEventListener('click', close);
    header.append(title, refresh, dismiss);
    content = node('div', undefined, 'osint-data-content');
    content.setAttribute('aria-live', 'polite');
    panel.append(header, content);
    panel.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    document.body.appendChild(panel);
  }

  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function text(url, signal) {
    const response = await fetch(url, { signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  // 只夠用的 CSV 解析：Google 的匯出一律用雙引號包欄位，跳脫是連續兩個雙引號
  function parseCsv(input) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < input.length; i++) {
      const char = input[i];
      if (quoted) {
        if (char !== '"') { field += char; continue; }
        if (input[i + 1] === '"') { field += '"'; i++; continue; }
        quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === ',') { row.push(field); field = ''; continue; }
      if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      if (char === '\r') continue;
      field += char;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function officialUrl(raw, path) {
    try {
      const url = new URL(raw);
      return url.protocol === 'https:' && url.hostname === 'www.mnd.gov.tw' && url.pathname.startsWith(path) ? url.href : null;
    } catch (_) { return null; }
  }

  function renderReport(data) {
    if (!Array.isArray(data.reports) || !data.reports.length) throw new Error('沒有可用通報');
    const reports = data.reports.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
      Number.isInteger(row.aircraft) && row.aircraft >= 0 && Number.isInteger(row.vessels) && row.vessels >= 0);
    if (!reports.length) throw new Error('通報格式不符');
    content.replaceChildren();
    const latest = reports[0];
    const age = Date.now() - Date.parse(`${latest.date}T06:00:00+08:00`);
    const status = node('p', `最新通報 ${latest.date} · 資料檢查 ${new Date(data.checkedAt).toLocaleString('zh-TW')}`);
    if (age > 48 * 3600000) status.append(node('strong', ' · 資料已超過兩日，請核對原站'));
    content.append(status, node('p', '每日 06:00 結算（臺灣時間）。通報架次／艘次不是獨立機艦數，也沒有即時座標。'));
    const detail = node('section', undefined, 'osint-report-detail');
    function selectReport(row) {
      detail.replaceChildren(node('h3', `${row.date} 通報`));
      const metrics = node('dl', undefined, 'osint-metrics');
      [['共機架次', row.aircraft], ['共艦艘次', row.vessels], ['公務船艘次', row.officialShips], ['逾越中線／進入通報空域架次', row.reportedAreaAircraft]].forEach(([label, count]) => {
        const item = node('div');
        item.append(node('dt', label), node('dd', value(count)));
        metrics.append(item);
      });
      detail.append(metrics);
      const source = officialUrl(row.sourceUrl, '/news/plaact/');
      if (source) detail.append(link('國防部原始通報', source));
      const imageUrl = officialUrl(row.imageUrl, '/NewUpload/');
      if (imageUrl) {
        // 官方示意圖本身是帶經緯格線的麥卡托製圖，可以精準貼回地圖上
        // （換算基準與安全閥見 mnd_overlay.js）
        if (window.MndOverlay) {
          const overlay = node('button', '在地圖上疊加此日示意圖', 'osint-sea-item');
          overlay.type = 'button';
          overlay.addEventListener('click', () => {
            if (window.MndOverlay.isVisible() && window.MndOverlay.getDate() === row.date) {
              window.MndOverlay.hide();
            } else {
              window.MndOverlay.show(imageUrl, row.date);
            }
          });
          detail.append(overlay);
          detail.append(node('p', '疊加後圖上的紅色航跡框與官方標註會落在實際經緯度上；符號為官方示意，不是即時位置。'));
        }
        const figure = node('details');
        figure.append(node('summary', '查看當日官方示意圖'));
        const image = node('img');
        image.alt = `${row.date} 國防部臺海周邊活動示意圖（非即時位置）`;
        image.src = imageUrl;
        image.loading = 'lazy';
        image.referrerPolicy = 'no-referrer';
        image.addEventListener('error', () => image.replaceWith(node('p', '示意圖暫時無法載入，請查看原始通報。')));
        figure.append(image);
        detail.append(figure);
      }
    }
    selectReport(latest);
    content.append(detail);
    const label = node('label', '統計期間 ');
    const range = node('select');
    [[7, '最近 7 日'], [30, '最近 30 日'], [90, '最近 90 日']].forEach(([days, text]) => {
      const option = node('option', text);
      option.value = days;
      range.append(option);
    });
    range.value = '30';
    label.append(range);
    const history = node('div');
    function renderHistory() {
      const cutoff = Date.parse(`${latest.date}T00:00:00Z`) - (Number(range.value) - 1) * 86400000;
      const rows = reports.filter(row => Date.parse(`${row.date}T00:00:00Z`) >= cutoff);
      history.replaceChildren(node('p', `以最新通報日回溯 · ${rows.length} 日有資料；共機 ${rows.reduce((sum, row) => sum + row.aircraft, 0)} 架次、共艦 ${rows.reduce((sum, row) => sum + row.vessels, 0)} 艘次。缺日不計為零。`));
      const table = node('table');
      table.append(node('caption', '每日通報（點日期查看當日資料）'));
      const head = node('tr');
      ['日期', '共機', '共艦'].forEach(text => { const th = node('th', text); th.scope = 'col'; head.append(th); });
      const thead = node('thead');
      thead.append(head);
      const tbody = node('tbody');
      rows.forEach(row => {
        const tr = node('tr');
        const date = node('td');
        const button = node('button', row.date);
        button.type = 'button';
        button.addEventListener('click', () => { selectReport(row); content.scrollTo({ top: 0, behavior: 'instant' }); });
        date.append(button);
        tr.append(date, node('td', value(row.aircraft)), node('td', value(row.vessels)));
        tbody.append(tr);
      });
      table.append(thead, tbody);
      history.append(table);
    }
    range.addEventListener('change', renderHistory);
    renderHistory();
    content.append(label, history);
    window.map.fitBounds([[20.5, 118], [27, 124]], { padding: [24, 60], animate: false });
  }

  // PLATracker 的「每日 ADIZ 架次」工作表：A=日期(M/D/YYYY)、B=星期、C=當日進入 ADIZ 架次
  function parseSheetRows(csv) {
    const rows = parseCsv(csv).slice(1);
    return rows.map(cells => {
      const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((cells[0] || '').trim());
      const count = Number((cells[2] || '').trim());
      if (!match || !Number.isFinite(count)) return null;
      const [, month, day, year] = match;
      return {
        date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
        count
      };
    }).filter(Boolean);
  }

  // 近 N 日長條圖。用 inline SVG 而不是圖表套件：這個專案沒有建置工具，
  // 也不想為了一張小圖多拉一個 CDN 相依
  function sparkBars(rows) {
    const width = 320;
    const height = 96;
    const gap = 1;
    const max = Math.max(...rows.map(row => row.count), 1);
    const barWidth = (width - gap * (rows.length - 1)) / rows.length;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('class', 'osint-bars');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `最近 ${rows.length} 日每日進入 ADIZ 架次，最高 ${max} 架次`);
    rows.forEach((row, index) => {
      const barHeight = Math.max(row.count > 0 ? 2 : 0, Math.round((row.count / max) * (height - 2)));
      const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      rect.setAttribute('x', (index * (barWidth + gap)).toFixed(2));
      rect.setAttribute('y', (height - barHeight).toFixed(2));
      rect.setAttribute('width', barWidth.toFixed(2));
      rect.setAttribute('height', String(barHeight));
      rect.setAttribute('rx', '1');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${row.date}：${row.count} 架次`;
      rect.append(title);
      svg.append(rect);
    });
    return svg;
  }

  function renderSheet(csv) {
    const rows = parseSheetRows(csv);
    if (rows.length < 7) throw new Error('試算表格式不符');
    const recent = rows.slice(-30);
    const last7 = rows.slice(-7);
    const latest = rows[rows.length - 1];
    const peak = recent.reduce((best, row) => row.count > best.count ? row : best, recent[0]);
    const sum = list => list.reduce((total, row) => total + row.count, 0);
    const average = Math.round((sum(last7) / last7.length) * 10) / 10;

    content.replaceChildren(node('p', 'PLATracker（Gerald C. Brown／Ben Lewis）持續維護的公開資料庫，記錄每日進入臺灣防空識別區的共機架次。以下由圖臺直接讀取並排版，數字為通報架次而非獨立機數。'));

    const metrics = node('dl', undefined, 'osint-metrics');
    [
      [`最新一日（${latest.date}）`, `${latest.count}`],
      ['近 7 日平均', `${average}`],
      ['近 30 日合計', `${sum(recent)}`],
      [`近 30 日單日最高（${peak.date}）`, `${peak.count}`]
    ].forEach(([label, text]) => {
      const item = node('div');
      item.append(node('dt', label), node('dd', text));
      metrics.append(item);
    });
    content.append(metrics);

    content.append(node('h3', `最近 ${recent.length} 日每日架次`), sparkBars(recent));
    const axis = node('p', `${recent[0].date} — ${latest.date}`, 'osint-bars-axis');
    content.append(axis);

    const table = node('details');
    table.append(node('summary', '每日數字'));
    const grid = node('table');
    const head = node('tr');
    ['日期', '架次'].forEach(text => { const th = node('th', text); th.scope = 'col'; head.append(th); });
    const thead = node('thead');
    thead.append(head);
    const tbody = node('tbody');
    [...recent].reverse().forEach(row => {
      const tr = node('tr');
      tr.append(node('td', row.date), node('td', String(row.count)));
      tbody.append(tr);
    });
    grid.append(thead, tbody);
    table.append(grid);
    content.append(table);

    // 把數字接回地圖：這些架次講的就是防空識別區，一鍵把該範圍畫出來
    if (window.ADIZ) {
      const adiz = node('button', '在地圖上顯示防空識別區', 'osint-sea-item');
      adiz.type = 'button';
      adiz.addEventListener('click', () => {
        if (!window.ADIZ.isVisible?.()) window.ADIZ.toggle();
        window.map.fitBounds([[21, 117.3], [29, 123]], { padding: [24, 60], animate: false });
      });
      content.append(adiz);
    }

    content.append(node('p', `資料範圍 ${rows[0].date} 起，共 ${rows.length} 日。圖臺另有國防部每日通報可對照；兩者統計口徑不同。`));
    content.append(link('PLATracker 來源與資料說明', SOURCES.sheetSource));
    content.append(link('在 Google 試算表開啟完整資料', SOURCES.sheetView));
  }

  function renderMarine(payload) {
    if (!Array.isArray(payload) || payload.length !== SEA_POINTS.length) throw new Error('海象資料格式不符');
    const group = L.layerGroup();
    const list = node('div');
    let valid = 0;
    payload.forEach((item, index) => {
      const current = item.current;
      if (!current || !Number.isFinite(current.wave_height)) return;
      const point = SEA_POINTS[index];
      const detail = `${point.name} · 浪高 ${current.wave_height} m · 浪向 ${value(current.wave_direction)}° · 週期 ${value(current.wave_period)} s`;
      const popup = node('div', undefined, 'osint-marine-popup');
      popup.append(node('strong', point.name), node('p', detail), node('p', `模型時間 ${current.time}（臺灣時間）。固定海象參考點，非機艦位置。`), link('Open-Meteo 海象來源', SOURCES.marineSource));
      const marker = L.marker([point.lat, point.lng], { title: detail }).bindPopup(popup).addTo(group);
      const button = node('button', detail, 'osint-sea-item');
      button.type = 'button';
      button.addEventListener('click', () => { window.map.panTo([point.lat, point.lng]); marker.openPopup(); });
      list.append(button, node('p', `模型時間 ${current.time}（臺灣時間）`));
      valid++;
    });
    if (!valid) throw new Error('目前沒有可用海象資料');
    if (marineLayer) window.map.removeLayer(marineLayer);
    marineLayer = group.addTo(window.map);
    content.replaceChildren(node('p', '臺海與周邊五個固定海象參考點。Open-Meteo 數值模型；不是實測船位或航行指引。'), list, link('Open-Meteo · CC BY 4.0', SOURCES.marineSource));
    const clear = node('button', '移除海象點位');
    clear.type = 'button';
    clear.addEventListener('click', () => { window.map.removeLayer(marineLayer); marineLayer = null; close(); });
    content.append(clear);
    window.map.fitBounds(SEA_POINTS.map(point => [point.lat, point.lng]), { padding: [24, 72], animate: false });
  }

  async function open(kind) {
    const titles = { mnd: '機艦繞臺 · 國防部每日統計', sheet: 'PLATracker · 線上試算表', marine: '臺海海象 · 圖臺參考點' };
    if (!titles[kind] || !window.map) return;
    ensurePanel();
    if (panel.hidden) lastFocus = document.activeElement;
    controller?.abort();
    controller = new AbortController();
    const request = ++revision;
    currentKind = kind;
    document.getElementById('osint-data-title').textContent = titles[kind];
    panel.hidden = false;
    content.replaceChildren(node('p', '正在載入資料…'));
    window.map.closePopup();
    const activeController = controller;
    const timer = setTimeout(() => activeController.abort(), 15000);
    try {
      if (kind === 'mnd') {
        const data = await json(SOURCES.mnd, controller.signal);
        if (request === revision) renderReport(data);
      } else if (kind === 'sheet') {
        const csv = await text(SOURCES.sheetCsv, controller.signal);
        if (request === revision) renderSheet(csv);
      } else {
        const url = new URL(SOURCES.marine);
        url.search = new URLSearchParams({ latitude: SEA_POINTS.map(p => p.lat).join(','), longitude: SEA_POINTS.map(p => p.lng).join(','), current: 'wave_height,wave_direction,wave_period', timezone: 'Asia/Taipei', cell_selection: 'sea' });
        const data = await json(url, controller.signal);
        if (request === revision) renderMarine(data);
      }
    } catch (_) {
      if (request !== revision) return;
      content.replaceChildren(node('p', navigator.onLine ? '資料暫時無法載入，請按「更新」重試。' : '目前離線，請連線後再更新資料。'));
    } finally { clearTimeout(timer); }
  }
  window.OsintData = { open, close };
})();
