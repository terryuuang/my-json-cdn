// ==========================================================
// osint_weather.js - 動態島天氣即時活動（OSINT 用途）
// 資料來源：Open-Meteo（免金鑰、CORS 開放、免費公開 API）
// 聚焦 map_state.js 既有的 OSINT_PRESET_LOCATIONS（中國沿岸/台灣沿岸常用點位），
// 收合狀態下以輪播文字方式呈現，並附上風速/雲量/起霧等對海空活動判讀有意義的簡短提示，
// 跟一般天氣小工具的差異在於「這是給 OSINT 判讀用的」而非單純顯示氣溫
// ==========================================================
(function () {
  const API_BASE = 'https://api.open-meteo.com/v1/forecast';
  const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 天氣變化慢，20 分鐘刷新一次即可，避免過度請求
  const REQUEST_TIMEOUT_MS = 8000;
  const FADE_MS = 180;
  // 跑馬燈參數：滑動速度固定（不管文字多長，讀起來的「速度感」都一樣），
  // 首尾各停頓一下讓人看清楚開頭/結尾，不會滑完馬上被切斷
  const MARQUEE_PX_PER_SEC = 42;
  const MARQUEE_EDGE_PAUSE_MS = 900;
  const MARQUEE_TRAILING_PAUSE_MS = 500; // 動畫跑完到換下一則之間再留一點餘裕
  const STATIC_DWELL_MS = 3200; // 文字沒超出寬度、不需要跑馬燈時，單純停留閱讀的時間

  // WMO 天氣代碼（Open-Meteo 採用同一套標準）
  const WEATHER_ICONS = [
    [0, 0, '☀️'], [1, 3, '⛅'], [45, 48, '🌫️'],
    [51, 67, '🌧️'], [71, 77, '❄️'], [80, 82, '🌦️'], [85, 86, '🌨️'], [95, 99, '⛈️']
  ];

  function weatherIcon(code) {
    if (!Number.isFinite(code)) return '🌡️';
    const hit = WEATHER_ICONS.find(([min, max]) => code >= min && code <= max);
    return hit ? hit[2] : '🌡️';
  }

  function compassDir(deg) {
    if (!Number.isFinite(deg)) return '';
    const dirs = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    return dirs[Math.round(deg / 45) % 8];
  }

  // OSINT 判讀提示：風速/陣風/起霧/雲量達門檻時附加一句簡短提示，
  // 這是跟一般天氣小工具的差異所在——不是單純報氣溫，而是標出可能影響海空觀測/活動的條件
  function buildOsintHint(entry) {
    if (entry.weatherCode === 45 || entry.weatherCode === 48) {
      return '起霧，光學判讀能見度受限';
    }
    if (Number.isFinite(entry.windGusts) && entry.windGusts >= 35) {
      return '陣風強勁，可能影響艦載機/艦艇操作';
    }
    if (Number.isFinite(entry.windSpeed) && entry.windSpeed >= 25) {
      return '強風海況，可能影響海上活動';
    }
    if (Number.isFinite(entry.cloudCover) && entry.cloudCover >= 80) {
      return '雲量高，光學衛星判讀受限';
    }
    return '';
  }

  function formatEntryText(entry) {
    const icon = weatherIcon(entry.weatherCode);
    const temp = Number.isFinite(entry.temp) ? `${Math.round(entry.temp)}°C` : '';
    const wind = Number.isFinite(entry.windSpeed)
      ? `${compassDir(entry.windDir)}風 ${Math.round(entry.windSpeed)}kt`
      : '';
    const hint = buildOsintHint(entry);
    const parts = [entry.label, temp, wind].filter(Boolean);
    let text = `${icon} ${parts.join(' · ')}`;
    if (hint) text += ` · ⚠️ ${hint}`;
    return text;
  }

  let entries = [];
  let rotateIndex = -1;
  let rotateTimer = null;
  let refreshTimer = null;

  function isIslandExpanded(island) {
    return !island || island.classList.contains('expanded');
  }

  // 設定文字並依內容長度決定：完全顯示得下就靜態停留；顯示不下就跑馬燈滑過去，
  // 滑動時間依文字長度算（速度固定），跑完才呼叫 onSettled 進到下一則——
  // 這樣才不會發生「還沒滑完/看完就被切到下一則」的問題
  function setLabelText(text, onSettled) {
    const clipBox = document.getElementById('searchIslandLabel');
    const inner = document.getElementById('searchIslandLabelText');
    if (!clipBox || !inner) { if (onSettled) onSettled(); return; }

    clipBox.classList.add('island-label-fade');
    setTimeout(() => {
      inner.classList.remove('marquee');
      inner.style.transform = '';
      inner.style.removeProperty('--marquee-distance');
      inner.style.animationDuration = '';
      inner.style.animationDelay = '';
      inner.textContent = text;
      clipBox.classList.remove('island-label-fade');

      // 下一幀再量測，確保上面重設 marquee 的樣式已經生效、不會量到動畫途中的寬度
      requestAnimationFrame(() => {
        const overflow = inner.scrollWidth - clipBox.clientWidth;
        if (overflow > 4) {
          const distancePx = overflow + 4; // 多滑一點點，確保結尾文字完全露出來
          const scrollMs = (distancePx / MARQUEE_PX_PER_SEC) * 1000;
          inner.style.setProperty('--marquee-distance', `-${distancePx}px`);
          inner.style.animationDuration = `${scrollMs}ms`;
          // 開頭停頓交給 animation-delay：延遲期間元素停在動畫起始狀態（translateX(0)），
          // 剛好就是「先讓人看到開頭文字」要的效果，不用額外處理
          inner.style.animationDelay = `${MARQUEE_EDGE_PAUSE_MS}ms`;
          inner.classList.add('marquee');
          // 結尾停頓：animation-fill-mode:forwards 讓動畫跑完後畫面停在滑到底的狀態，
          // 這裡再多等一段固定時間才真正換下一則，讓人來得及看完結尾
          const totalMs = MARQUEE_EDGE_PAUSE_MS + scrollMs + MARQUEE_EDGE_PAUSE_MS;
          if (onSettled) setTimeout(onSettled, totalMs + MARQUEE_TRAILING_PAUSE_MS);
        } else if (onSettled) {
          setTimeout(onSettled, STATIC_DWELL_MS);
        }
      });
    }, FADE_MS);
  }

  // 只在中國沿岸預設點之間輪播——天氣資訊本來就是為了 OSINT 判讀而做，
  // 不應該被「搜尋地點」這種通用提示稀釋掉；資料還沒抓到之前 HTML 原本的
  // 「搜尋地點」文字會維持顯示，抓到資料後就完全交給輪播接手
  function rotateNext() {
    const island = document.getElementById('searchIsland');
    // 展開中、還沒抓到資料、或活動通知佔用中：先不更新畫面
    if (isIslandExpanded(island) || entries.length === 0 ||
        (window.IslandActivity && window.IslandActivity.isCarouselPaused())) {
      rotateTimer = setTimeout(rotateNext, 1000);
      return;
    }

    rotateIndex = (rotateIndex + 1) % entries.length;
    setLabelText(formatEntryText(entries[rotateIndex]), () => {
      rotateTimer = setTimeout(rotateNext, 0);
    });
  }

  function startRotation() {
    if (rotateTimer || entries.length === 0) return;
    rotateTimer = setTimeout(rotateNext, 0);
  }

  // Open-Meteo 支援用逗號分隔的多組經緯度一次查詢，6 個預設點只需 1 次請求
  async function fetchAllPresetWeather() {
    const presets = window.OSINT_PRESET_LOCATIONS || [];
    if (presets.length === 0) return [];

    const lat = presets.map(p => p.lat).join(',');
    const lng = presets.map(p => p.lng).join(',');
    const params = [
      `latitude=${lat}`,
      `longitude=${lng}`,
      'current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover,precipitation',
      'wind_speed_unit=kn',
      'timezone=auto'
    ].join('&');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const resp = await fetch(`${API_BASE}?${params}`, { signal: controller.signal });
      if (!resp.ok) throw new Error(`Open-Meteo 回應錯誤（${resp.status}）`);
      const data = await resp.json();
      // 多點查詢回傳陣列；若供應商未來改變行為只回單一物件，這裡統一轉成陣列處理避免整段掛掉
      const dataList = Array.isArray(data) ? data : [data];

      return presets.map((p, i) => {
        const cur = dataList[i] && dataList[i].current;
        if (!cur) return null;
        return {
          label: p.label,
          temp: cur.temperature_2m,
          weatherCode: cur.weather_code,
          windSpeed: cur.wind_speed_10m,
          windDir: cur.wind_direction_10m,
          windGusts: cur.wind_gusts_10m,
          cloudCover: cur.cloud_cover,
          precipitation: cur.precipitation
        };
      }).filter(Boolean);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function refresh() {
    try {
      const result = await fetchAllPresetWeather();
      if (result.length > 0) {
        entries = result;
        // 保護一下：萬一第一次抓取失敗、輪播還沒啟動過，後續刷新成功時要能補上啟動，
        // startRotation 本身已用 rotateTimer 擋重複，這裡呼叫是安全的
        startRotation();
      }
    } catch (error) {
      console.warn('[OsintWeather] 天氣資料取得失敗，動態島僅顯示預設搜尋提示:', error);
    }
  }

  function init() {
    const island = document.getElementById('searchIsland');
    if (!island) return;

    refresh(); // 內部成功後會自行呼叫 startRotation，這裡不用再重複串
    refreshTimer = setInterval(refresh, REFRESH_INTERVAL_MS);
  }

  window.OsintWeather = { init };
})();
