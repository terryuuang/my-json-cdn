// ==========================================================
// url_params.js - URL 參數讀寫（查詢字串 ? 與 hash # 等價）
// ==========================================================
// 設計原則：
// 1. 讀取一律經過 read()：以查詢字串為底，hash 逐鍵整組覆蓋。
//    因此 `#shape=circle&lat=25&lng=120` 與同內容的 `?` 完全等效。
// 2. 「逐鍵整組覆蓋」而非逐值覆蓋，是為了保住 getAll() 語意 ——
//    shape 模式的 circle=/poly=/sector= 是可重複參數，parseShapeParams() 靠 getAll() 取值。
// 3. 寫回時參數必須回到它來的那一側。從 hash 來的鍵若寫進查詢字串，
//    會因為「hash 覆蓋查詢字串」而靜默無效（調色寫回就會踩到）。
// 4. commit() 對 hash 做「片段層級」的外科手術，沒被動過的片段保留原始文字，
//    絕不用 toString() 重建整段 hash —— #ais= 的 payload 可達數萬字元，
//    重新編碼等於破壞既有連結（見 ais_snapshot.js 的 MAX_HASH_LENGTH）。
// 5. 任何解析失敗都退回空參數而非丟出例外，外部系統亂帶 hash 不該讓地圖壞掉。
//
// 注意：本模組必須是第一支載入的 app script。shape_color.js 在 module top-level
// 就會呼叫 read() 建立初始快照。
// ==========================================================
(function () {
  // 純粹的理智檢查上限。不截斷資料（截斷會從中間切斷片段而產生假值），
  // 只在遇到荒謬長度時整段放棄解析。
  const MAX_HASH_LENGTH = 200000;

  function rawHash() {
    return String(window.location.hash || '').replace(/^#/, '');
  }

  // hash 是否為參數形狀。沒有 '=' 就是單純錨點（#top、#ais），不該被當成參數解析。
  function isParamShapedHash(raw) {
    return !!raw && raw.includes('=') && raw.length <= MAX_HASH_LENGTH;
  }

  // hash 的有序原始片段：[{ key, raw }]，raw 保留未解碼的原文
  function rawHashSegments() {
    const raw = rawHash();
    if (!isParamShapedHash(raw)) return [];
    return raw.split('&').filter(Boolean).map(segment => {
      const eq = segment.indexOf('=');
      const rawKey = eq === -1 ? segment : segment.slice(0, eq);
      return { key: decodeComponent(rawKey), raw: segment };
    });
  }

  function decodeComponent(value) {
    try {
      return decodeURIComponent(String(value).replace(/\+/g, '%20'));
    } catch (_) {
      return String(value);
    }
  }

  // 單一 key/value 序列化成片段，編碼慣例與 URLSearchParams 一致（空白為 '+'），
  // 與 ais_snapshot.js 的 decodeValue() 相同
  function encodePair(key, value) {
    return new URLSearchParams([[key, value]]).toString();
  }

  function query() {
    return new URLSearchParams(window.location.search);
  }

  function hash() {
    const raw = rawHash();
    if (!isParamShapedHash(raw)) return new URLSearchParams();
    try {
      return new URLSearchParams(raw);
    } catch (_) {
      return new URLSearchParams();
    }
  }

  // 合併：查詢字串為底，hash 逐鍵整組覆蓋
  function read() {
    const merged = query();
    const hashParams = hash();
    new Set(Array.from(hashParams.keys())).forEach(key => {
      merged.delete(key);
      hashParams.getAll(key).forEach(value => merged.append(key, value));
    });
    return merged;
  }

  // 某個鍵在 hash 裡的「原始未解碼」值。
  // ais= 這類自帶編碼慣例的 payload 必須拿原文：呼叫端會自行逐欄位解碼，
  // 若在這裡先解一次就會變成雙重解碼。位置無關，ais= 不必是第一個片段。
  function rawHashValue(key) {
    const target = String(key);
    const found = rawHashSegments().find(s => s.key === target);
    if (!found) return '';
    const eq = found.raw.indexOf('=');
    return eq === -1 ? '' : found.raw.slice(eq + 1);
  }

  // hash 是否帶某個鍵。也涵蓋「整段 hash 就是這個鍵」的純錨點寫法（#ais）。
  function hashHas(key) {
    if (hash().has(key)) return true;
    return rawHash().toLowerCase() === String(key).toLowerCase();
  }

  function sourceOf(key) {
    if (hash().has(key)) return 'hash';
    if (query().has(key)) return 'query';
    return null;
  }

  function sameValues(a, b) {
    return a.length === b.length && a.every((value, i) => value === b[i]);
  }

  // 依「參數原本來自哪一側」把 merged 拆回 hash 片段與查詢字串。
  //
  // 查詢字串上被 hash 遮蔽的值一律原封不動留著：它在讀取時永遠輸不過 hash，所以留著無害，
  // 而刪掉會把作者原始連結裡的資料弄丟（使用者只是調了顏色，不該順手清掉 ?radius=50）。
  // 只有在某個鍵被整個移除時，兩側才一起清。
  function splitBySource(merged, options = {}) {
    const newKeysToHash = options.newKeysTo === 'hash' && isParamShapedHash(rawHash());
    const segments = rawHashSegments();
    const hashKeys = new Set(segments.map(s => s.key));
    const hashParams = hash();
    const queryParams = query();
    const nextSegments = [];
    const emitted = new Set();

    // 一、hash 側：逐鍵決定丟棄／保留原文／重新序列化
    segments.forEach(segment => {
      const key = segment.key;
      const mergedValues = merged.getAll(key);

      if (!mergedValues.length) {
        // 被刪除：hash 與查詢字串都要清掉，否則查詢字串上的舊值會浮出來
        queryParams.delete(key);
        return;
      }
      if (emitted.has(key)) return;   // 同鍵的其餘片段已在首次出現處一併處理
      emitted.add(key);

      if (sameValues(mergedValues, hashParams.getAll(key))) {
        // 沒動過：保留原始文字，避免重新編碼
        segments.filter(s => s.key === key).forEach(s => nextSegments.push(s.raw));
      } else {
        mergedValues.forEach(value => nextSegments.push(encodePair(key, value)));
      }
    });

    // 二、查詢字串側：只處理不屬於 hash 的鍵
    new Set(Array.from(queryParams.keys())).forEach(key => {
      if (hashKeys.has(key)) return;
      if (!merged.has(key)) queryParams.delete(key);
    });
    new Set(Array.from(merged.keys())).forEach(key => {
      if (hashKeys.has(key)) return;
      const values = merged.getAll(key);
      if (sameValues(values, queryParams.getAll(key))) return;

      // newKeysTo:'hash' 讓全新的鍵跟著它的同伴留在 hash。呼叫端在「這組參數本來就在
      // hash 裡」時才會傳（例如 # 來源的圖形被調色，新的 circle_color= 不該跑去 ?）。
      if (newKeysToHash && !queryParams.has(key)) {
        values.forEach(value => nextSegments.push(encodePair(key, value)));
        return;
      }
      queryParams.delete(key);
      values.forEach(value => queryParams.append(key, value));
    });

    let nextHash = nextSegments.join('&');
    // hash 不是參數形狀（純錨點）時原封不動保留
    if (!hashKeys.size) nextHash = rawHash();

    return { hashString: nextHash, queryString: queryParams.toString() };
  }

  function buildUrl(merged, options = {}) {
    const params = merged instanceof URLSearchParams ? merged : new URLSearchParams(merged || '');
    const { hashString, queryString } = splitBySource(params, options);
    return `${window.location.origin}${window.location.pathname}`
      + (queryString ? `?${queryString}` : '')
      + (hashString ? `#${hashString}` : '');
  }

  function commit(merged, options = {}) {
    try {
      const next = buildUrl(merged, options);
      if (options.mode === 'push') {
        window.history.pushState(window.history.state, '', next);
      } else {
        window.history.replaceState(window.history.state, '', next);
      }
      return next;
    } catch (error) {
      console.warn('[UrlParams] 無法更新網址列:', error);
      return window.location.href;
    }
  }

  window.UrlParams = { read, query, hash, rawHashValue, hashHas, sourceOf, buildUrl, commit };
})();
