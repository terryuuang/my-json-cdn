// 異步處理裝備資訊的函數
async function processEquipmentAsync(layer, equipmentText) {
let loadingShown = false;

// 設置載入狀態顯示的定時器（手機版延遲更短）
const loadingDelay = isMobileDevice() ? 500 : 1000;
const loadingTimer = setTimeout(() => {
    layer.on('popupopen', function(e) {
    const popup = e.popup;
    const popupContent = popup.getContent();
    
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = popupContent;
    
    if (!tempDiv.querySelector('.equipment-info')) {
        const loadingHTML = window.equipmentParser.generateEquipmentHTML([], true);
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', loadingHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', loadingHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
        loadingShown = true;
    }
    });
}, loadingDelay); // 手機版0.5秒，桌面版1秒後顯示載入狀態

try {
    const equipmentData = await window.equipmentParser.processEquipmentText(equipmentText);
    clearTimeout(loadingTimer);
    
    if (equipmentData.length > 0) {
    const equipmentHTML = window.equipmentParser.generateEquipmentHTML(equipmentData);
    
    // 更新popup內容
    layer.on('popupopen', function(e) {
        const popup = e.popup;
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        // 移除載入狀態或檢查是否已經添加過裝備資訊
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        }
        
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', equipmentHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', equipmentHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
    });
    
    // 如果popup已經開啟，立即更新
    if (layer.getPopup() && layer.getPopup().isOpen()) {
        const popup = layer.getPopup();
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        }
        
        const linksDiv = tempDiv.querySelector('.popup-links');
        
        if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', equipmentHTML);
        } else {
        tempDiv.insertAdjacentHTML('beforeend', equipmentHTML);
        }
        
        popup.setContent(tempDiv.innerHTML);
    }
    } else if (loadingShown) {
    // 如果沒有找到裝備資訊且顯示了載入狀態，則移除載入狀態
    layer.on('popupopen', function(e) {
        const popup = e.popup;
        const popupContent = popup.getContent();
        
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = popupContent;
        
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        popup.setContent(tempDiv.innerHTML);
        }
    });
    }
} catch (error) {
    clearTimeout(loadingTimer);
    console.error('處理裝備資訊時發生錯誤:', error);
}
}


// 解析URL參數 - 獲取經緯度
function parseUrlCoordinates() {
const urlParams = new URLSearchParams(window.location.search);

// 支援多種參數格式
// 格式1: ?lat=31.9424765&lng=120.2903877
if (urlParams.has('lat') && urlParams.has('lng')) {
    return {
    lat: parseFloat(urlParams.get('lat')),
    lng: parseFloat(urlParams.get('lng'))
    };
}

// 格式2: ?coords=31.9424765,120.2903877
if (urlParams.has('coords')) {
    const coords = urlParams.get('coords').split(',');
    if (coords.length === 2) {
    return {
        lat: parseFloat(coords[0]),
        lng: parseFloat(coords[1])
    };
    }
}

// 格式3: 路徑格式 /31.9424765,120.2903877 (向後相容)
const path = window.location.pathname;
const coordinatePattern = /\/(-?\d+\.?\d*),(-?\d+\.?\d*)$/;
const match = path.match(coordinatePattern);

if (match) {
    return {
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2])
    };
}

return null;
}

// 計算兩點間距離(公里) - 使用Haversine公式
function calculateDistance(lat1, lon1, lat2, lon2) {
const R = 6371; // 地球半徑(公里)
const dLat = (lat2 - lat1) * Math.PI / 180;
const dLon = (lon2 - lon1) * Math.PI / 180;
const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
return R * c;
}

// 初始化地圖
function initializeMap() {
map = L.map('map', { 
    zoomControl: false,
    maxZoom: 22, // 增加最大縮放級別，讓使用者可以看得更清楚
    minZoom: 2,
    tap: true, // 手機版點擊支援
    tapTolerance: 15 // 增加點擊容差
}).setView([25.5100, 119.7910], 7);

// 根據設備類型調整縮放控制器位置
if (isMobileDevice()) {
    L.control.zoom({ position: 'bottomright' }).addTo(map);
} else {
L.control.zoom({ position: 'topright' }).addTo(map);
}

// 使用高解析度衛星圖層
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; Esri, Maxar, Earthstar Geographics',
    maxZoom: 22 // 支援高縮放級別
}).addTo(map);

// 添加地名標籤疊加層
const labelLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_only_labels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; CartoDB',
    maxZoom: 22,
    subdomains: 'abcd',
    pane: 'overlayPane'
}).addTo(map);

// 手機版：點擊地圖關閉控制面板
if (isMobileDevice()) {
    map.on('click', function() {
    const panel = document.getElementById('controlPanel');
    if (panel.classList.contains('show-mobile')) {
        panel.classList.remove('show-mobile');
    }
    });
}
}

// SVG圖標系統
const layerIcons = {
'中國軍工及航天產業': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#4338ca" stroke="#312e81" stroke-width="2"/>
    <path d="M12 6v12M8 8l8 8M8 16l8-8" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="12" r="2" fill="white"/>
    </svg>`,
    color: '#4338ca'
},
'武裝警察、海外軍事設施及其他分類': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="3" y="6" width="18" height="12" rx="2" fill="#dc2626" stroke="#991b1b" stroke-width="2"/>
    <path d="M9 10h6M9 14h6" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <circle cx="7" cy="12" r="1" fill="white"/>
    <circle cx="17" cy="12" r="1" fill="white"/>
    </svg>`,
    color: '#dc2626'
},
'解放軍海軍、海軍陸戰隊基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#8B4513" stroke="#654321" stroke-width="2"/>
    <path d="M6 12h12M12 6v12" stroke="white" stroke-width="2"/>
    <path d="M8 8l8 8M16 8l-8 8" stroke="white" stroke-width="1" opacity="0.7"/>
    <circle cx="12" cy="12" r="3" fill="none" stroke="white" stroke-width="1"/>
    </svg>`,
    color: '#8B4513'
},
'解放軍火箭軍': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#b91c1c" stroke="#7f1d1d" stroke-width="2"/>
    <path d="M12 4l2 4h-4l2-4zM12 4v16" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <path d="M8 10l8 0M8 14l8 0" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M10 18l4 0" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    color: '#b91c1c'
},
'解放軍空軍、海軍航空兵基地及設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#1E3A8A" stroke="#1E40AF" stroke-width="2"/>
    <path d="M12 6l4 8h-8l4-8z" fill="white"/>
    <path d="M6 12h4M14 12h4" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <circle cx="12" cy="16" r="1" fill="white"/>
    </svg>`,
    color: '#1E3A8A'
},
'解放軍軍事航天部隊、網路空間部隊、信息支援部隊': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#7c3aed" stroke="#5b21b6" stroke-width="2"/>
    <circle cx="12" cy="8" r="2" fill="white"/>
    <path d="M12 10v4M10 14h4" stroke="white" stroke-width="2" stroke-linecap="round"/>
    <path d="M8 16l8-8M16 16l-8-8" stroke="white" stroke-width="1" opacity="0.7"/>
    </svg>`,
    color: '#7c3aed'
},
'解放軍軍事院校、教育單位': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#ea580c" stroke="#c2410c" stroke-width="2"/>
    <rect x="8" y="8" width="8" height="6" rx="1" fill="white"/>
    <path d="M10 11h4M10 13h4" stroke="#ea580c" stroke-width="1" stroke-linecap="round"/>
    <path d="M12 8V6" stroke="white" stroke-width="2" stroke-linecap="round"/>
    </svg>`,
    color: '#ea580c'
},
'解放軍重要訓場/特殊設施': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#0d9488" stroke="#0f766e" stroke-width="2"/>
    <path d="M8 8h8l-2 2H10l-2-2zM8 16h8l-2-2H10l-2 2z" fill="white"/>
    <path d="M12 6v12" stroke="white" stroke-width="2"/>
    <circle cx="12" cy="12" r="1.5" fill="white"/>
    </svg>`,
    color: '#0d9488'
},
'解放軍陸軍、陸軍防空單位、聯勤保障設施、預備役部隊(部分設施為個人推斷)': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#16a34a" stroke="#15803d" stroke-width="2"/>
    <rect x="9" y="9" width="6" height="6" rx="1" fill="white"/>
    <path d="M11 11h2M11 13h2" stroke="#16a34a" stroke-width="1"/>
    <path d="M6 12h3M15 12h3M12 6v3M12 15v3" stroke="white" stroke-width="1.5" stroke-linecap="round"/>
    </svg>`,
    color: '#16a34a'
},
'黨和國家重要政經軍事機關': {
    svg: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="12" r="10" fill="#be123c" stroke="#9f1239" stroke-width="2"/>
    <path d="M8 10l4-2 4 2v6l-4 2-4-2v-6z" fill="white"/>
    <path d="M12 8v8M8 10l4 4 4-4" stroke="#be123c" stroke-width="1"/>
    <circle cx="12" cy="6" r="1" fill="white"/>
    </svg>`,
    color: '#be123c'
}
};

// 根據layer獲取圖標
function getLayerIcon(layerName) {
return layerIcons[layerName] || layerIcons['武裝警察、海外軍事設施及其他分類'];
}

// 創建自定義標記圖標
function createCustomIcon(layerName, isZeroDistance = false) {
const iconData = getLayerIcon(layerName);
const size = isZeroDistance ? 40 : 32; // 零距離標記稍大一點

return L.divIcon({
    className: `custom-military-marker ${isZeroDistance ? 'zero-distance-marker' : ''}`,
    html: `
    <div style="
        width: ${size}px; 
        height: ${size}px; 
        position: relative;
        filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
        ${isZeroDistance ? `
        animation: pulseRing 2s infinite;
        border: 3px solid #ef4444;
        border-radius: 50%;
        background: rgba(239, 68, 68, 0.1);
        backdrop-filter: blur(4px);
        ` : ''}
    ">
        ${iconData.svg}
        ${isZeroDistance ? `
        <div style="
            position: absolute;
            top: -3px;
            right: -3px;
            width: 12px;
            height: 12px;
            background: #ef4444;
            border: 2px solid white;
            border-radius: 50%;
            animation: pulse 1.5s infinite;
            box-shadow: 0 0 0 4px rgba(239, 68, 68, 0.3);
        "></div>
        ` : ''}
    </div>
    `,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2]
});
}

// 取得標籤名稱
function getLabel(url) {
url = url.toLowerCase();
return url.includes('twitter.com') || url.includes('x.com') ? 'Twitter/X' :
        url.includes('wikipedia.org') ? 'Wikipedia' :
        url.includes('weixin.qq.com') ? '微信公眾號' :
        url.includes('youtube.com') ? 'YouTube' :
        url.includes('thepaper.cn') ? '澎湃新聞' :
        url.includes('cctv.com') ? 'CCTV' :
        url.includes('bilibili.com') ? 'Bilibili' :
        '相關連結';
}

// 主要初始化函數
async function init() {
const startTime = performance.now(); // 效能計時開始
showLoading();

try {
    // 初始化地圖
    initializeMap();
    
    // 初始化面板狀態（手機版預設隱藏）
    initializePanelState();
    
    // 監聽視窗大小變化
    window.addEventListener('resize', handleResize);
    
    // 解析URL參數
    const urlCoords = parseUrlCoordinates();
    const urlParams = new URLSearchParams(window.location.search);
    
    // 如果有URL座標參數，使用50KM，否則使用100KM
    const radius = parseFloat(urlParams.get('radius')) || (urlCoords ? 50 : 100);
    const selectedLayer = urlParams.get('layer') || '';
    
    // 如果有URL參數，填入控制面板，否則使用預設位置
    if (urlCoords) {
    document.getElementById('latInput').value = urlCoords.lat;
    document.getElementById('lngInput').value = urlCoords.lng;
    } else {
    // 沒有URL參數時，使用預設位置並顯示100KM範圍
    document.getElementById('latInput').value = 25.5100;
    document.getElementById('lngInput').value = 119.7910;
    }
    document.getElementById('radiusInput').value = radius;
    document.getElementById('layerFilter').value = selectedLayer;
    
    // 載入地圖資料 - 優化版本，支援進度顯示
    const geojsonURL = 'https://terryuuang.github.io/my-json-cdn/joseph_w-20250806.geojson';
    
    // 更新載入狀態顯示進度
    document.querySelector('#loading div:last-child').textContent = '載入地圖資料中...';
    
    const response = await fetch(geojsonURL);
    
    if (!response.ok) {
    throw new Error(`載入資料失敗: ${response.status}`);
    }
    
    // 檢查資料大小並顯示進度
    const contentLength = response.headers.get('content-length');
    if (contentLength) {
    const total = parseInt(contentLength, 10);
    let loaded = 0;
    
    const reader = response.body.getReader();
    const chunks = [];
    
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        chunks.push(value);
        loaded += value.length;
        
        // 更新進度
        const progress = Math.round((loaded / total) * 100);
        document.querySelector('#loading div:last-child').textContent = `載入地圖資料中... ${progress}%`;
    }
    
    // 組合所有片段
    const allChunks = new Uint8Array(loaded);
    let position = 0;
    for (const chunk of chunks) {
        allChunks.set(chunk, position);
        position += chunk.length;
    }
    
    const text = new TextDecoder().decode(allChunks);
    const data = JSON.parse(text);
    allFeatures = data.features;
    } else {
    // 如果沒有 content-length，使用原來的方式
    const data = await response.json();
    allFeatures = data.features;
    }
    
    // 根據URL參數渲染地圖，如果沒有URL座標，使用預設位置
    const targetCoords = urlCoords || { lat: 25.5100, lng: 119.7910 };
    renderMap(targetCoords, radius, selectedLayer);
    
    // 效能統計
    const endTime = performance.now();
    const loadTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`🚀 地圖載入完成！載入時間: ${loadTime} 秒，共 ${allFeatures.length} 個點位`);
    
} catch (error) {
    hideLoading();
    console.error('載入地圖資料時發生錯誤:', error);
    updateInfoPanel(`錯誤：${error.message}`);
    
    // 即使載入失敗也要初始化基本地圖
    if (!map) {
    initializeMap();
    }
}
}

// 全域變數
let map;
let allFeatures = [];
let currentMarkers = L.layerGroup();
let centerMarker = null;

// 篩選功能 - 根據距離篩選點位
function filterFeaturesByDistance(features, centerLat, centerLng, radiusKm = 50) {
return features.filter(feature => {
    const coords = feature.geometry.coordinates;
    const distance = calculateDistance(centerLat, centerLng, coords[1], coords[0]);
    return distance <= radiusKm;
});
}

// 顯示載入指示器
function showLoading() {
document.getElementById('loading').style.display = 'block';
document.querySelector('#loading div:last-child').textContent = '初始化地圖...';
}

// 隱藏載入指示器
function hideLoading() {
document.getElementById('loading').style.display = 'none';
}

// 更新資訊面板
function updateInfoPanel(message) {
const infoPanel = document.getElementById('infoPanel');
const infoText = document.getElementById('infoText');
infoText.textContent = message;
infoPanel.style.display = 'block';
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

// 隱藏/顯示控制面板
function togglePanel() {
const panel = document.getElementById('controlPanel');

if (isMobileDevice()) {
    // 手機版使用不同的class
    panel.classList.toggle('show-mobile');
} else {
    // 桌面版使用原有的hidden class
    panel.classList.toggle('hidden');
}
}

// 初始化面板顯示狀態
function initializePanelState() {
const panel = document.getElementById('controlPanel');
const mobileHint = document.getElementById('mobileHint');

if (isMobileDevice()) {
    // 手機版預設隱藏
    panel.classList.remove('show-mobile');
    // 確保不使用桌面版的hidden class
    panel.classList.remove('hidden');
    // 顯示手機版提示
    mobileHint.style.display = 'block';
} else {
    // 桌面版預設顯示
    panel.classList.remove('hidden');
    panel.classList.remove('show-mobile');
    // 隱藏手機版提示
    mobileHint.style.display = 'none';
}
}

// 監聽視窗大小變化
function handleResize() {
const panel = document.getElementById('controlPanel');
const mobileHint = document.getElementById('mobileHint');

if (isMobileDevice()) {
    // 切換到手機版
    panel.classList.remove('hidden');
    mobileHint.style.display = 'block';
    if (!panel.classList.contains('show-mobile')) {
    // 如果面板是開啟狀態，保持開啟
    const wasVisible = !panel.classList.contains('hidden');
    if (wasVisible) {
        panel.classList.add('show-mobile');
    }
    }
} else {
    // 切換到桌面版
    panel.classList.remove('show-mobile');
    mobileHint.style.display = 'none';
    // 桌面版預設顯示
    panel.classList.remove('hidden');
}
}

// 根據分層篩選特徵
function filterFeaturesByLayer(features, selectedLayer) {
if (!selectedLayer) return features;

return features.filter(feature => {
    const props = feature.properties || {};
    const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
    return layerName === selectedLayer;
});
}

// 分層篩選功能
function filterByLayer() {
const selectedLayer = document.getElementById('layerFilter').value;
const urlCoords = parseUrlCoordinates();
const urlParams = new URLSearchParams(window.location.search);
const radius = parseFloat(urlParams.get('radius')) || 50;

// 更新URL參數
if (selectedLayer) {
    urlParams.set('layer', selectedLayer);
} else {
    urlParams.delete('layer');
}

const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
window.history.pushState({}, '', newUrl);

// 重新渲染地圖
renderMap(urlCoords, radius, selectedLayer);
}

// 搜尋位置功能
function searchLocation() {
const lat = parseFloat(document.getElementById('latInput').value);
const lng = parseFloat(document.getElementById('lngInput').value);
const radius = parseFloat(document.getElementById('radiusInput').value) || 50;
const selectedLayer = document.getElementById('layerFilter').value;

if (isNaN(lat) || isNaN(lng)) {
    alert('請輸入有效的經緯度數值！');
    return;
}

// 更新URL
const urlParams = new URLSearchParams();
urlParams.set('lat', lat);
urlParams.set('lng', lng);
urlParams.set('radius', radius);
if (selectedLayer) {
    urlParams.set('layer', selectedLayer);
}

const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
window.history.pushState({}, '', newUrl);

// 重新渲染地圖
renderMap({ lat, lng }, radius, selectedLayer);
}

// 顯示全部位置
function showAllLocations() {
// 清除URL參數
const newUrl = `${window.location.origin}${window.location.pathname}`;
window.history.pushState({}, '', newUrl);

// 清空輸入欄
document.getElementById('latInput').value = '';
document.getElementById('lngInput').value = '';
document.getElementById('radiusInput').value = '50';
document.getElementById('layerFilter').value = '';

// 重新渲染地圖
renderMap(null);
}

// 複製URL功能
function copyUrl() {
const url = window.location.href;
navigator.clipboard.writeText(url).then(() => {
    updateInfoPanel('連結已複製到剪貼簿！');
    setTimeout(() => {
    document.getElementById('infoPanel').style.display = 'none';
    }, 3000);
}).catch(() => {
    // 備用方案
    const textArea = document.createElement('textarea');
    textArea.value = url;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    updateInfoPanel('連結已複製！');
    setTimeout(() => {
    document.getElementById('infoPanel').style.display = 'none';
    }, 3000);
});
}

// 渲染地圖功能 - 優化版本，支援延遲載入
function renderMap(targetCoords, radiusKm = 50, selectedLayer = null) {
// 清除現有標記
currentMarkers.clearLayers();
if (centerMarker) {
    map.removeLayer(centerMarker);
    centerMarker = null;
}

let featuresToShow = allFeatures;
let mapCenter = [25.5100, 119.7910]; // 預設中心
let mapZoom = 7;

// 更新載入狀態
if (document.getElementById('loading').style.display === 'block') {
    document.querySelector('#loading div:last-child').textContent = '渲染地圖標記中...';
}

// 先進行分層篩選
if (selectedLayer) {
    featuresToShow = filterFeaturesByLayer(featuresToShow, selectedLayer);
}

// 然後進行地理位置篩選
if (targetCoords) {
    mapCenter = [targetCoords.lat, targetCoords.lng];
    mapZoom = 15; // 增加預設縮放級別，讓用戶能看得更清楚
    
    // 篩選附近的點位
    featuresToShow = filterFeaturesByDistance(
    featuresToShow, 
    targetCoords.lat, 
    targetCoords.lng, 
    radiusKm
    );
    
    // 添加中心標記
    const redIcon = L.divIcon({
        className: 'custom-red-marker',
    html: '<div style="background-color: #ef4444; width: 12px; height: 12px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 4px rgba(0,0,0,0.2);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    
    centerMarker = L.marker([targetCoords.lat, targetCoords.lng], { icon: redIcon })
        .addTo(map)
    .bindPopup(`<strong>🎯 搜尋中心</strong><br/>緯度: ${targetCoords.lat}<br/>經度: ${targetCoords.lng}<br/>搜尋半徑: ${radiusKm} 公里`);
    }

// 設定地圖視野
map.setView(mapCenter, mapZoom);

    // 優化：分批載入標記以提升效能
    const batchSize = isMobileDevice() ? 50 : 100; // 手機版每批50個，桌面版100個
    let currentBatch = 0;
    
    const addMarkersBatch = () => {
    const start = currentBatch * batchSize;
    const end = Math.min(start + batchSize, featuresToShow.length);
    const batchFeatures = featuresToShow.slice(start, end);
    
    if (batchFeatures.length > 0) {
        L.geoJSON({ type: 'FeatureCollection', features: batchFeatures }, {
        pointToLayer: (feature, latlng) => {
        const props = feature.properties || {};
        const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
        
        // 檢查是否為零距離點位（距離搜尋中心很近）
        let isZeroDistance = false;
        if (targetCoords) {
            const coords = feature.geometry.coordinates;
            const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
            isZeroDistance = distance < 0.1; // 小於100公尺視為零距離
        }
        
        const customIcon = createCustomIcon(layerName, isZeroDistance);
        const marker = L.marker(latlng, { icon: customIcon });
        currentMarkers.addLayer(marker);
        return marker;
        },
    onEachFeature: (feature, layer) => {
        const props = feature.properties || {};
    const layerName = props.layer || props['分層'] || props['類別'] || '武裝警察、海外軍事設施及其他分類';
    const iconData = getLayerIcon(layerName);
    
        let popupContent = '';
        let referenceLinks = [];
    let mainTitle = cleanText(props['名稱'] || props['name'] || '軍事設施');

    // 構建popup標題
    popupContent += `<div class="popup-header"><div class="popup-icon">${iconData.svg}</div><h3 class="popup-title">${mainTitle}</h3></div>`;

    // 顯示分層資訊
    const cleanLayerName = cleanText(layerName);
    popupContent += `<div class="popup-field"><strong>分層類別:</strong><span class="popup-field-value" style="color: ${iconData.color}; font-weight: 600;">${cleanLayerName}</span></div>`;

    // 儲存裝備文本供後續處理
    let equipmentText = '';
    
    // 處理其他屬性
        Object.entries(props).forEach(([key, value]) => {
        if (key === '說明') {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const matchedURLs = value.match(urlRegex);
            if (matchedURLs) {
            referenceLinks.push(...matchedURLs);
            value = value.replace(urlRegex, '').trim();
            }
            
            // 清理說明文字
            value = cleanText(value);
            
            // 儲存包含裝備資訊的文本
            if (value.includes('裝備')) {
            equipmentText = value;
            }
        }
        
        // 跳過已處理的欄位
        if (['名稱', 'name', 'layer', '分層', '類別'].includes(key)) return;
        
        if (value && value.toString().trim()) {
        const cleanValue = cleanText(value);
        if (cleanValue) {
            popupContent += `<div class="popup-field"><strong>${key}:</strong><span class="popup-field-value">${cleanValue}</span></div>`;
        }
        }
    });

    // 如果有目標座標，顯示距離資訊
    if (targetCoords) {
        const coords = feature.geometry.coordinates;
        const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
        const isZeroDistance = distance < 0.1;
        
        if (isZeroDistance) {
        popupContent += `<div class="popup-distance" style="background: linear-gradient(135deg, #fef2f2, #fee2e2); border-left: 4px solid #ef4444; border: 2px solid #ef4444; animation: subtle-pulse 2s infinite;"><strong>🎯 就在搜尋中心!</strong> <span style="color: #ef4444; font-weight: 700;">${distance < 0.01 ? '< 10公尺' : `${(distance * 1000).toFixed(0)}公尺`}</span><br/><small style="color: #dc2626;">這個設施就在您指定的位置附近</small></div>`;
        } else {
        popupContent += `<div class="popup-distance"><strong>📍 距離搜尋中心:</strong> ${distance.toFixed(2)} 公里</div>`;
        }
    }

    // 添加參考連結
        if (referenceLinks.length) {
        popupContent += `<div class="popup-links"><div class="popup-links-title">相關連結</div>`;
        referenceLinks.forEach(url => {
            popupContent += `<a class="link-btn" href="${url}" target="_blank">${getLabel(url)}</a>`;
        });
        popupContent += '</div>';
    }

    // 根據設備類型調整popup設定
    const popupOptions = {
        className: 'custom-popup'
    };
    
    if (isMobileDevice()) {
        popupOptions.maxWidth = Math.min(350, window.innerWidth - 40);
        popupOptions.minWidth = Math.min(260, window.innerWidth - 60);
        popupOptions.maxHeight = Math.min(500, window.innerHeight - 120);
        popupOptions.autoPan = true;
        popupOptions.autoPanPadding = [10, 10];
        popupOptions.closeButton = true;
        popupOptions.keepInView = true;
        popupOptions.autoClose = false;
        popupOptions.closeOnEscapeKey = true;
    } else {
        popupOptions.maxWidth = 350;
        popupOptions.minWidth = 280;
    }
    
    // 綁定popup
    const popup = layer.bindPopup(popupContent, popupOptions);
    
    // 異步處理裝備資訊
    if (equipmentText && window.equipmentParser) {
        processEquipmentAsync(layer, equipmentText);
    }
        }
        }).addTo(map);
        
        currentBatch++;
        
        // 更新進度
        const progress = Math.round((end / featuresToShow.length) * 100);
        if (document.getElementById('loading').style.display === 'block') {
        document.querySelector('#loading div:last-child').textContent = `載入標記中... ${progress}%`;
        }
        
        // 如果還有更多批次，使用 setTimeout 避免阻塞 UI
        if (end < featuresToShow.length) {
        setTimeout(addMarkersBatch, 10); // 10ms 延遲
        } else {
        // 載入完成
        hideLoading();
        
        // 更新資訊面板
        let message = `顯示 ${featuresToShow.length} 個點位`;
        
        if (selectedLayer) {
            message += ` (${selectedLayer})`;
        }
        
        if (targetCoords) {
            message += ` (${radiusKm}公里內)`;
        }
        
        updateInfoPanel(message);
        }
    } else {
        hideLoading();
        
        // 如果沒有點位可顯示，也要更新資訊面板
        let message = `顯示 0 個點位`;
        
        if (selectedLayer) {
            message += ` (${selectedLayer})`;
        }
        
        if (targetCoords) {
            message += ` (${radiusKm}公里內)`;
        }
        
        updateInfoPanel(message);
    }
    };
    
    // 開始載入第一批
    addMarkersBatch();

// 將標記群組添加到地圖
currentMarkers.addTo(map);
}

// 當頁面載入完成時啟動應用程式
document.addEventListener('DOMContentLoaded', init);