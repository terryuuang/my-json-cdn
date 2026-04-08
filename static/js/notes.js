/**
 * 筆記功能模組 - APEINTEL ATLAS
 * 使用 IndexedDB 實現離線筆記儲存
 * 功能：CRUD 筆記、地圖標記、匯出/匯入
 */

// ============================================
// IndexedDB 設定
// ============================================
const DB_NAME = 'ApeintelAtlasNotes';
const DB_VERSION = 1;
const STORE_NAME = 'notes';
const NOTES_LAYER_VISIBILITY_KEY = 'apeintel_notes_layer_visible';

let notesDB = null;
let notesLayerGroup = null;
let notesLayerVisible = true;
let notesVisibilityControlBtn = null;

// ============================================
// 初始化 IndexedDB
// ============================================
async function initNotesDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error('[Notes] IndexedDB 開啟失敗:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      notesDB = request.result;
      resolve(notesDB);
    };

    // 首次建立或版本升級時建立資料結構
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
      // 建立筆記儲存區
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        // 建立索引以便查詢
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('featureId', 'featureId', { unique: false });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('coords', ['lat', 'lng'], { unique: false });
      }
    };
  });
}

// ============================================
// CRUD 操作
// ============================================

// 產生唯一 ID
function generateNoteId() {
  return `note_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// 建立筆記
async function createNote(noteData) {
  const note = {
    id: generateNoteId(),
    type: noteData.type || 'custom',      // geojson, osm, drawing, custom
    featureId: noteData.featureId || null,
    featureName: noteData.featureName || '',
    layerName: noteData.layerName || '',
    lat: noteData.lat,
    lng: noteData.lng,
    title: noteData.title || '',
    content: noteData.content || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isVisible: noteData.isVisible !== false,
    // 幾何資料（用於繪製圖形）
    // 支援: Point, LineString, Polygon, Circle, Sector, Rectangle, GeometryCollection
    geometry: noteData.geometry || null,
    // 額外資料（用於繪圖資訊等）
    metadata: noteData.metadata || {}
  };

  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.add(note);

    request.onsuccess = () => {
      refreshNotesLayer();
      resolve(note);
    };

    request.onerror = () => {
      console.error('[Notes] 筆記建立失敗:', request.error);
      reject(request.error);
    };
  });
}

// 讀取單一筆記
async function getNote(id) {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(id);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 讀取所有筆記
async function getAllNotes() {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 根據類型讀取筆記
async function getNotesByType(type) {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('type');
    const request = index.getAll(type);

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

// 根據 featureId 讀取筆記
async function getNoteByFeatureId(featureId) {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('featureId');
    const request = index.get(featureId);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// 更新筆記
async function updateNote(id, updates) {
  const existingNote = await getNote(id);
  if (!existingNote) {
    throw new Error('筆記不存在');
  }

  const updatedNote = {
    ...existingNote,
    ...updates,
    updatedAt: Date.now()
  };

  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(updatedNote);

    request.onsuccess = () => {
      refreshNotesLayer();
      resolve(updatedNote);
    };

    request.onerror = () => {
      console.error('[Notes] 筆記更新失敗:', request.error);
      reject(request.error);
    };
  });
}

// 刪除筆記
async function deleteNote(id) {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => {
      refreshNotesLayer();
      resolve(true);
    };

    request.onerror = () => {
      console.error('[Notes] 筆記刪除失敗:', request.error);
      reject(request.error);
    };
  });
}

// 清除所有筆記
async function clearAllNotes() {
  return new Promise((resolve, reject) => {
    const transaction = notesDB.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => {
      refreshNotesLayer();
      resolve(true);
    };

    request.onerror = () => reject(request.error);
  });
}

// 建立筆記圖標
function createNoteIcon() {
  return L.divIcon({
    className: 'note-marker-icon',
    html: `<div class="note-marker">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
      </svg>
    </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
  });
}

// 初始化筆記圖層
function initNotesLayer(map) {
  if (!notesLayerGroup) {
    notesLayerGroup = L.layerGroup().addTo(map);
  }
  refreshNotesLayer();
}

// 重新整理筆記圖層
async function refreshNotesLayer() {
  if (!notesLayerGroup) return;
  
  notesLayerGroup.clearLayers();
  if (!notesLayerVisible) return;

  const notes = await getAllNotes();
  
  notes.forEach(note => {
    if (Number.isFinite(note.lat) && Number.isFinite(note.lng) && note.isVisible !== false) {
      // 根據幾何類型繪製不同圖形
      const layers = createNoteGeometryLayers(note);
      
      layers.forEach(layer => {
        layer.bindPopup(() => createNotePopupContent(note), {
          maxWidth: 350,
          className: 'note-popup'
        });
        layer.noteId = note.id;
        notesLayerGroup.addLayer(layer);
      });
    }
  });
}

function buildGeometryLayers(geometry, note, options = {}) {
  const { includeMarker = true } = options;
  const layers = [];
  if (!geometry || !geometry.type) return layers;

  const noteStyle = {
    color: '#0891b2',
    weight: 3,
    fillColor: '#06b6d4',
    fillOpacity: 0.15,
    dashArray: '5, 5'
  };

  switch (geometry.type) {
    case 'Point':
      if (includeMarker) {
        layers.push(L.marker([note.lat, note.lng], { icon: createNoteIcon() }));
      } else if (Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
        layers.push(L.circleMarker([geometry.coordinates[1], geometry.coordinates[0]], {
          color: noteStyle.color,
          weight: 2,
          radius: 5,
          fillColor: noteStyle.fillColor,
          fillOpacity: 0.8
        }));
      }
      break;

    case 'LineString':
      if (geometry.coordinates && geometry.coordinates.length >= 2) {
        const latlngs = geometry.coordinates.map(c => [c[1], c[0]]);
        const polyline = L.polyline(latlngs, { ...noteStyle, fillOpacity: 0 });
        layers.push(polyline);
        if (includeMarker) {
          layers.push(L.marker(polyline.getBounds().getCenter(), { icon: createNoteIcon() }));
        }
      }
      break;

    case 'Polygon':
      if (geometry.coordinates && geometry.coordinates.length >= 3) {
        const latlngs = geometry.coordinates.map(c => [c[1], c[0]]);
        const polygon = L.polygon(latlngs, noteStyle);
        layers.push(polygon);
        if (includeMarker) {
          layers.push(L.marker(polygon.getBounds().getCenter(), { icon: createNoteIcon() }));
        }
      }
      break;

    case 'Circle':
      if (geometry.center && Number.isFinite(geometry.radiusKm)) {
        const circle = L.circle(
          [geometry.center[1], geometry.center[0]],
          { ...noteStyle, radius: geometry.radiusKm * 1000 }
        );
        layers.push(circle);
        if (includeMarker) {
          layers.push(L.marker([note.lat, note.lng], { icon: createNoteIcon() }));
        }
      }
      break;

    case 'Sector':
      if (geometry.center && Number.isFinite(geometry.radiusKm) &&
          Number.isFinite(geometry.startDeg) && Number.isFinite(geometry.endDeg) &&
          window.shapeUtils && window.shapeUtils.buildSectorLatLngs) {
        const centerObj = { lat: geometry.center[1], lng: geometry.center[0] };
        const sectorLatLngs = window.shapeUtils.buildSectorLatLngs(
          centerObj, geometry.radiusKm, geometry.startDeg, geometry.endDeg
        );
        const sector = L.polygon(sectorLatLngs, noteStyle);
        layers.push(sector);
        if (includeMarker) {
          layers.push(L.marker([note.lat, note.lng], { icon: createNoteIcon() }));
        }
      }
      break;

    case 'Rectangle':
      if (geometry.bounds) {
        const { west, south, east, north } = geometry.bounds;
        const rectLatLngs = [
          [south, west],
          [south, east],
          [north, east],
          [north, west]
        ];
        const rectangle = L.polygon(rectLatLngs, noteStyle);
        layers.push(rectangle);
        if (includeMarker) {
          layers.push(L.marker(rectangle.getBounds().getCenter(), { icon: createNoteIcon() }));
        }
      }
      break;

    case 'GeometryCollection':
      if (Array.isArray(geometry.geometries)) {
        const visibleIndexes = Array.isArray(note.metadata?.visibleGeometryIndexes)
          ? new Set(note.metadata.visibleGeometryIndexes)
          : null;
        geometry.geometries.forEach((item, index) => {
          if (visibleIndexes && !visibleIndexes.has(index)) return;
          layers.push(...buildGeometryLayers(item, note, { includeMarker: false }));
        });
        if (includeMarker) {
          layers.push(L.marker([note.lat, note.lng], { icon: createNoteIcon() }));
        }
      }
      break;

    default:
      if (includeMarker) {
        layers.push(L.marker([note.lat, note.lng], { icon: createNoteIcon() }));
      }
  }

  return layers;
}

// 根據筆記的幾何資料建立圖層
function createNoteGeometryLayers(note) {
  const geometry = note.geometry;
  return (geometry && geometry.type)
    ? buildGeometryLayers(geometry, note)
    : [L.marker([note.lat, note.lng], { icon: createNoteIcon() })];
}

// 建立筆記 Popup 內容
function createNotePopupContent(note) {
  const date = new Date(note.updatedAt).toLocaleString('zh-TW');
  const typeLabel = {
    'geojson': '單位筆記',
    'osm': '設施筆記',
    'drawing': '繪圖筆記',
    'custom': '自訂筆記'
  }[note.type] || '筆記';

  return `
    <div class="note-popup-content">
      <div class="note-popup-header">
        <span class="note-type-badge">${typeLabel}</span>
        <div class="note-popup-actions">
          <button class="note-btn note-btn-edit" onclick="editNoteDialog('${note.id}')" title="編輯">編輯</button>
          <button class="note-btn note-btn-delete" onclick="confirmDeleteNote('${note.id}')" title="刪除">刪除</button>
        </div>
      </div>
      <h3 class="note-popup-title">${escapeHtml(note.title) || '（無標題）'}</h3>
      ${note.featureName ? `<div class="note-feature-name">${escapeHtml(note.featureName)}</div>` : ''}
      <div class="note-popup-body">${escapeHtml(note.content) || '（無內容）'}</div>
      <div class="note-popup-meta">
        <span>${date}</span>
        <span>${note.isVisible === false ? '已隱藏' : '顯示中'}</span>
        <span>${note.lat.toFixed(5)}, ${note.lng.toFixed(5)}</span>
      </div>
    </div>
  `;
}

// HTML 跳脫
function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function buildGeometryTypeLabel(type) {
  return {
    Point: '點標記',
    LineString: '線段',
    Polygon: '多邊形',
    Circle: '圓形',
    Sector: '扇形',
    Rectangle: '矩形',
    GeometryCollection: '群組圖形'
  }[type] || type || '圖形';
}

function getGeometryVisibilityState(geometry, metadata = {}) {
  if (!geometry || geometry.type !== 'GeometryCollection' || !Array.isArray(geometry.geometries)) {
    return null;
  }

  const items = Array.isArray(metadata.groupItems) ? metadata.groupItems : [];
  const selected = Array.isArray(metadata.visibleGeometryIndexes)
    ? metadata.visibleGeometryIndexes.filter(index => Number.isInteger(index) && index >= 0 && index < geometry.geometries.length)
    : geometry.geometries.map((_, index) => index);

  return geometry.geometries.map((item, index) => ({
    index,
    checked: selected.includes(index),
    label: items[index]?.name || `${buildGeometryTypeLabel(item.type)} ${index + 1}`,
    typeLabel: buildGeometryTypeLabel(item.type)
  }));
}

function buildGeometryVisibilityEditor(geometry, metadata = {}) {
  const states = getGeometryVisibilityState(geometry, metadata);
  if (!states) return '';

  const selectedCount = states.filter(item => item.checked).length;
  const itemsHtml = states.map(item => `
    <label class="note-geometry-item ${item.checked ? 'is-selected' : ''}">
      <input type="checkbox" class="note-geometry-checkbox" value="${item.index}" ${item.checked ? 'checked' : ''} onchange="handleGeometryVisibilityChange()">
      <span class="note-geometry-item-main">
        <span class="note-geometry-item-title">${escapeHtml(item.label)}</span>
        <span class="note-geometry-item-type">${escapeHtml(item.typeLabel)}</span>
      </span>
    </label>
  `).join('');

  return `
    <div class="note-input-group">
      <label>顯示哪些圖形</label>
      <div class="note-geometry-toolbar">
        <button type="button" class="note-btn note-btn-secondary note-btn-sm" onclick="setAllGeometryVisibility(true)">全部顯示</button>
        <button type="button" class="note-btn note-btn-secondary note-btn-sm" onclick="setAllGeometryVisibility(false)">全部隱藏</button>
        <span class="note-geometry-summary" id="noteGeometrySummary">${selectedCount} / ${states.length} 已顯示</span>
      </div>
      <div class="note-geometry-list">${itemsHtml}</div>
    </div>
  `;
}

// ============================================
// UI 對話框
// ============================================

// 顯示新增/編輯筆記對話框
async function showNoteDialog(options = {}) {
  const {
    mode = 'create',
    noteId = null,
    type = 'custom',
    featureId = null,
    featureName = '',
    layerName = '',
    lat = null,
    lng = null,
    metadata = {},
    geometry = null
  } = options;

  let existingNote = null;
  if (mode === 'edit' && noteId) {
    existingNote = await getNote(noteId);
    if (!existingNote) {
      showNoteToast('找不到筆記', 'error');
      return;
    }
  }

  const title = existingNote?.title || '';
  const content = existingNote?.content || '';
  const dialogTitle = mode === 'edit' ? '編輯筆記' : '新增筆記';
  
  // 顯示幾何類型資訊（如果有的話）
  const finalGeometry = existingNote?.geometry || geometry;
  let geometryInfoHtml = '';
  if (finalGeometry && finalGeometry.type) {
    geometryInfoHtml = `<span style="color:#0891b2;margin-left:8px;">幾何: ${buildGeometryTypeLabel(finalGeometry.type)}</span>`;
  }
  const geometryVisibilityHtml = buildGeometryVisibilityEditor(finalGeometry, existingNote?.metadata || metadata);

  // 建立對話框
  const dialog = document.createElement('div');
  dialog.id = 'note-dialog';
  dialog.className = 'note-dialog-overlay';
  dialog.innerHTML = `
    <div class="note-dialog">
      <div class="note-dialog-header">
        <h3>${dialogTitle}</h3>
        <button class="note-dialog-close" onclick="closeNoteDialog()">&times;</button>
      </div>
      <div class="note-dialog-body">
        ${featureName ? `<div class="note-dialog-feature">${escapeHtml(featureName)}${geometryInfoHtml}</div>` : ''}
        <div class="note-input-group">
          <label for="noteTitle">標題</label>
          <input type="text" id="noteTitle" class="note-input" placeholder="輸入筆記標題..." value="${escapeHtml(title)}" maxlength="100">
        </div>
        <div class="note-input-group">
          <label for="noteContent">內容</label>
          <textarea id="noteContent" class="note-textarea" placeholder="輸入筆記內容..." rows="6" maxlength="2000">${escapeHtml(content)}</textarea>
        </div>
        ${geometryVisibilityHtml}
        <div class="note-dialog-info">
          ${Number.isFinite(lat) && Number.isFinite(lng) ? `<span>座標：${lat.toFixed(5)}, ${lng.toFixed(5)}</span>` : ''}
        </div>
      </div>
      <div class="note-dialog-footer">
        <button class="note-btn note-btn-secondary" onclick="closeNoteDialog()">取消</button>
        <button class="note-btn note-btn-primary" onclick="saveNoteFromDialog()">儲存</button>
      </div>
    </div>
  `;

  // 儲存對話框資料（包含幾何資料）
  dialog.dataset.mode = mode;
  dialog.dataset.noteId = noteId || '';
  dialog.dataset.type = type;
  dialog.dataset.featureId = featureId || '';
  dialog.dataset.featureName = featureName;
  dialog.dataset.layerName = layerName;
  dialog.dataset.lat = lat || '';
  dialog.dataset.lng = lng || '';
  dialog.dataset.metadata = JSON.stringify(metadata);
  dialog.dataset.geometry = JSON.stringify(finalGeometry);

  document.body.appendChild(dialog);
  
  // 聚焦標題輸入框
  setTimeout(() => {
    document.getElementById('noteTitle')?.focus();
  }, 100);
}

// 關閉對話框
function closeNoteDialog() {
  const dialog = document.getElementById('note-dialog');
  if (dialog) {
    dialog.remove();
  }
}

// 從對話框儲存筆記
async function saveNoteFromDialog() {
  const dialog = document.getElementById('note-dialog');
  if (!dialog) return;

  const title = document.getElementById('noteTitle')?.value?.trim() || '';
  const content = document.getElementById('noteContent')?.value?.trim() || '';

  if (!title && !content) {
    showNoteToast('請輸入標題或內容', 'warning');
    return;
  }

  const mode = dialog.dataset.mode;
  const noteId = dialog.dataset.noteId;
  const metadata = JSON.parse(dialog.dataset.metadata || '{}');
  const geometry = JSON.parse(dialog.dataset.geometry || 'null');
  if (geometry?.type === 'GeometryCollection' && Array.isArray(geometry.geometries)) {
    metadata.visibleGeometryIndexes = Array.from(document.querySelectorAll('.note-geometry-checkbox:checked'))
      .map(input => parseInt(input.value, 10))
      .filter(Number.isInteger);
  }

  try {
    if (mode === 'edit' && noteId) {
      await updateNote(noteId, { title, content, metadata });
      showNoteToast('筆記已更新');
    } else {
      const lat = parseFloat(dialog.dataset.lat);
      const lng = parseFloat(dialog.dataset.lng);
      
      if (isNaN(lat) || isNaN(lng)) {
        showNoteToast('無效的座標', 'error');
        return;
      }

      await createNote({
        type: dialog.dataset.type,
        featureId: dialog.dataset.featureId || null,
        featureName: dialog.dataset.featureName,
        layerName: dialog.dataset.layerName,
        lat,
        lng,
        title,
        content,
        // 儲存完整的幾何資料
        geometry,
        metadata
      });
      showNoteToast('筆記已儲存');
    }
    closeNoteDialog();
  } catch (error) {
    console.error('[Notes] 儲存失敗:', error);
    showNoteToast('儲存失敗', 'error');
  }
}

// 編輯筆記對話框
async function editNoteDialog(noteId) {
  const note = await getNote(noteId);
  if (!note) {
    showNoteToast('找不到筆記', 'error');
    return;
  }

  showNoteDialog({
    mode: 'edit',
    noteId: note.id,
    type: note.type,
    featureId: note.featureId,
    featureName: note.featureName,
    layerName: note.layerName,
    lat: note.lat,
    lng: note.lng,
    metadata: note.metadata
  });
}

// 確認刪除筆記
function confirmDeleteNote(noteId) {
  if (confirm('確定要刪除這則筆記嗎？此操作無法復原。')) {
    deleteNote(noteId).then(() => {
      showNoteToast('筆記已刪除');
      // 關閉 popup
      if (window.map) {
        window.map.closePopup();
      }
      // 軟刷新：如果筆記列表對話框開著，重新載入列表
      const listDialog = document.getElementById('notes-list-dialog');
      if (listDialog) {
        closeNotesListDialog();
        showNotesListDialog();
      }
    }).catch(() => {
      showNoteToast('刪除失敗', 'error');
    });
  }
}

// ============================================
// 筆記列表對話框
// ============================================

// 顯示所有筆記列表
async function showNotesListDialog() {
  closeNotesListDialog();
  const notes = await getAllNotes();
  
  // 依更新時間排序（最新在前）
  notes.sort((a, b) => b.updatedAt - a.updatedAt);

  const dialog = document.createElement('div');
  dialog.id = 'notes-list-dialog';
  dialog.className = 'note-dialog-overlay';
  
  const notesList = notes.length > 0 
    ? notes.map(note => {
        const date = new Date(note.updatedAt).toLocaleDateString('zh-TW');
        const typeLabel = {
          'geojson': '單位',
          'osm': '設施',
          'drawing': '繪圖',
          'custom': '筆記'
        }[note.type] || '筆記';
        const visibilityLabel = note.isVisible === false ? '隱藏' : '顯示';
        const visibilityTitle = note.isVisible === false ? '顯示筆記圖層' : '隱藏筆記圖層';
        const visibilityIcon = note.isVisible === false
          ? `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/>`
          : `<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>`;
        
        return `
          <div class="notes-list-item" data-note-id="${note.id}">
            <div class="notes-list-item-type">${typeLabel}</div>
            <div class="notes-list-item-content">
              <div class="notes-list-item-title">${escapeHtml(note.title) || '（無標題）'}</div>
              <div class="notes-list-item-preview">${escapeHtml(note.content?.substring(0, 50)) || '（無內容）'}${note.content?.length > 50 ? '...' : ''}</div>
              <div class="notes-list-item-meta">
                ${note.featureName ? `<span>${escapeHtml(note.featureName)}</span>` : ''}
                <span class="notes-list-item-visibility ${note.isVisible === false ? 'is-hidden' : 'is-visible'}">${visibilityLabel}</span>
                <span>${date}</span>
              </div>
            </div>
            <div class="notes-list-item-actions">
              <button class="note-icon-btn" onclick="toggleNoteVisibility('${note.id}')" title="${visibilityTitle}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  ${visibilityIcon}
                </svg>
              </button>
              <button class="note-icon-btn" onclick="flyToNote('${note.id}')" title="前往位置">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
              </button>
              <button class="note-icon-btn" onclick="editNoteDialog('${note.id}')" title="編輯">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="note-icon-btn note-icon-btn-danger" onclick="confirmDeleteNote('${note.id}')" title="刪除">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3,6 5,6 21,6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
            </div>
          </div>
        `;
      }).join('')
    : '<div class="notes-list-empty">尚無筆記<br><small>在地圖點位的彈出視窗中點擊「筆記」按鈕來新增</small></div>';

  dialog.innerHTML = `
    <div class="note-dialog note-dialog-large">
      <div class="note-dialog-header">
        <h3>我的筆記 (${notes.length})</h3>
        <button class="note-dialog-close" onclick="closeNotesListDialog()">&times;</button>
      </div>
      <div class="note-dialog-toolbar">
        <button class="note-btn note-btn-secondary" onclick="toggleAllNotesVisibility(true)" ${notes.length === 0 ? 'disabled' : ''}>
          顯示全部
        </button>
        <button class="note-btn note-btn-secondary" onclick="toggleAllNotesVisibility(false)" ${notes.length === 0 ? 'disabled' : ''}>
          全部隱藏
        </button>
        <button class="note-btn note-btn-secondary" onclick="exportNotes()" ${notes.length === 0 ? 'disabled' : ''}>
          匯出
        </button>
        <button class="note-btn note-btn-secondary" onclick="importNotesFile()">
          匯入
        </button>
        <input type="file" id="importNotesInput" accept=".json" style="display:none" onchange="handleImportNotes(event)">
        ${notes.length > 0 ? `
          <button class="note-btn note-btn-danger" onclick="confirmClearAllNotes()">
            清除全部
          </button>
        ` : ''}
      </div>
      <div class="notes-list-container">
        ${notesList}
      </div>
    </div>
  `;

  document.body.appendChild(dialog);
}

// 關閉筆記列表
function closeNotesListDialog() {
  const dialog = document.getElementById('notes-list-dialog');
  if (dialog) {
    dialog.remove();
  }
}

// 飛到筆記位置
async function flyToNote(noteId) {
  let note = await getNote(noteId);
  if (!note || !window.map) return;

  if (note.isVisible === false) {
    await updateNote(noteId, { isVisible: true });
    note = await getNote(noteId);
  }
  if (!notesLayerVisible) {
    setNotesLayerVisibility(true, { silent: true });
  }

  closeNotesListDialog();
  
  window.map.flyTo([note.lat, note.lng], 16, {
    duration: 1
  });

  // 找到對應的 marker 並開啟 popup
  setTimeout(() => {
    if (notesLayerGroup) {
      notesLayerGroup.eachLayer(layer => {
        if (layer.noteId === noteId) {
          layer.openPopup();
        }
      });
    }
  }, 1200);
}

async function toggleNoteVisibility(noteId) {
  const note = await getNote(noteId);
  if (!note) return;
  await updateNote(noteId, { isVisible: note.isVisible === false });
  const listDialog = document.getElementById('notes-list-dialog');
  if (listDialog) {
    closeNotesListDialog();
    showNotesListDialog();
  }
}

async function toggleAllNotesVisibility(isVisible) {
  const notes = await getAllNotes();
  await Promise.all(notes.map(note => updateNote(note.id, { isVisible })));
  const listDialog = document.getElementById('notes-list-dialog');
  if (listDialog) {
    closeNotesListDialog();
    showNotesListDialog();
  }
  showNoteToast(isVisible ? '已顯示所有筆記' : '已隱藏所有筆記');
}

// 確認清除所有筆記
function confirmClearAllNotes() {
  if (confirm('確定要刪除所有筆記嗎？\n\n此操作無法復原！')) {
    clearAllNotes().then(() => {
      showNoteToast('所有筆記已清除');
      closeNotesListDialog();
    });
  }
}

// ============================================
// 匯出/匯入功能
// ============================================

// 匯出筆記為 JSON
async function exportNotes() {
  const notes = await getAllNotes();
  if (notes.length === 0) {
    showNoteToast('沒有筆記可匯出', 'warning');
    return;
  }

  const exportData = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    appName: 'APEINTEL ATLAS',
    notesCount: notes.length,
    notes: notes
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `apeintel-notes-${new Date().toISOString().split('T')[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showNoteToast(`已匯出 ${notes.length} 則筆記`);
}

// 觸發匯入檔案選擇
function importNotesFile() {
  document.getElementById('importNotesInput')?.click();
}

// 處理匯入檔案
async function handleImportNotes(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.notes || !Array.isArray(data.notes)) {
      throw new Error('無效的筆記檔案格式');
    }

    let importedCount = 0;
    for (const note of data.notes) {
      // 重新產生 ID 避免衝突
      const newNote = {
        ...note,
        id: generateNoteId(),
        createdAt: note.createdAt || Date.now(),
        updatedAt: Date.now()
      };
      
      await new Promise((resolve, reject) => {
        const transaction = notesDB.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(newNote);
        request.onsuccess = () => { importedCount++; resolve(); };
        request.onerror = () => reject(request.error);
      });
    }

    refreshNotesLayer();
    showNoteToast(`已匯入 ${importedCount} 則筆記`);
    
    // 重新整理列表
    closeNotesListDialog();
    showNotesListDialog();

  } catch (error) {
    console.error('[Notes] 匯入失敗:', error);
    showNoteToast('匯入失敗：' + error.message, 'error');
  }

  // 清空 input
  event.target.value = '';
}

// ============================================
// Toast 通知
// ============================================
function showNoteToast(message, type = 'success') {
  // 移除現有 toast
  const existing = document.querySelector('.note-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `note-toast note-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// 為 Popup 添加筆記按鈕
// ============================================

// 取得或建立筆記按鈕 HTML
// 支援 geometry 參數來儲存完整的幾何資料（用於 Leaflet.draw 繪製的圖形）
function getNoteButtonHtml(options) {
  const { type, featureId, featureName, layerName, lat, lng, metadata = {}, geometry = null } = options;
  const dataAttrs = `
    data-type="${type}"
    data-feature-id="${featureId || ''}"
    data-feature-name="${escapeHtml(featureName || '')}"
    data-layer-name="${escapeHtml(layerName || '')}"
    data-lat="${lat}"
    data-lng="${lng}"
    data-metadata='${JSON.stringify(metadata)}'
    data-geometry='${JSON.stringify(geometry)}'
  `;
  
  // 使用 SVG ICON 和一般按鈕樣式
  return `<a href="#" class="link-btn popup-note-btn" onclick="openNoteFromPopup(this);return false;" ${dataAttrs}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle;margin-right:3px;">
      <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
      <polyline points="14,2 14,8 20,8"/>
      <line x1="16" y1="13" x2="8" y2="13"/>
      <line x1="16" y1="17" x2="8" y2="17"/>
    </svg>筆記</a>`;
}

// 從 Popup 按鈕開啟筆記
async function openNoteFromPopup(btn) {
  const type = btn.dataset.type;
  const featureId = btn.dataset.featureId;
  const featureName = btn.dataset.featureName;
  const layerName = btn.dataset.layerName;
  const lat = parseFloat(btn.dataset.lat);
  const lng = parseFloat(btn.dataset.lng);
  const metadata = JSON.parse(btn.dataset.metadata || '{}');
  const geometry = JSON.parse(btn.dataset.geometry || 'null');

  // 檢查是否已有筆記
  if (featureId) {
    const existingNote = await getNoteByFeatureId(featureId);
    if (existingNote) {
      // 編輯現有筆記
      showNoteDialog({
        mode: 'edit',
        noteId: existingNote.id,
        type,
        featureId,
        featureName,
        layerName,
        lat,
        lng,
        metadata,
        geometry: existingNote.geometry || geometry
      });
      return;
    }
  }

  // 新增筆記
  showNoteDialog({
    mode: 'create',
    type,
    featureId,
    featureName,
    layerName,
    lat,
    lng,
    metadata,
    geometry
  });
}

// ============================================
// 地圖控制項
// ============================================

// 新增筆記控制按鈕到地圖
function addNotesControlToMap(map) {
  const NotesControl = L.Control.extend({
    options: {
      position: 'bottomright'
    },
    
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-control notes-control');
      const stack = L.DomUtil.create('div', 'notes-control-stack', container);
      
      const listBtn = L.DomUtil.create('a', 'notes-control-btn', stack);
      listBtn.href = '#';
      listBtn.title = '筆記列表';
      listBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
        <polyline points="14,2 14,8 20,8"/>
        <line x1="16" y1="13" x2="8" y2="13"/>
        <line x1="16" y1="17" x2="8" y2="17"/>
        <line x1="10" y1="9" x2="8" y2="9"/>
      </svg>`;
      listBtn.setAttribute('role', 'button');
      listBtn.setAttribute('aria-label', '開啟筆記列表');

      notesVisibilityControlBtn = L.DomUtil.create('a', 'notes-control-btn notes-visibility-btn', stack);
      notesVisibilityControlBtn.href = '#';
      notesVisibilityControlBtn.setAttribute('role', 'button');
      
      L.DomEvent.disableClickPropagation(listBtn);
      L.DomEvent.disableClickPropagation(notesVisibilityControlBtn);
      L.DomEvent.on(listBtn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        showNotesListDialog();
      });
      L.DomEvent.on(notesVisibilityControlBtn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        setNotesLayerVisibility(!notesLayerVisible);
      });

      updateNotesVisibilityControl();
      
      return container;
    }
  });
  
  new NotesControl().addTo(map);
}

// ============================================
// 初始化
// ============================================
async function initNotes(map) {
  try {
    await initNotesDB();
    notesLayerVisible = localStorage.getItem(NOTES_LAYER_VISIBILITY_KEY) !== '0';
    initNotesLayer(map);
    addNotesControlToMap(map);
  } catch (error) {
    console.error('[Notes] 初始化失敗:', error);
  }
}

// ============================================
// Shape 模式筆記功能
// ============================================

// 取得 Shape 筆記按鈕 HTML（用於 URL shape 模式）
// geometry 格式：
// - Point: { type: 'Point', coordinates: [lng, lat] }
// - LineString: { type: 'LineString', coordinates: [[lng, lat], ...] }
// - Polygon: { type: 'Polygon', coordinates: [[lng, lat], ...] }
// - Circle: { type: 'Circle', center: [lng, lat], radiusKm: number }
// - Sector: { type: 'Sector', center: [lng, lat], radiusKm: number, startDeg: number, endDeg: number }
// - Rectangle: { type: 'Rectangle', bounds: { west, south, east, north } }
function getShapeNoteButtonHtml(shapeData) {
  const {
    shapeType,
    lat,
    lng,
    title,
    text,
    shapeInfo,
    geometry,
    groupGeometry = null,
    groupShapeCount = 0,
    groupTitle = '',
    groupItems = []
  } = shapeData;
  const dataAttrs = `
    data-shape-type="${shapeType}"
    data-lat="${lat}"
    data-lng="${lng}"
    data-title="${encodeURIComponent(title || '')}"
    data-text="${encodeURIComponent(text || '')}"
    data-shape-info="${encodeURIComponent(JSON.stringify(shapeInfo || {}))}"
    data-geometry="${encodeURIComponent(JSON.stringify(geometry || null))}"
    data-group-geometry="${encodeURIComponent(JSON.stringify(groupGeometry || null))}"
    data-group-shape-count="${groupShapeCount || 0}"
    data-group-title="${encodeURIComponent(groupTitle || '')}"
    data-group-items="${encodeURIComponent(JSON.stringify(groupItems || []))}"
  `;
  
  return `<button class="link-btn shape-save-btn" onclick="showShapeSaveDialog(this)" ${dataAttrs}>儲存此圖形</button>`;
}

// 顯示 Shape 儲存對話框
function showShapeSaveDialog(btn) {
  closeShapeSaveDialog();

  const shapeType = btn.dataset.shapeType;
  const lat = parseFloat(btn.dataset.lat);
  const lng = parseFloat(btn.dataset.lng);
  const title = decodeURIComponent(btn.dataset.title || '');
  const text = decodeURIComponent(btn.dataset.text || '');
  const shapeInfo = JSON.parse(decodeURIComponent(btn.dataset.shapeInfo || '%7B%7D'));
  const geometry = JSON.parse(decodeURIComponent(btn.dataset.geometry || 'null'));
  const groupGeometry = JSON.parse(decodeURIComponent(btn.dataset.groupGeometry || 'null'));
  const groupShapeCount = parseInt(btn.dataset.groupShapeCount || '0', 10);
  const groupTitle = decodeURIComponent(btn.dataset.groupTitle || '');
  const groupItems = JSON.parse(decodeURIComponent(btn.dataset.groupItems || '[]'));
  const hasGroupOption = groupGeometry && groupShapeCount > 1;

  const shapeTypeLabels = {
    'point': '標記點',
    'circle': '圓形區域',
    'line': '線段',
    'polygon': '多邊形',
    'bbox': '矩形區域',
    'sector': '扇形區域'
  };
  const typeLabel = shapeTypeLabels[shapeType] || '圖形';

  // 顯示幾何資訊摘要
  let geometryInfoHtml = '';
  if (geometry) {
    if (geometry.type === 'LineString' && geometry.coordinates) {
      geometryInfoHtml = `<br><small>頂點數: ${geometry.coordinates.length}</small>`;
    } else if (geometry.type === 'Polygon' && geometry.coordinates) {
      geometryInfoHtml = `<br><small>頂點數: ${geometry.coordinates.length}</small>`;
    }
  }

  const saveScopeHtml = hasGroupOption ? `
    <div class="note-input-group">
      <label>儲存範圍</label>
      <div class="note-choice-grid">
        <label class="note-choice-card is-selected">
          <input type="radio" name="shapeSaveScope" value="group" checked onchange="handleShapeSaveScopeChange(this)">
          <span class="note-choice-title">整組圖形</span>
          <span class="note-choice-desc">一次儲存這組圖形的 ${groupShapeCount} 個區塊</span>
        </label>
        <label class="note-choice-card">
          <input type="radio" name="shapeSaveScope" value="single" onchange="handleShapeSaveScopeChange(this)">
          <span class="note-choice-title">單一圖形</span>
          <span class="note-choice-desc">只儲存目前點到的這一個 ${typeLabel}</span>
        </label>
      </div>
    </div>
  ` : '';

  const scopeHintHtml = hasGroupOption
    ? `<div class="note-dialog-info note-dialog-info-block"><span>此連結包含 ${groupShapeCount} 個圖形，可選擇單存或整組儲存。</span></div>`
    : '';

  const dialog = document.createElement('div');
  dialog.id = 'shape-save-dialog';
  dialog.className = 'note-dialog-overlay';
  dialog.innerHTML = `
    <div class="note-dialog">
      <div class="note-dialog-header">
        <h3>儲存圖形筆記</h3>
        <button class="note-dialog-close" onclick="closeShapeSaveDialog()">&times;</button>
      </div>
      <div class="note-dialog-body">
        <div class="note-dialog-feature note-dialog-feature-shape">
          ${typeLabel}
          ${title ? `<br><small>${escapeHtml(title)}</small>` : ''}
          ${shapeInfo.radius ? `<br><small>半徑: ${shapeInfo.radius}</small>` : ''}
          ${shapeInfo.area ? `<br><small>面積: ${shapeInfo.area}</small>` : ''}
          ${shapeInfo.length ? `<br><small>長度: ${shapeInfo.length}</small>` : ''}
          ${shapeInfo.angle ? `<br><small>角度: ${shapeInfo.angle}</small>` : ''}
          ${geometryInfoHtml}
        </div>
        ${saveScopeHtml}
        <div class="note-input-group">
          <label for="shapeNoteName">名稱 <span style="color:#ef4444">*</span></label>
          <input type="text" id="shapeNoteName" class="note-input" placeholder="輸入圖形名稱（必填）..." value="${escapeHtml(hasGroupOption ? (groupTitle || title) : title)}" maxlength="100" required>
        </div>
        <div class="note-input-group">
          <label for="shapeNoteContent">備註說明</label>
          <textarea id="shapeNoteContent" class="note-textarea" placeholder="輸入備註說明（選填）..." rows="4" maxlength="2000">${escapeHtml(text)}</textarea>
        </div>
        ${scopeHintHtml}
        <div class="note-dialog-info">
          <span>座標：${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
          <span>${new Date().toLocaleString('zh-TW')}</span>
        </div>
      </div>
      <div class="note-dialog-footer">
        <button class="note-btn note-btn-secondary" onclick="closeShapeSaveDialog()">取消</button>
        <button class="note-btn note-btn-primary note-btn-primary-shape" onclick="saveShapeNote()">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right:4px">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/>
            <polyline points="17,21 17,13 7,13 7,21"/>
            <polyline points="7,3 7,8 15,8"/>
          </svg>
          儲存
        </button>
      </div>
    </div>
  `;

  // 儲存對話框資料（包含幾何資料）
  dialog.dataset.shapeType = shapeType;
  dialog.dataset.lat = lat;
  dialog.dataset.lng = lng;
  dialog.dataset.shapeInfo = JSON.stringify(shapeInfo);
  dialog.dataset.geometry = JSON.stringify(geometry);
  dialog.dataset.groupGeometry = JSON.stringify(groupGeometry);
  dialog.dataset.groupShapeCount = String(groupShapeCount || 0);
  dialog.dataset.groupTitle = groupTitle || title || '';
  dialog.dataset.singleTitle = title || '';
  dialog.dataset.groupItems = JSON.stringify(groupItems || []);

  document.body.appendChild(dialog);
  
  // 聚焦名稱輸入框
  setTimeout(() => {
    document.getElementById('shapeNoteName')?.focus();
  }, 100);
}

function handleShapeSaveScopeChange(input) {
  const dialog = document.getElementById('shape-save-dialog');
  if (!dialog || !input) return;
  document.querySelectorAll('.note-choice-card').forEach(card => {
    card.classList.toggle('is-selected', card.contains(input));
  });

  const nameInput = document.getElementById('shapeNoteName');
  if (!nameInput) return;

  const currentName = nameInput.value.trim();
  const groupTitle = dialog.dataset.groupTitle || '';
  const singleTitle = dialog.dataset.singleTitle || '';
  if (!currentName || currentName === groupTitle || currentName === singleTitle) {
    nameInput.value = input.value === 'group'
      ? (groupTitle || singleTitle)
      : (singleTitle || groupTitle);
  }
}

function refreshGeometryVisibilityUi() {
  const items = document.querySelectorAll('.note-geometry-item');
  const checked = document.querySelectorAll('.note-geometry-checkbox:checked').length;
  items.forEach(item => {
    const input = item.querySelector('.note-geometry-checkbox');
    item.classList.toggle('is-selected', Boolean(input?.checked));
  });
  const summary = document.getElementById('noteGeometrySummary');
  if (summary) {
    summary.textContent = `${checked} / ${items.length} 已顯示`;
  }
}

function handleGeometryVisibilityChange() {
  refreshGeometryVisibilityUi();
}

function setAllGeometryVisibility(isVisible) {
  document.querySelectorAll('.note-geometry-checkbox').forEach(input => {
    input.checked = Boolean(isVisible);
  });
  refreshGeometryVisibilityUi();
}

// 關閉 Shape 儲存對話框
function closeShapeSaveDialog() {
  const dialog = document.getElementById('shape-save-dialog');
  if (dialog) {
    dialog.remove();
  }
}

// 儲存 Shape 筆記
async function saveShapeNote() {
  const dialog = document.getElementById('shape-save-dialog');
  if (!dialog) return;

  const name = document.getElementById('shapeNoteName')?.value?.trim();
  const content = document.getElementById('shapeNoteContent')?.value?.trim() || '';

  if (!name) {
    showNoteToast('請輸入圖形名稱', 'warning');
    document.getElementById('shapeNoteName')?.focus();
    return;
  }

  const shapeType = dialog.dataset.shapeType;
  const lat = parseFloat(dialog.dataset.lat);
  const lng = parseFloat(dialog.dataset.lng);
  const shapeInfo = JSON.parse(dialog.dataset.shapeInfo || '{}');
  const geometry = JSON.parse(dialog.dataset.geometry || 'null');
  const groupGeometry = JSON.parse(dialog.dataset.groupGeometry || 'null');
  const groupShapeCount = parseInt(dialog.dataset.groupShapeCount || '0', 10);
  const groupItems = JSON.parse(dialog.dataset.groupItems || '[]');
  const saveScope = document.querySelector('input[name="shapeSaveScope"]:checked')?.value || 'single';
  const useGroupGeometry = saveScope === 'group' && groupGeometry && groupShapeCount > 1;
  const geometryToSave = useGroupGeometry ? groupGeometry : geometry;
  const noteLayerName = useGroupGeometry ? `URL Shape Group (${groupShapeCount})` : `URL Shape (${shapeType})`;

  try {
    const featureId = `shape_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await createNote({
      type: 'drawing',
      featureId: featureId,
      featureName: name,
      lat: lat,
      lng: lng,
      title: name,
      content: content,
      geometry: geometryToSave,
      metadata: {
        drawingType: shapeType,
        source: 'url_shape',
        saveScope: useGroupGeometry ? 'group' : 'single',
        groupShapeCount: useGroupGeometry ? groupShapeCount : 1,
        groupItems: useGroupGeometry ? groupItems : [],
        visibleGeometryIndexes: useGroupGeometry && Array.isArray(groupGeometry?.geometries)
          ? groupGeometry.geometries.map((_, index) => index)
          : undefined,
        ...shapeInfo
      },
      layerName: noteLayerName
    });

    showNoteToast(useGroupGeometry ? `已儲存整組圖形 (${groupShapeCount})` : '圖形筆記已儲存');
    closeShapeSaveDialog();
    
    // 關閉地圖 popup
    if (window.map) {
      window.map.closePopup();
    }
  } catch (error) {
    console.error('[Notes] Shape 儲存失敗:', error);
    showNoteToast('儲存失敗', 'error');
  }
}

function updateNotesVisibilityControl() {
  if (!notesVisibilityControlBtn) return;
  notesVisibilityControlBtn.title = notesLayerVisible ? '隱藏筆記圖層' : '顯示筆記圖層';
  notesVisibilityControlBtn.setAttribute('aria-label', notesLayerVisible ? '隱藏筆記圖層' : '顯示筆記圖層');
  notesVisibilityControlBtn.classList.toggle('is-off', !notesLayerVisible);
  notesVisibilityControlBtn.innerHTML = notesLayerVisible
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a21.77 21.77 0 0 1 5.06-5.94"/>
        <path d="M9.9 4.24A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a21.8 21.8 0 0 1-4.23 5.17"/>
        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
        <path d="M1 1l22 22"/>
      </svg>`;
}

function setNotesLayerVisibility(isVisible, options = {}) {
  const { silent = false } = options;
  notesLayerVisible = Boolean(isVisible);
  localStorage.setItem(NOTES_LAYER_VISIBILITY_KEY, notesLayerVisible ? '1' : '0');
  updateNotesVisibilityControl();
  refreshNotesLayer();
  if (!silent) {
    showNoteToast(notesLayerVisible ? '筆記圖層已顯示' : '筆記圖層已隱藏');
  }
}

// ============================================
// 全域 API
// ============================================
window.Notes = {
  init: initNotes,
  create: createNote,
  get: getNote,
  getAll: getAllNotes,
  update: updateNote,
  delete: deleteNote,
  clearAll: clearAllNotes,
  export: exportNotes,
  refresh: refreshNotesLayer,
  showList: showNotesListDialog,
  showDialog: showNoteDialog,
  getNoteButtonHtml,
  getShapeNoteButtonHtml,
  showToast: showNoteToast
};

// 暴露到全域供 onclick 使用
window.showNoteDialog = showNoteDialog;
window.closeNoteDialog = closeNoteDialog;
window.saveNoteFromDialog = saveNoteFromDialog;
window.editNoteDialog = editNoteDialog;
window.confirmDeleteNote = confirmDeleteNote;
window.showNotesListDialog = showNotesListDialog;
window.closeNotesListDialog = closeNotesListDialog;
window.flyToNote = flyToNote;
window.confirmClearAllNotes = confirmClearAllNotes;
window.exportNotes = exportNotes;
window.importNotesFile = importNotesFile;
window.handleImportNotes = handleImportNotes;
window.openNoteFromPopup = openNoteFromPopup;
window.showShapeSaveDialog = showShapeSaveDialog;
window.handleShapeSaveScopeChange = handleShapeSaveScopeChange;
window.handleGeometryVisibilityChange = handleGeometryVisibilityChange;
window.setAllGeometryVisibility = setAllGeometryVisibility;
window.closeShapeSaveDialog = closeShapeSaveDialog;
window.toggleNoteVisibility = toggleNoteVisibility;
window.toggleAllNotesVisibility = toggleAllNotesVisibility;
window.toggleNotesLayerVisibility = setNotesLayerVisibility;
window.saveShapeNote = saveShapeNote;
