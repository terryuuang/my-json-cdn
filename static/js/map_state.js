// ==========================================================
// map_state.js - 全域設定常數、共用狀態、基礎文字/欄位工具
// 由 main.js 拆分而來（Phase E 可維護性重構），需最先載入
// ==========================================================

// ==========================================================
// 資料來源 URL 設定（支援自訂 DOMAIN）
// ==========================================================
const DATA_BASE_URL = './';  // 使用相對路徑以支援自訂域名
const GEOJSON_FILENAME = 'joseph_w.geojson';

// ==========================================================
// 更新日誌設定（統一維護）
// ==========================================================
const CHANGELOG = [
  {
    date: '2026年07月21日',
    description: '動態島全面優化：修正展開/收合寬度動畫生硬跳格的問題（改為 spring 曲線平滑變形）、搜尋結果改為滑順展開取代瞬間切換、載入狀態改為骨架屏；桌面版新增滑鼠 hover 即可預覽展開（觸控裝置維持點擊展開）；展開寬度依內容量自適應，顯示百科卡片等較多資訊時自動加寬，手機版仍以螢幕寬度為安全上限；新增天氣即時活動輪播（Open-Meteo 免金鑰），只在中國沿岸 6 個預設點位之間循環（不摻雜通用提示），附上風速/風向/雲量/起霧等 OSINT 判讀提示，內容過長時以固定速度跑馬燈捲動而非直接截斷；搜尋新增專有名詞維基百科摘要卡片（中文維基），與地點結果並列顯示'
  },
  {
    date: '2026年07月21日',
    description: '修正 popup 在手機版小螢幕下可能被搜尋動態島／控制面板／選單按鈕遮住的問題；禁航區 popup 新增更完整的幾何資訊（圓形：直徑/圓周，扇形：邊界總長，多邊形/線段：外接長寬/對角跨度/首尾跨度，複合圖形新增總覽標記）'
  },
  {
    date: '2026年07月21日',
    description: '周邊航空動態擴充共軍機型疑似軍機判斷清單：運-7/8/9/12/20、伊留申 Il-76（運輸/加油/預警機類，命中機率較高）；殲-8/10/11/15/16/20、殲轟-7、蘇-27/30/35、轟-6（戰機/轟炸機類，列入僅供完整性）；直-8/9/19/20、武直-10（直升機類）'
  },
  {
    date: '2026年07月21日',
    description: '維基百科查詢優化：新增「重定向」同義詞解析（例如 F16 可直接解析到正式條目），較全文搜尋更精準；設施/單位說明欄位裡本來就常附的維基百科連結，現在會直接顯示摘要圖文卡片，不再只是純文字連結；衛星過境與 ADS-B 的維基百科查詢結果與載入中狀態，改為 Apple 風格圖文卡片與環形載入指示器'
  },
  {
    date: '2026年07月21日',
    description: '重大改版：搜尋列改為 Apple 動態島風格置頂元件，控制面板改為分組卡片與 iOS 風格開關；main.js 拆分為 bootstrap/map_init/markers_render/panel_ui/location_search/map_state/geo_shapes 等職責分明的模組；新增「衛星過境預測」與「周邊航空動態」圖台功能（SGP4 軌道推算、即時 ADS-B），皆支援一次查看全部預設點並自動縮放、查詢時自動隱藏軍事單位圖示；地圖上點開飛機圖示 popup 會比照軍事單位自動查詢維基百科機型簡介與圖片；修正 ADS-B popup 版面、深色模式面板背景等問題'
  },
  {
    date: '2026年07月20日',
    description: 'UI/UX 優化：新增設計 Token 系統、強化毛玻璃效果與 iOS 風格分段控制、補完深色模式；程式碼健壯性提升：修正外部連結跳脫與 GeoJSON 載入逾時保護；main.js 拆分為職責分明的模組，並將裝備資訊查詢改為 popup 開啟時才觸發以降低不必要的網路請求'
  },
  {
    date: '2026年06月03日',
    description: '新增 AIS 快照功能，支援 /#ais=<vessel>|<vessel> 連結，方便快速查看特定船舶位置；新增 12/24 海浬線圖層控制按鈕，預設關閉（AIS 快照連結開啟時自動顯示海浬線，方便搭配船舶位置判讀）；改善短網址導入 AIS hash 後的即時同步'
  },
  {
    date: '2026年04月09日',
    description: '優化禁航區與搜尋體驗：搜尋地點後保留 shape 禁航區 overlay，並擴大禁航區附近單位顯示範圍；同步改善 GeoJSON popup UI/UX，包含自適應寬度、提升手機版 z-index、整理分層類別與說明欄位排版，以及強化說明文字清理與斷行顯示'
  },
  {
    date: '2026年04月08日',
    description: '增強筆記系統，新增筆記圖層顯示/隱藏與單筆可見性控制；多圖形 URL shape 支援整組儲存；優化筆記對話框與列表介面，並加入 Cloudflare Web Analytics'
  },
  {
    date: '2026年04月08日',
    description: '新增禁航區面積、邊界長度計算功能'
  },
  {
    date: '2026年04月07日',
    description: '新增海底電纜圖層（可於公共設施選單開啟）；新增共軍五大戰區與 ADIZ 圖層；操作按鈕改為自適應雙欄排列'
  },
  {
    date: '2026年04月06日',
    description: '優化 shape popup 版面；保留禁航區 popup 的 KML 與網址複製功能；調整 OSM 載入體驗，新增勾選項狀態回饋、查詢中提示與 Overpass 重試/備援節點'
  },
  {
    date: '2026年03月13日',
    description: '移除 Supabase 雲端功能，改為純瀏覽器離線儲存；底圖改為 Google 海域/空域雙圖層；優化地圖初始化速度'
  },
  {
    date: '2025年12月11日',
    description: '新增圖層切換功能，支援 Google Maps 底圖'
  },
  {
    date: '2025年11月25日',
    description: '增強筆記功能，支援儲存 URL shape 及 Leaflet.draw 繪製的完整幾何圖形'
  },
  {
    date: '2025年11月25日',
    description: '新增筆記功能，支援離線筆記儲存'
  },
  {
    date: '2025年11月25日',
    description: '新增pwa功能，支援手機應用'
  },
  {
    date: '2025年11月24日',
    description: '新增更新日誌功能，顯示最新版本更新內容'
  },
  {
    date: '2025年11月24日',
    description: '整合統一下拉選單系統，新增多選功能以支援分層篩選及公共設施選擇'
  },
  {
    date: '2025年11月24日',
    description: '新增手機版搜尋功能，優化搜尋體驗及競態條件處理'
  },
  {
    date: '2025年11月24日',
    description: '新增地點搜尋功能，支援 Nominatim API 進行地理編碼查詢'
  },
  {
    date: '2025年09月17日',
    description: '改進控制面板互動邏輯，防止誤關閉並優化點擊事件處理'
  },
  {
    date: '2025年09月16日',
    description: '新增形狀模式支援，包含圓形、線段、多邊形等地圖標記功能'
  },
  {
    date: '2025年09月16日',
    description: '本地化 Leaflet.draw 介面為繁體中文，新增紅色主題樣式'
  }
];

// 全域變數
let map;
let allFeatures = [];
// 分層索引快取：加速分層篩選
let layerIndex = null; // { layerName: Feature[] }
let currentMarkers = L.layerGroup();
let centerMarker = null;
// 禁航區圖層（No-Fly Zones）
let nfzLayerGroup = L.layerGroup();
const NFZ_NEARBY_BUFFER_KM = 100;
let unitsVisible = true;
// 繪圖控制元件
let drawnItems = null;
let drawControl = null;

// OSINT 工具（衛星過境預測／周邊航空動態）的快速定位點：
// 預設查詢點常常落在沒有航班/衛星過境的空曠處，這裡提供中國沿岸/台灣沿岸的常用點位快速切換
const OSINT_PRESET_LOCATIONS = [
  { label: '福建沿岸（平潭）', lat: 25.03, lng: 119.55 },
  { label: '浙江沿岸（舟山）', lat: 29.95, lng: 122.2 },
  { label: '廣東沿岸（汕頭）', lat: 23.35, lng: 116.9 },
  { label: '新竹外海', lat: 24.9, lng: 120.85 },
  { label: '臺中外海', lat: 24.2, lng: 120.2 },
  { label: '花蓮外海', lat: 23.9, lng: 121.75 }
];
window.OSINT_PRESET_LOCATIONS = OSINT_PRESET_LOCATIONS;

// GeoJSON properties 內分層欄位的容錯讀取（不同資料來源可能用不同鍵名）
function getFeatureLayerName(props) {
  return props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
}

// 建立分層索引（一次 O(N)），提高後續分層切換效能
function buildLayerIndex(features) {
  const idx = Object.create(null);
  for (const f of features) {
    const props = f.properties || {};
    const layerName = getFeatureLayerName(props);
    (idx[layerName] ||= []).push(f);
  }
  return idx;
}

// 篩選功能 - 根據距離篩選點位
function filterFeaturesByDistance(features, centerLat, centerLng, radiusKm = 50) {
return features.filter(feature => {
    const coords = feature.geometry.coordinates;
    const distance = calculateDistance(centerLat, centerLng, coords[1], coords[0]);
    return distance <= radiusKm;
});
}

// 檢測是否為手機設備
function isMobileDevice() {
return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
}

// 清理文字中的HTML實體字符和多餘空格
function cleanText(text) {
if (!text) return '';

return text.toString()
    .replace(/&nbsp;/g, ' ')           // 替換 &nbsp; 為普通空格
    .replace(/&amp;/g, '&')           // 替換 &amp; 為 &
    .replace(/&lt;/g, '<')            // 替換 &lt; 為 <
    .replace(/&gt;/g, '>')            // 替換 &gt; 為 >
    .replace(/&quot;/g, '"')          // 替換 &quot; 為 "
    .replace(/&#39;/g, "'")           // 替換 &#39; 為 '
    .replace(/\s+/g, ' ')             // 多個空格替換為單個空格
    .trim();                          // 移除首尾空格
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

// 用於 HTML 屬性值（雙引號/單引號跳脫），與 escapeHtml 分開是因為屬性值不需要跳脫 < >
function escapeAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function extractReferenceLinks(rawText) {
  const source = rawText == null ? '' : rawText.toString();
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const matchedURLs = source.match(urlRegex) || [];
  const textWithoutUrls = source.replace(urlRegex, ' ');
  return {
    links: matchedURLs,
    text: textWithoutUrls
  };
}

function formatDescriptionText(text) {
  if (!text) return '';

  return text.toString()
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/\u3000/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/([。；])/g, '$1\n')
    .replace(/\s+(?=(裝備[:：]|戰術編號[:：]|部隊番號[:：]|別稱[:：]|榮譽稱號[:：]|車牌號[:：]|電話[:：]|地址[:：]|訓練科目[:：]|此地訓練科目[:：]|司令員[:：]|政治委員[:：]))/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => cleanText(line))
    .filter(Boolean)
    .join('\n');
}

// 僅供「顯示」使用的分層名稱轉換：原始 GeoJSON/篩選邏輯一律維持「解放軍」不變，
// 只在呈現給使用者的文字（popup、搜尋結果等）改顯示為「共軍」
function toDisplayLayerName(name) {
  if (!name) return name;
  return String(name).replace(/解放軍/g, '共軍');
}

function buildPopupFieldHtml(label, value, options = {}) {
  const {
    accentColor = '',
    accentColorDark = '',
    multiline = false,
    valueClassName = ''
  } = options;

  const cleanValue = multiline ? formatDescriptionText(value) : cleanText(value);
  if (!cleanValue) return '';

  const extraClass = multiline ? ' popup-field-multiline' : '';
  const valueClass = ['popup-field-value', valueClassName].filter(Boolean).join(' ');
  // 淺色/深色模式使用不同的強調色（透過 CSS 變數切換，見 .popup-field-badge），
  // 避免深色主題下深色文字疊在灰底上難以辨識
  const styleAttr = accentColor
    ? ` style="--field-accent: ${accentColor}; --field-accent-dark: ${accentColorDark || accentColor}; font-weight: 600;"`
    : '';

  return `<div class="popup-field${extraClass}"><div class="popup-field-label">${escapeHtml(label)}</div><div class="${valueClass}"${styleAttr}>${escapeHtml(cleanValue)}</div></div>`;
}

// （保留由點擊地圖/切換按鈕控制面板開關）

// 根據分層篩選特徵
function filterFeaturesByLayer(features, selectedLayer) {
if (!selectedLayer) return features;
// 若已建立索引，直接回傳對應陣列（避免重複掃描全量 features）
if (layerIndex && layerIndex[selectedLayer]) return layerIndex[selectedLayer];
// 後備：無索引時退回線性過濾
return features.filter(feature => {
    const props = feature.properties || {};
    const layerName = getFeatureLayerName(props);
    return layerName === selectedLayer;
});
}

// 分層篩選功能（已棄用，由 unified_dropdown.js 處理）
function filterByLayer() {
  // 此函數已被 unified_dropdown.js 的多選系統取代
  console.warn('[Map] filterByLayer() 已棄用，請使用 unified_dropdown.js');
}
