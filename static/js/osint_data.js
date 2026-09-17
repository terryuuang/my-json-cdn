/** Public OSINT views: official daily reports, read-only source sheet, marine models. */
(() => {
  const SOURCES = {
    mnd: './data/mnd_activity.json',
    sheet: 'https://docs.google.com/spreadsheets/d/1qbfYF0VgDBJoFZN5elpZwNTiKZ4nvCUcs5a7oYwm52g/htmlview/sheet?headers=false',
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
    if (currentKind === 'sheet') content?.replaceChildren();
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

  function renderSheet() {
    content.replaceChildren(node('p', 'PLATracker · Gerald C. Brown／Ben Lewis。以下直接閱覽作者持續維護的試算表；資料下載須依作者的分享規則申請。'));
    const label = node('label', '工作表 ');
    const select = node('select');
    [['168515562', '機艦總數（2022 年 8 月起）'], ['905433190', '每日 ADIZ 架次'], ['2051027998', '來源說明與更新日期']].forEach(([gid, name]) => {
      const option = node('option', name);
      option.value = gid;
      select.append(option);
    });
    label.append(select);
    const frame = node('iframe');
    frame.title = 'PLATracker Taiwan ADIZ 公開試算表';
    // Embed a specific public sheet; the local selector avoids Google's page switcher.
    frame.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox';
    frame.referrerPolicy = 'no-referrer';
    const selectSheet = () => { frame.src = `${SOURCES.sheet}&gid=${select.value}`; };
    select.addEventListener('change', selectSheet);
    selectSheet();
    content.append(label, node('p', '可在表內橫向及縱向捲動。若無法顯示，請由來源頁閱覽。圖臺統計另取自國防部日報。'), link('PLATracker 來源與資料說明', SOURCES.sheetSource), frame);

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
    if (kind === 'sheet') { renderSheet(); return; }
    const activeController = controller;
    const timer = setTimeout(() => activeController.abort(), 15000);
    try {
      if (kind === 'mnd') {
        const data = await json(SOURCES.mnd, controller.signal);
        if (request === revision) renderReport(data);
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
