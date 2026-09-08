// 搜尋工具：OpenCC.js 繁簡轉換 + Nominatim API + 模糊搜尋
(function() {
  // ==========================================================
  // OpenCC.js 繁簡轉換（使用 CDN 版本）
  // ==========================================================
  let t2sConverter = null;
  let s2tConverter = null;

  // 初始化 OpenCC 轉換器
  function initOpenCC() {
    if (typeof OpenCC === 'undefined') {
      console.warn('[Search] OpenCC.js 未載入，使用基本轉換');
      return false;
    }

    try {
      // 繁體（台灣）→ 簡體（中國大陸）
      t2sConverter = OpenCC.Converter({ from: 'tw', to: 'cn' });
      // 簡體（中國大陸）→ 繁體（台灣）
      s2tConverter = OpenCC.Converter({ from: 'cn', to: 'tw' });
      return true;
    } catch (error) {
      console.error('[Search] OpenCC 初始化失敗:', error);
      return false;
    }
  }

  // 繁轉簡函數
  function traditional2Simplified(text) {
    if (!text) return '';

    // 如果 OpenCC 可用，使用它
    if (t2sConverter) {
      try {
        return t2sConverter(text);
      } catch (error) {
        console.error('[Search] OpenCC 轉換錯誤:', error);
      }
    }

    // Fallback: 返回原文（大部分簡體字已經是簡體了）
    return text;
  }

  // 簡轉繁函數
  function simplified2Traditional(text) {
    if (!text) return '';

    if (s2tConverter) {
      try {
        return s2tConverter(text);
      } catch (error) {
        console.error('[Search] OpenCC 轉換錯誤:', error);
      }
    }

    return text;
  }

  // ==========================================================
  // Nominatim API 整合
  // ==========================================================

  const NOMINATIM_CONFIG = {
    endpoint: 'https://nominatim.openstreetmap.org/search',
    // 根據 Nominatim 使用政策：每秒最多 1 個請求
    rateLimitMs: 1100, // 1.1 秒，留點餘裕
    userAgent: 'MapSearchApp/1.0',
    // 快取搜尋結果（避免重複請求）
    cache: new Map(),
    cacheMaxAge: 3600000, // 1 小時
    // 請求隊列
    requestQueue: [],
    isProcessing: false
  };

  // Rate limiting 請求處理器
  async function nominatimRequest(query) {
    return new Promise((resolve, reject) => {
      // 檢查快取
      const cacheKey = query.toLowerCase();
      const cached = NOMINATIM_CONFIG.cache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < NOMINATIM_CONFIG.cacheMaxAge) {
        resolve(cached.data);
        return;
      }

      // 加入請求隊列
      NOMINATIM_CONFIG.requestQueue.push({ query, resolve, reject });

      // 處理隊列
      processNominatimQueue();
    });
  }

  // 處理 Nominatim 請求隊列（確保 rate limit）
  async function processNominatimQueue() {
    if (NOMINATIM_CONFIG.isProcessing || NOMINATIM_CONFIG.requestQueue.length === 0) {
      return;
    }

    NOMINATIM_CONFIG.isProcessing = true;
    const { query, resolve, reject } = NOMINATIM_CONFIG.requestQueue.shift();

    try {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        limit: 5,
        addressdetails: 1,
        'accept-language': 'zh-CN,zh-TW,zh'
      });

      const response = await fetch(`${NOMINATIM_CONFIG.endpoint}?${params}`, {
        headers: {
          'User-Agent': NOMINATIM_CONFIG.userAgent
        }
      });

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`);
      }

      const data = await response.json();

      // 存入快取
      NOMINATIM_CONFIG.cache.set(query.toLowerCase(), {
        data: data,
        timestamp: Date.now()
      });

      resolve(data);

    } catch (error) {
      console.error('[Search] Nominatim 請求失敗:', error);
      reject(error);
    } finally {
      // 等待 rate limit 時間後處理下一個請求
      setTimeout(() => {
        NOMINATIM_CONFIG.isProcessing = false;
        processNominatimQueue();
      }, NOMINATIM_CONFIG.rateLimitMs);
    }
  }

  // 搜尋 Nominatim（包含繁簡轉換）
  async function searchNominatim(query) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    try {
      // 同時搜尋繁體和簡體
      const queries = [
        query,
        traditional2Simplified(query)
      ].filter((q, i, arr) => arr.indexOf(q) === i); // 去重

      // 並行搜尋所有變體（但會被 rate limit 序列化）
      const results = await Promise.all(
        queries.map(q => nominatimRequest(q).catch(() => []))
      );

      // 合併並去重結果
      const allResults = results.flat();
      const uniqueResults = [];
      const seen = new Set();

      for (const result of allResults) {
        const key = `${result.lat},${result.lon}`;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueResults.push({
            displayName: result.display_name,
            name: result.name || result.display_name.split(',')[0],
            lat: parseFloat(result.lat),
            lng: parseFloat(result.lon),
            type: result.type,
            source: 'nominatim',
            importance: result.importance || 0
          });
        }
      }

      return uniqueResults;

    } catch (error) {
      console.error('[Search] Nominatim 搜尋錯誤:', error);
      return [];
    }
  }

  // ==========================================================
  // 模糊搜尋（本地 GeoJSON）
  // ==========================================================

  // 模糊搜尋：檢查是否包含（忽略大小寫、繁簡通配）
  function fuzzyMatch(text, query) {
    if (!text || !query) return false;

    // 將文本和查詢都轉成簡體小寫
    const normalizedText = traditional2Simplified(text.toString().toLowerCase());
    const normalizedQuery = traditional2Simplified(query.toString().toLowerCase());

    return normalizedText.includes(normalizedQuery);
  }

  // 搜尋 GeoJSON features
  function searchFeatures(features, query, options = {}) {
    const {
      searchFields = ['名稱', '說明', 'layer'],
      maxResults = 50,
      minQueryLength = 1
    } = options;

    if (!query || query.trim().length < minQueryLength) {
      return [];
    }

    const trimmedQuery = query.trim();
    const results = [];

    for (let feature of features) {
      if (!feature.properties) continue;

      let matched = false;
      let matchedField = '';
      let matchScore = 0;

      // 檢查各個字段
      for (let field of searchFields) {
        const fieldValue = feature.properties[field];
        if (!fieldValue) continue;

        if (fuzzyMatch(fieldValue, trimmedQuery)) {
          matched = true;
          matchedField = field;

          // 計算匹配分數（用於排序）
          const normalizedField = traditional2Simplified(fieldValue.toString().toLowerCase());
          const normalizedQuery = traditional2Simplified(trimmedQuery.toLowerCase());

          // 精確匹配得高分
          if (normalizedField === normalizedQuery) {
            matchScore = 100;
          } else if (normalizedField.startsWith(normalizedQuery)) {
            matchScore = 80;
          } else {
            matchScore = 50;
          }

          break;
        }
      }

      if (matched) {
        results.push({
          feature: feature,
          matchedField: matchedField,
          matchScore: matchScore,
          displayName: feature.properties['名稱'] || feature.properties.name || '未命名',
          layer: feature.properties.layer || '未分類',
          coordinates: feature.geometry.coordinates,
          source: 'local'
        });
      }

      // 限制結果數量
      if (results.length >= maxResults) break;
    }

    // 按分數排序
    results.sort((a, b) => b.matchScore - a.matchScore);

    return results;
  }

  // 混合搜尋：本地 GeoJSON + Nominatim API
  async function searchCombined(features, query, options = {}) {
    const {
      includeNominatim = true,
      maxResults = 50,
      nominatimMaxResults = 5
    } = options;

    // 1. 先搜尋本地 GeoJSON（即時）
    const localResults = searchFeatures(features, query, options);

    // 2. 如果本地結果少於 5 個，且查詢長度 >= 3，則搜尋 Nominatim
    if (includeNominatim && localResults.length < 5 && query.trim().length >= 3) {
      try {
        const nominatimResults = await searchNominatim(query);

        // 轉換 Nominatim 結果格式
        const formattedNominatim = nominatimResults.slice(0, nominatimMaxResults).map(result => ({
          displayName: result.displayName,
          name: result.name,
          layer: result.type || '地點',
          coordinates: [result.lng, result.lat],
          source: 'nominatim',
          matchScore: 40 + (result.importance * 10) // Nominatim 結果分數較低
        }));

        // 合併結果
        const combined = [...localResults, ...formattedNominatim];
        combined.sort((a, b) => b.matchScore - a.matchScore);

        return combined.slice(0, maxResults);

      } catch (error) {
        console.error('[Search] Nominatim 搜尋錯誤:', error);
        return localResults;
      }
    }

    return localResults;
  }

  // 高亮匹配文本
  function highlightMatch(text, query) {
    if (!text || !query) return text;

    const normalizedText = traditional2Simplified(text.toString());
    const normalizedQuery = traditional2Simplified(query.toString().toLowerCase());

    // 找到匹配位置
    const lowerText = normalizedText.toLowerCase();
    const index = lowerText.indexOf(normalizedQuery);

    if (index === -1) return text;

    // 返回高亮HTML
    const before = text.substring(0, index);
    const match = text.substring(index, index + query.length);
    const after = text.substring(index + query.length);

    return `${before}<mark class="search-highlight">${match}</mark>${after}`;
  }

  // ==========================================================
  // 初始化和導出
  // ==========================================================

  // 頁面載入時初始化 OpenCC
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOpenCC);
  } else {
    initOpenCC();
  }

  // 導出到全局
  window.searchUtils = {
    traditional2Simplified,
    simplified2Traditional,
    fuzzyMatch,
    searchFeatures,
    searchNominatim,
    searchCombined,
    highlightMatch,
    // 提供 OpenCC 狀態檢查
    isOpenCCReady: () => t2sConverter !== null
  };
})();
