// ==========================================================
// markers_render.js - GeoJSON 標記建立、popup 組裝、批次渲染
// ==========================================================


// 異步處理裝備資訊的函數
// 非同步處理裝備資訊（加上防重與效能優化）
// 呼叫時機：由呼叫端在 layer 的 popupopen 事件中觸發（見 addMarkersForFeatures），
// 而非在建立 marker 當下就發送 Wikipedia 請求，避免大範圍搜尋時一次觸發大量網路請求。
async function processEquipmentAsync(layer, equipmentText) {
// 防止重複綁定與重複處理（提升效能，避免重複事件造成多次渲染）
if (layer._equipmentParsingStarted) return;
layer._equipmentParsingStarted = true;

let loadingShown = false;

// 將 popup 內容的修改套用到「目前已開啟的 popup」，若 popup 已關閉則等待下次開啟時再套用
// mutate(tempDiv) 可回傳 false 表示內容未變更、不需要呼叫 setContent
const injectIntoPopup = (mutate) => {
    const applyTo = (popup) => {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = popup.getContent();
    const changed = mutate(tempDiv);
    if (changed !== false) popup.setContent(tempDiv.innerHTML);
    };
    const openPopup = layer.getPopup();
    if (openPopup && openPopup.isOpen()) {
    applyTo(openPopup);
    } else {
    layer.once('popupopen', (e) => applyTo(e.popup));
    }
};

// 設置載入狀態顯示的定時器（手機版延遲更短）
const loadingDelay = isMobileDevice() ? 500 : 1000;
const loadingTimer = setTimeout(() => {
    injectIntoPopup((tempDiv) => {
    if (tempDiv.querySelector('.equipment-info')) return false;
    const loadingHTML = window.equipmentParser.generateEquipmentHTML([], true);
    const linksDiv = tempDiv.querySelector('.popup-links');
    if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', loadingHTML);
    } else {
        tempDiv.insertAdjacentHTML('beforeend', loadingHTML);
    }
    loadingShown = true;
    });
}, loadingDelay); // 手機版0.5秒，桌面版1秒後顯示載入狀態

try {
    const equipmentData = await window.equipmentParser.processEquipmentText(equipmentText);
    clearTimeout(loadingTimer);

    if (equipmentData.length > 0) {
    const equipmentHTML = window.equipmentParser.generateEquipmentHTML(equipmentData);
    injectIntoPopup((tempDiv) => {
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
    });
    } else if (loadingShown) {
    // 如果沒有找到裝備資訊且顯示了載入狀態，則移除載入狀態
    injectIntoPopup((tempDiv) => {
        const existingEquipment = tempDiv.querySelector('.equipment-info');
        if (existingEquipment) {
        existingEquipment.remove();
        return true;
        }
        return false;
    });
    }
} catch (error) {
    clearTimeout(loadingTimer);
    console.error('[Map] 處理裝備資訊失敗:', error);
}
}

// 異步處理「說明」欄位裡已內嵌的維基百科連結（設施/單位本身的條目，例如基地、支隊）
// 與裝備查詢是互補關係：裝備查詢是「用名稱去搜尋比對」，這裡是「連結本身已指到正確條目」，
// 不需要同義詞比對，直接依連結標題查摘要即可，準確度更高
async function processFacilityWikiAsync(layer, wikiLinks) {
  if (layer._facilityWikiStarted) return;
  layer._facilityWikiStarted = true;

  const injectIntoPopup = (mutate) => {
    const applyTo = (popup) => {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = popup.getContent();
      const changed = mutate(tempDiv);
      if (changed !== false) popup.setContent(tempDiv.innerHTML);
    };
    const openPopup = layer.getPopup();
    if (openPopup && openPopup.isOpen()) {
      applyTo(openPopup);
    } else {
      layer.once('popupopen', (e) => applyTo(e.popup));
    }
  };

  const sectionLabel = `<div class="osint-wiki-section-label">相關維基百科條目</div>`;
  let loadingShown = false;
  const loadingDelay = isMobileDevice() ? 500 : 1000;
  const loadingTimer = setTimeout(() => {
    injectIntoPopup((tempDiv) => {
      if (tempDiv.querySelector('.facility-wiki-info')) return false;
      const loadingHTML = `<div class="osint-wiki-section facility-wiki-info">${sectionLabel}<div class="osint-wiki-loading"><span class="osint-spinner"></span>正在查詢維基百科資料...</div></div>`;
      const linksDiv = tempDiv.querySelector('.popup-links');
      if (linksDiv) {
        linksDiv.insertAdjacentHTML('beforebegin', loadingHTML);
      } else {
        tempDiv.insertAdjacentHTML('beforeend', loadingHTML);
      }
      loadingShown = true;
    });
  }, loadingDelay);

  try {
    const infos = await Promise.all(
      wikiLinks.map(link => window.equipmentParser.fetchPageSummaryByLangTitle(link.lang, link.title))
    );
    clearTimeout(loadingTimer);
    const validInfos = infos.filter(Boolean);

    if (validInfos.length > 0) {
      const cardsHtml = validInfos.map(info => {
        const mediaHtml = info.thumbnail
          ? `<div class="osint-wiki-card-media"><img src="${info.thumbnail}" alt="${escapeHtml(info.title)}" loading="lazy"></div>`
          : '';
        const linkHtml = info.wikipediaUrl
          ? `<a href="${escapeAttr(info.wikipediaUrl)}" target="_blank" rel="noopener noreferrer" class="osint-wiki-card-link">維基百科原文</a>`
          : '';
        return `
          <div class="osint-wiki-card">
            ${mediaHtml}
            <div class="osint-wiki-card-body">
              <div class="osint-wiki-card-title">${escapeHtml(info.title)}</div>
              <div class="osint-wiki-card-desc">${escapeHtml(info.description || '（無簡介）')}</div>
              ${linkHtml}
            </div>
          </div>
        `;
      }).join('');
      const html = `<div class="osint-wiki-section facility-wiki-info">${sectionLabel}${cardsHtml}</div>`;
      injectIntoPopup((tempDiv) => {
        const existing = tempDiv.querySelector('.facility-wiki-info');
        if (existing) existing.remove();
        const linksDiv = tempDiv.querySelector('.popup-links');
        if (linksDiv) {
          linksDiv.insertAdjacentHTML('beforebegin', html);
        } else {
          tempDiv.insertAdjacentHTML('beforeend', html);
        }
      });
    } else if (loadingShown) {
      injectIntoPopup((tempDiv) => {
        const existing = tempDiv.querySelector('.facility-wiki-info');
        if (existing) { existing.remove(); return true; }
        return false;
      });
    }
  } catch (error) {
    clearTimeout(loadingTimer);
    console.error('[Map] 處理設施維基百科資訊失敗:', error);
  }
}

// 取得 GeoJSON 資料（含進度顯示）
// stallTimeoutMs：連線建立或串流期間「無新資料」超過此時間即中止，
// 以每個 chunk 重置計時器（而非固定總時限），避免大檔案在慢速網路下被誤判逾時。
async function fetchGeoJSON(url, stallTimeoutMs = 15000) {
  const controller = new AbortController();
  let timeoutId = setTimeout(() => controller.abort(), stallTimeoutMs);
  const resetTimeout = () => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => controller.abort(), stallTimeoutMs);
  };

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`載入資料失敗: ${response.status}`);
    }

    const contentLength = response.headers.get('content-length');
    const loadingEl = document.querySelector('#loading div:last-child');

    if (contentLength && response.body) {
      const total = Math.max(parseInt(contentLength, 10) || 0, 0);
      let loaded = 0;
      const reader = response.body.getReader();
      const chunks = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetTimeout();
        chunks.push(value);
        loaded += value.length;
        if (loadingEl) {
          const pct = total > 0 ? Math.min(99, Math.floor(loaded / total * 100)) : 0;
          loadingEl.textContent = `載入地圖資料中... ${pct}%`;
        }
      }

      const allChunks = new Uint8Array(loaded);
      let pos = 0;
      for (const chunk of chunks) {
        allChunks.set(chunk, pos);
        pos += chunk.length;
      }
      if (loadingEl) loadingEl.textContent = '載入地圖資料中... 100%';
      return JSON.parse(new TextDecoder().decode(allChunks));
    }

    return await response.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('載入資料逾時，請檢查網路連線後重試');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 將特徵批次加入為標記（共用於搜尋/shape 模式）
function addMarkersForFeatures(features, targetCoords = null, selectedLayer = null, radiusKm = null) {
  // 優化：分批載入標記以提升效能
  const featuresToShow = features || [];
  const batchSize = isMobileDevice() ? 50 : 100;
  let currentBatch = 0;

  const addMarkersBatch = () => {
    const start = currentBatch * batchSize;
    const end = Math.min(start + batchSize, featuresToShow.length);
    const batchFeatures = featuresToShow.slice(start, end);

    if (batchFeatures.length > 0) {
      L.geoJSON({ type: 'FeatureCollection', features: batchFeatures }, {
        pointToLayer: (feature, latlng) => {
          const props = feature.properties || {};
          const layerName = getFeatureLayerName(props);
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
          const layerName = getFeatureLayerName(props);
          const iconData = getLayerIcon(layerName);
          let popupContent = '';
          let referenceLinks = [];
          let mainTitle = cleanText(props['名稱'] || props['name'] || '軍事設施');
          popupContent += `<div class="popup-header"><div class="popup-icon">${iconData.svg}</div><h3 class="popup-title">${escapeHtml(mainTitle)}</h3></div>`;
          popupContent += buildPopupFieldHtml('分層類別', toDisplayLayerName(layerName), { accentColor: iconData.color, accentColorDark: iconData.colorDark, valueClassName: 'popup-field-badge' });
          let equipmentText = '';
          let facilityWikiLinks = [];
          Object.entries(props).forEach(([key, value]) => {
            if (key === '說明') {
              if (window.equipmentParser) {
                facilityWikiLinks = window.equipmentParser.extractWikipediaLinksFromText(value);
              }
              const { links, text } = extractReferenceLinks(value);
              if (links.length) referenceLinks.push(...links);
              value = formatDescriptionText(text);
              if (value.includes('裝備')) equipmentText = value;
            }
            if (['名稱', 'name', 'layer', '分層', '類別'].includes(key)) return;
            if (value && value.toString().trim()) {
              const multiline = key === '說明';
              const fieldHtml = buildPopupFieldHtml(key, value, { multiline });
              if (fieldHtml) popupContent += fieldHtml;
            }
          });
          if (targetCoords) {
            const coords = feature.geometry.coordinates;
            const distance = calculateDistance(targetCoords.lat, targetCoords.lng, coords[1], coords[0]);
            const isZeroDistance = distance < 0.1;
            if (isZeroDistance) {
              popupContent += `<div class="popup-distance popup-distance-alert"><strong>就在搜尋中心</strong> <span class="popup-distance-alert-value">${distance < 0.01 ? '< 10公尺' : `${(distance * 1000).toFixed(0)}公尺`}</span><br/><small>此設施位於您指定的位置附近</small></div>`;
            } else {
              popupContent += `<div class=\"popup-distance\"><strong>距離搜尋中心:</strong> ${distance.toFixed(2)} 公里</div>`;
            }
          }
          // 相關連結
          if (referenceLinks.length) {
            popupContent += `<div class="popup-links"><div class="popup-links-title">相關連結</div>`;
            referenceLinks.forEach(url => { popupContent += `<a class="link-btn" href="${escapeAttr(url)}" target="_blank">${escapeHtml(getLabel(url))}</a>`; });
            popupContent += '</div>';
          }
          
          // 筆記按鈕（獨立區塊）
          const geoCoords = feature.geometry.coordinates;
          const featureId = `geojson_${geoCoords[1].toFixed(6)}_${geoCoords[0].toFixed(6)}`;
          popupContent += `<div class="popup-actions"><a href="#" class="link-btn" onclick="openNoteFromPopup(this);return false;"
            data-type="geojson"
            data-feature-id="${featureId}"
            data-feature-name="${escapeAttr(mainTitle)}"
            data-layer-name="${escapeAttr(layerName)}"
            data-lat="${geoCoords[1]}"
            data-lng="${geoCoords[0]}"
            data-metadata='{}'>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:2px;">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14,2 14,8 20,8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>筆記</a><a href="#" class="link-btn" onclick="openSatellitePassPanelFromEl(this);return false;"
            data-lat="${geoCoords[1]}"
            data-lng="${geoCoords[0]}"
            data-label="${escapeAttr(mainTitle)}">衛星過境預測</a><a href="#" class="link-btn" onclick="openAdsbTrafficPanelFromEl(this);return false;"
            data-lat="${geoCoords[1]}"
            data-lng="${geoCoords[0]}"
            data-label="${escapeAttr(mainTitle)}">周邊航空動態</a></div>`;
          
          const popupOptions = { className: 'custom-popup' };
          if (isMobileDevice()) {
            popupOptions.maxWidth = Math.min(520, window.innerWidth - 24);
            popupOptions.minWidth = Math.min(320, window.innerWidth - 32);
            popupOptions.maxHeight = Math.min(500, window.innerHeight - 120);
            popupOptions.autoPan = true;
            popupOptions.autoPanPadding = [10, 10];
            popupOptions.closeButton = true;
            popupOptions.keepInView = true;
            popupOptions.autoClose = false;
            popupOptions.closeOnEscapeKey = true;
          } else {
            popupOptions.maxWidth = Math.min(560, window.innerWidth - 48);
            popupOptions.minWidth = Math.min(360, window.innerWidth - 72);
          }
          layer.bindPopup(popupContent, popupOptions);
          if (equipmentText && window.equipmentParser) {
            // 延後到使用者實際打開 popup 時才觸發 Wikipedia 查詢，避免大範圍搜尋時
            // 一次對數十個 marker 同時發出網路請求（processEquipmentAsync 內部仍有
            // _equipmentParsingStarted 防重機制，只會觸發一次）
            layer.once('popupopen', () => processEquipmentAsync(layer, equipmentText));
          }
          if (facilityWikiLinks.length && window.equipmentParser) {
            // 說明欄位裡本來就常附有維基百科連結（設施/單位本身的條目），
            // 直接用連結標題查摘要顯示，而非只當作純文字連結按鈕
            layer.once('popupopen', () => processFacilityWikiAsync(layer, facilityWikiLinks));
          }
        }
      });

      currentBatch++;
      const progress = Math.round((end / featuresToShow.length) * 100);
      const progressLoadingEl = document.getElementById('loading');
      if (progressLoadingEl && progressLoadingEl.style.display === 'block') {
        const progressLoadingLabel = progressLoadingEl.querySelector('div:last-child');
        if (progressLoadingLabel) progressLoadingLabel.textContent = `載入標記中... ${progress}%`;
      }
      if (end < featuresToShow.length) {
        setTimeout(addMarkersBatch, 10);
      } else {
        hideLoading();
        let message = `顯示 ${featuresToShow.length} 個點位`;
        if (selectedLayer) message += ` (${selectedLayer})`;
        if (targetCoords && Number.isFinite(radiusKm)) message += ` (${radiusKm}公里內)`;
        updateInfoPanel(message);
      }
    } else {
      hideLoading();
      let message = `顯示 0 個點位`;
      if (selectedLayer) message += ` (${selectedLayer})`;
      if (targetCoords && Number.isFinite(radiusKm)) message += ` (${radiusKm}公里內)`;
      updateInfoPanel(message);
    }
  };

  addMarkersBatch();
  applyUnitVisibility();
}
function applyUnitVisibility() {
  const toggleBtn = document.getElementById('toggleUnitsBtn');
  if (toggleBtn) toggleBtn.classList.toggle('active', unitsVisible);
  if (!map) return;
  if (unitsVisible) {
    currentMarkers.addTo(map);
  } else {
    try { map.removeLayer(currentMarkers); } catch (_) {}
  }
}

function toggleUnitsVisibility() {
  unitsVisible = !unitsVisible;
  applyUnitVisibility();
}

function hasAisHashSnapshot() {
  if (window.AISSnapshot && typeof window.AISSnapshot.hasAisHash === 'function') {
    return window.AISSnapshot.hasAisHash();
  }
  const hash = window.location.hash.replace(/^#/, '').trim().toLowerCase();
  return hash === 'ais' || hash.startsWith('ais=');
}

function syncAisHashState() {
  if (!hasAisHashSnapshot()) return;

  unitsVisible = false;
  applyUnitVisibility();

  if (window.AISSnapshot && typeof window.AISSnapshot.render === 'function') {
    window.AISSnapshot.render();
  }
  if (window.MaritimeZones && typeof window.MaritimeZones.setVisible === 'function') {
    window.MaritimeZones.setVisible(true);
  }
}


// 顯示載入指示器
function showLoading() {
const loading = document.getElementById('loading');
if (!loading) return;
loading.style.display = 'block';
const label = loading.querySelector('div:last-child');
if (label) label.textContent = '初始化地圖...';
}

// 隱藏載入指示器
function hideLoading() {
const loading = document.getElementById('loading');
if (loading) loading.style.display = 'none';
}

// 更新 URL 座標搜尋參數並依選中圖層重新渲染地圖（供 searchLocation / selectSearchResult 共用）
function updateUrlAndRenderAtCoords(lat, lng, radius, selectedLayers) {
  // 更新 URL（保留既有 shape 參數，讓禁航區 overlay 能持續顯示）
  const urlParams = new URLSearchParams(window.location.search);

  // 設置座標搜尋參數
  urlParams.set('lat', lat);
  urlParams.set('lng', lng);
  urlParams.set('radius', radius);

  // 如果沒有選中任何圖層，刪除 layers 參數（表示顯示所有圖層）
  if (selectedLayers.length === 0) {
    urlParams.delete('layers');
  }

  const newUrl = `${window.location.origin}${window.location.pathname}?${urlParams.toString()}`;
  window.history.pushState({}, '', newUrl);

  // 重新渲染地圖：若沒有選中任何圖層，直接調用 renderMap 顯示所有圖層
  if (selectedLayers.length === 0) {
    renderMap({ lat, lng }, radius, null);
  } else if (window.renderMapWithMultipleLayers) {
    window.renderMapWithMultipleLayers({ lat, lng }, radius, selectedLayers);
  } else {
    renderMap({ lat, lng }, radius, null);
  }

  renderShapeOverlayFromUrl(selectedLayers.length === 1 ? selectedLayers[0] : null);
}

// 渲染地圖功能 - 優化版本，支援延遲載入
// options.initialZoom：僅供 bootstrap.js 初始載入時，還原分享連結中的 zoom= 參數用，
// 一般搜尋操作（重新輸入座標等）不應帶入，維持預設依半徑計算的縮放層級
function renderMap(targetCoords, radiusKm = 50, selectedLayer = null, options = {}) {
  const { initialZoom } = options;
  // 清除現有標記
  currentMarkers.clearLayers();
  if (centerMarker) {
    map.removeLayer(centerMarker);
    centerMarker = null;
  }
  // 清除禁航區圖層（切回搜尋模式時）
  try { nfzLayerGroup.clearLayers(); } catch (_) {}

  let featuresToShow = allFeatures;
  let mapCenter = [25.5100, 119.7910]; // 預設中心
  let mapZoom = 7;

  // 更新載入狀態
  {
    const renderLoadingEl = document.getElementById('loading');
    if (renderLoadingEl && renderLoadingEl.style.display === 'block') {
      const renderLoadingLabel = renderLoadingEl.querySelector('div:last-child');
      if (renderLoadingLabel) renderLoadingLabel.textContent = '渲染地圖標記中...';
    }
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
    const redIcon = createRedDotIcon();
    centerMarker = L.marker([targetCoords.lat, targetCoords.lng], { icon: redIcon })
      .addTo(map)
      .bindPopup(`<strong>搜尋中心</strong><br/>緯度: ${targetCoords.lat}<br/>經度: ${targetCoords.lng}<br/>搜尋半徑: ${radiusKm} 公里`);
  }

  // 若帶有分享連結的 zoom= 參數，優先還原當時的縮放層級
  if (Number.isFinite(initialZoom)) {
    mapZoom = initialZoom;
  }

  // 設定地圖視野
  map.setView(mapCenter, mapZoom);

  // 標記建立／popup 組裝／批次載入邏輯與搜尋模式完全共用，見 addMarkersForFeatures
  // （內部已包含 applyUnitVisibility()，這裡不需要再呼叫一次）
  addMarkersForFeatures(featuresToShow, targetCoords, selectedLayer, radiusKm);
}
