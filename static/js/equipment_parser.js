// 裝備解析器 - 從文本中抓取裝備資訊並查詢維基百科
class EquipmentParser {
  constructor() {
    // 設計魯棒的正則表達式來匹配不同格式的裝備描述
    this.equipmentRegex = /裝備[：:]\s*([^。\n]*?)(?:\s+戰術編號|\s+https?:\/\/|\n|$)/g;
    
    // 用來分割多個裝備的正則表達式
    this.equipmentSeparatorRegex = /[、，,\/]/g;
    
    // 清理裝備名稱的正則表達式
    this.cleanupRegex = /[\s\u3000]+/g; // 移除多餘空白和全形空白
    
    // 快取機制：記憶體 Map 為第一層（同一頁面內最快），並寫入 localStorage 做第二層，
    // 讓快取能跨頁面重新整理存活，減少重複的 Wikipedia 請求
    this.cache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30分鐘快取
    this.storagePrefix = 'equipmentCache:';
    
    // 效能限制
    this.maxEquipmentItems = this.isMobileDevice() ? 3 : 5; // 手機版最多3個，桌面版5個裝備項目
    this.requestTimeout = this.isMobileDevice() ? 8000 : 5000; // 優化：手機版8秒，桌面版5秒請求超時
    
    // 基本設備資料庫（作為fallback）
    this.basicEquipmentDB = {
      'J-16': { type: '多用途戰鬥機', country: '中國' },
      'Su-35S': { type: '多用途戰鬥機', country: '俄羅斯' },
      'J-20': { type: '第五代隱身戰鬥機', country: '中國' },
      'F-16': { type: '多用途戰鬥機', country: '美國' },
      'F-35': { type: '第五代多用途戰鬥機', country: '美國' },
      'J-10': { type: '輕型多用途戰鬥機', country: '中國' },
      'Su-30': { type: '雙座多用途戰鬥機', country: '俄羅斯' },
      'H-6': { type: '戰略轟炸機', country: '中國' },
      'Y-20': { type: '大型運輸機', country: '中國' },
      'KJ-500': { type: '預警機', country: '中國' }
    };
  }

  // 用 MediaWiki 搜尋 API 找出最接近的條目標題（CORS 開放，免金鑰）。
  // 用於補救「名稱跟維基百科實際標題有落差」的情況（例如 SENTINEL-6A 的實際標題是
  // 「Sentinel-6 Michael Freilich」、BOEING 787-9 Dreamliner 的實際標題是「Boeing 787 Dreamliner」），
  // 讓衛星/機型這類非固定格式名稱也能查到摘要，而不是直接判定「查無資料」。
  // lang 參數供動態島搜尋的通用百科查詢（fetchGenericSummary）重用，預設仍為英文維基（武器查詢原用法）。
  async searchWikipediaTitle(query, lang = 'en') {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=1`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!response.ok) return null;
      const data = await response.json();
      return data?.query?.search?.[0]?.title || null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 用 MediaWiki 的「重新導向」機制找同義詞/別名的正確條目標題（CORS 開放，免金鑰）。
  // 這是維基百科官方定義的別名對照表（例如「HQ-9」重定向到實際條目），比全文搜尋更精準、
  // 也更快；優先於 searchWikipediaTitle 的全文搜尋使用，找不到重定向才退回全文搜尋。
  async resolveWikipediaRedirect(query, lang = 'en') {
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(query)}&redirects=1&format=json&origin=*`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!response.ok) return null;
      const data = await response.json();
      const pages = data?.query?.pages || {};
      const page = Object.values(pages)[0];
      if (page && !('missing' in page) && page.title) return page.title;
      return null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 從文字中找出已經內嵌的維基百科連結（例如 GeoJSON 說明欄位裡的參考連結），
  // 直接用連結本身的標題查摘要——不需要再搜尋比對，因為連結本身就是最精準的來源
  extractWikipediaLinksFromText(text) {
    if (!text) return [];
    const regex = /https?:\/\/([a-z]{2,3})\.wikipedia\.org\/wiki\/([^\s<>"'）)\]]+)/gi;
    const results = [];
    const seen = new Set();
    let match;
    while ((match = regex.exec(text)) !== null) {
      const lang = match[1].toLowerCase();
      let title = match[2];
      try { title = decodeURIComponent(title); } catch (_) { /* 保留原始字串 */ }
      title = title.replace(/_/g, ' ').replace(/#.*$/, '');
      const key = `${lang}:${title}`;
      if (seen.has(key) || !title) continue;
      seen.add(key);
      results.push({ lang, title });
    }
    return results.slice(0, 2); // 最多顯示 2 則，避免內容過長
  }

  // 依語言別+標題直接查摘要（標題來自已存在的維基百科連結，保證有效，不需要同義詞比對）
  async fetchPageSummaryByLangTitle(lang, title) {
    const cacheKey = `wikilink:${lang}:${title}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
    try {
      const response = await fetch(
        `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
        { signal: controller.signal, headers: { 'Accept': 'application/json' } }
      );
      if (!response.ok) return null;
      const data = await response.json();
      if (data.type === 'Internal error') return null;
      const result = {
        title: data.title || title,
        description: this.truncateDescription(data.description || data.extract),
        thumbnail: data.thumbnail?.source || null,
        wikipediaUrl: data.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
        // 消歧義頁（例如查詢過於籠統，同名條目不只一個）沒有實際摘要可用，
        // type 讓呼叫方（fetchGenericSummary）決定要不要改抓候選條目清單
        type: data.type || null
      };
      // 消歧義頁本身不快取為「正常結果」，避免之後誤用它的（無意義）description/thumbnail
      if (result.type !== 'disambiguation') this.setCachedResult(cacheKey, result);
      return result;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 消歧義頁的候選條目：抓該頁面內連往其他條目（namespace 0）的前 N 個連結，
  // 供動態島搜尋直接列出候選讓使用者自己挑，比起「盲猜第一個」更不會選錯。
  // 消歧義頁列出的連結常混有「紅字連結」（條目實際不存在/已刪除，點進去只會 404）
  // 或本身又連到另一個消歧義頁（點進去摘要沒意義），兩者都不該被當成候選，
  // 所以抓多一點原始連結後，用第二次查詢確認哪些是「真的有摘要可看的條目」再篩前 limit 個
  async fetchDisambiguationCandidates(lang, title, limit = 3) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
    try {
      const linksUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&prop=links&titles=${encodeURIComponent(title)}&plnamespace=0&pllimit=20&format=json&origin=*`;
      const linksResp = await fetch(linksUrl, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!linksResp.ok) return [];
      const linksData = await linksResp.json();
      const linkPage = Object.values(linksData?.query?.pages || {})[0];
      const rawTitles = (linkPage?.links || [])
        .map(l => l.title)
        .filter(t => t && !/(消歧義|disambiguation)/i.test(t));
      if (rawTitles.length === 0) return [];

      const checkUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${rawTitles.map(t => encodeURIComponent(t)).join('|')}&prop=pageprops&format=json&origin=*`;
      const checkResp = await fetch(checkUrl, { signal: controller.signal, headers: { 'Accept': 'application/json' } });
      if (!checkResp.ok) return [];
      const checkData = await checkResp.json();
      const validTitles = new Set(
        Object.values(checkData?.query?.pages || {})
          .filter(p => !('missing' in p) && !(p.pageprops && 'disambiguation' in p.pageprops))
          .map(p => p.title)
      );

      return rawTitles
        .filter(t => validTitles.has(t))
        .slice(0, limit)
        .map(t => ({
          title: t,
          wikipediaUrl: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`
        }));
    } catch (_) {
      return [];
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // 通用（非武器專用）維基百科摘要查詢：給動態島搜尋的專有名詞/百科結果使用。
  // 跟 fetchWeaponInfo 不同之處：不做武器型號名稱正規化（紅旗/鷹擊轉英文代碼等），
  // 單純把使用者輸入的查詢字串（例如地名、單位名、人名）直接拿去解析維基百科條目，
  // 預設查中文維基（zh.wikipedia.org），找不到重定向就退回全文搜尋找最接近的條目。
  // 查到消歧義頁時不盲猜，改回傳前 3 個候選條目讓使用者自己選（見 fetchDisambiguationCandidates）。
  async fetchGenericSummary(query, lang = 'zh') {
    const trimmed = (query || '').trim();
    if (!trimmed) return null;

    const cacheKey = `generic:${lang}:${trimmed}`;
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    try {
      let title = await this.resolveWikipediaRedirect(trimmed, lang);
      if (!title) title = await this.searchWikipediaTitle(trimmed, lang);
      if (!title) return null;

      const summary = await this.fetchPageSummaryByLangTitle(lang, title);
      if (!summary) return null;

      let result = summary;
      if (summary.type === 'disambiguation') {
        const candidates = await this.fetchDisambiguationCandidates(lang, title, 3);
        if (candidates.length === 0) return null;
        result = { disambiguation: true, query: trimmed, pageTitle: title, candidates };
      }

      this.setCachedResult(cacheKey, result);
      return result;
    } catch (_) {
      return null;
    }
  }

  // 檢測是否為手機設備
  isMobileDevice() {
    return window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  }

  // 從文本中抓取裝備名稱
  extractEquipmentNames(text) {
    const equipmentNames = new Set(); // 使用Set避免重複
    let match;

    // 使用正則表達式找到所有裝備描述
    while ((match = this.equipmentRegex.exec(text)) !== null) {
      const equipmentText = match[1].trim();
      
      // 分割多個裝備名稱
      const names = equipmentText.split(this.equipmentSeparatorRegex);
      
      names.forEach(name => {
        let cleanName = name.trim().replace(this.cleanupRegex, ' ').trim();
        // 進一步清理：去除括號註解與後綴描述（避免帶入地名或補充說明）
        // 1) 去除中文/西文括號之註記
        cleanName = cleanName.replace(/[（(].*$/, '');
        // 2) 若包含空白，且第一段為裝備型號（英數/連字號），只取第一段
        if (cleanName.includes(' ')) {
          const firstToken = cleanName.split(' ')[0];
          if (/^[A-Za-z0-9\-]+$/.test(firstToken)) {
            cleanName = firstToken;
          }
        }
        // 3) 只保留前綴之主要型號（中文型號或英數連字號），移除尾隨文字
        const mainMatch = cleanName.match(/^([A-Za-z][\w\-]*|[\u4e00-\u9fff]+-?[\w]*)/);
        if (mainMatch) cleanName = mainMatch[1];
        // 4) 最終修剪尾端非字元
        cleanName = cleanName.replace(/[^\w\-\u4e00-\u9fff]+$/, '');

        // 特例修正：YJ-12B → YJ-12（Wikipedia 無子型條目）
        cleanName = cleanName.replace(/\bYJ-12B\b/gi, 'YJ-12');

        if (cleanName && cleanName.length > 1) {
          equipmentNames.add(cleanName);
        }
      });
    }

    // 限制處理的裝備數量以優化效能
    const result = Array.from(equipmentNames);
    if (result.length > this.maxEquipmentItems) {
      // 限制處理項目數量以兼顧效能
      return result.slice(0, this.maxEquipmentItems);
    }
    
    return result;
  }

  // 檢查快取（先查記憶體，未命中再查 localStorage）
  getCachedResult(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    try {
      const raw = localStorage.getItem(this.storagePrefix + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Date.now() - parsed.timestamp < this.cacheExpiry) {
          this.cache.set(key, parsed);
          return parsed.data;
        }
        localStorage.removeItem(this.storagePrefix + key);
      }
    } catch (_) {
      // localStorage 不可用（例如私密瀏覽模式）或資料損毀，退回僅記憶體快取
    }
    return null;
  }

  // 設置快取（同時寫入記憶體與 localStorage）
  setCachedResult(key, data) {
    const entry = { data, timestamp: Date.now() };
    this.cache.set(key, entry);
    try {
      localStorage.setItem(this.storagePrefix + key, JSON.stringify(entry));
    } catch (_) {
      // 儲存空間已滿或不可用時，仍保留記憶體快取供本次頁面使用
    }
  }

  // 查詢維基百科API獲取武器資訊
  async fetchWeaponInfo(weaponName) {
    // 名稱正規化（用於 API 查詢）：
    // - YJ-12B → YJ-12
    // - 紅旗-12/紅旗12 → HQ-12；紅旗-6D → HQ-6D
    // - 鷹擊-12/鷹擊12 → YJ-12
    const normalizeForApi = (name) => {
      let s = name.trim();
      s = s.replace(/\bYJ-12B\b/gi, 'YJ-12');
      s = s.replace(/^(紅旗|红旗)[-\s]?(\d+[A-Za-z]?)/i, (_, __, code) => `HQ-${code.toUpperCase()}`);
      s = s.replace(/^(鷹擊|鹰击)[-\s]?(\d+[A-Za-z]?)/i, (_, __, code) => `YJ-${code.toUpperCase()}`);
      // 東風/东风 → DF-<code>
      s = s.replace(/^(東風|东风)[-\s]?(\d+[A-Za-z]?)/i, (_, __, code) => `DF-${code.toUpperCase()}`);
      // 長劍/长剑 → CJ-<code>
      s = s.replace(/^(長劍|长剑)[-\s]?(\d+[A-Za-z]?)/i, (_, __, code) => `CJ-${code.toUpperCase()}`);
      return s;
    };

    const nameForApi = normalizeForApi(weaponName);

    // 檢查快取（以正規化後名稱作為 key）
    const cached = this.getCachedResult(nameForApi);
    if (cached) {
      return cached;
    }

    try {
      // 僅使用可跨域的維基百科 REST API，移除不穩定/403/404 的代理服務
      // 注意：若請求 404，視為「可訪問但無結果」，不視為端點無效
      const proxyUrls = [
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(nameForApi)}`
      ];
      
      let response = null;
      let data = null;
      
      // 嘗試不同的API端點（若遇到 429/502/503/504 這類暫時性錯誤，短暫等待後重試一次，
      // 避免單次流量高峰或短暫限流就整個查詢失敗）
      for (const url of proxyUrls) {
        try {
          let attempt = 0;
          while (attempt < 2) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);

            response = await fetch(url, {
              signal: controller.signal,
              headers: { 'Accept': 'application/json' }
            });

            clearTimeout(timeoutId);

            if (response.ok) {
              data = await response.json();
              break;
            }
            // 若為 404，先試「重定向」解析同義詞/別名的正確標題（精準、快），
            // 找不到重定向再用全文搜尋找最接近的條目標題（較廣、較模糊）；
            // 補救名稱跟維基百科實際標題有落差的情況（例如型號含子版本後綴）；
            // 兩者都找不到才視為「可訪問但無結果」
            if (response.status === 404) {
              let resolvedTitle = await this.resolveWikipediaRedirect(nameForApi);
              if (!resolvedTitle || resolvedTitle === nameForApi) {
                resolvedTitle = await this.searchWikipediaTitle(nameForApi);
              }
              if (resolvedTitle && resolvedTitle !== nameForApi) {
                const retryController = new AbortController();
                const retryTimeoutId = setTimeout(() => retryController.abort(), this.requestTimeout);
                try {
                  const retryResponse = await fetch(
                    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(resolvedTitle)}`,
                    { signal: retryController.signal, headers: { 'Accept': 'application/json' } }
                  );
                  if (retryResponse.ok) {
                    data = await retryResponse.json();
                  }
                } catch (_) {
                  // 忽略，走到下面回傳 null
                } finally {
                  clearTimeout(retryTimeoutId);
                }
              }
              if (data) break;
              return null;
            }
            if ([429, 502, 503, 504].includes(response.status) && attempt === 0) {
              await new Promise(resolve => setTimeout(resolve, 700));
              attempt++;
              continue;
            }
            break;
          }
          if (data) break;
        } catch (error) {
          // 網路波動或暫時性失敗，改由後續端點或離線資料處理
          
          // 詳細的錯誤診斷信息
          const errorDetails = {
            weaponName,
            url,
            error: error.name,
            message: error.message,
            stack: error.stack,
            isMobile: this.isMobileDevice(),
            userAgent: navigator.userAgent,
            timestamp: new Date().toISOString(),
            isTimeout: error.name === 'AbortError',
            isCORS: error.message.includes('CORS') || error.message.includes('Network'),
            responseStatus: response ? response.status : 'No response'
          };
          
          // 儲存錯誤信息供調試使用
          if (!window.equipmentParserErrors) window.equipmentParserErrors = [];
          window.equipmentParserErrors.push(errorDetails);
          
          continue;
        }
      }
      
      if (!data) {
        
        // 檢查本地資料庫是否有這個裝備
        const localData = this.basicEquipmentDB[nameForApi] || this.basicEquipmentDB[weaponName];
        const isMobile = this.isMobileDevice();
        
        if (localData) {
          // 使用本地資料庫資訊
          return {
            name: weaponName,
            title: weaponName,
            description: `${localData.type} (${localData.country})${isMobile ? ' - 離線資料' : ' - 基本資訊'}`,
            thumbnail: null,
            wikipediaUrl: null,
            fallback: true,
            localData: true
          };
        } else {
          // 沒有本地資料，顯示錯誤說明
          const errorDescription = isMobile 
            ? '網路連線問題 (可能是CORS或IPv6相容性)，建議使用電腦瀏覽器'
            : '網路連線問題，無法載入詳細資訊';
          
          return {
            name: weaponName,
            title: weaponName,
            description: errorDescription,
            thumbnail: null,
            wikipediaUrl: null,
            fallback: true,
            localData: false
          };
        }
      }
      
      // 檢查是否有錯誤狀態
      if (data && (data.status === 404 || data.type === 'Internal error')) {
        return null;
      }
      
      // 返回有用的資訊
      const result = {
        name: weaponName,
        title: data.title,
        description: this.truncateDescription(data.description || data.extract),
        thumbnail: data.thumbnail?.source || null,
        originalImage: data.originalimage?.source || null,
        wikipediaUrl: data.content_urls?.desktop?.page || null
      };
      
      // 快取結果
      this.setCachedResult(nameForApi, result);
      
      return result;
      
    } catch (error) {
      console.error('[Equipment] 查詢維基百科失敗:', nameForApi, error);
      return null;
    }
  }

  // 截斷描述文字以優化顯示
  truncateDescription(text) {
    if (!text) return '';
    const maxLength = 150;
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength).trim() + '...';
  }

  // 主要功能：處理裝備文本並獲取圖片資訊
  async processEquipmentText(text) {
    const equipmentNames = this.extractEquipmentNames(text);
    
    if (equipmentNames.length === 0) {
      return [];
    }
    
    // 除錯訊息省略，保持 console 乾淨
    
    // 優化：限制並行請求數量，手機版更保守
    const batchSize = this.isMobileDevice() ? 2 : 3;
    const results = [];
    
    for (let i = 0; i < equipmentNames.length; i += batchSize) {
      const batch = equipmentNames.slice(i, i + batchSize);
      const promises = batch.map(name => this.fetchWeaponInfo(name));
      
      try {
        const batchResults = await Promise.allSettled(promises);
        // 只推入成功的結果
        batchResults.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            results.push(result.value);
          }
        });
      } catch (error) {
        console.error('[Equipment] 批次處理裝備資訊失敗:', error);
        // 繼續處理下一批次
      }
      
      // 優化：減少延遲時間
      if (i + batchSize < equipmentNames.length) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    // 過濾掉無效的結果
    const validResults = results.filter(result => result !== null);
    
    // 統計訊息省略，避免干擾
    
    return validResults;
  }

  // 生成裝備資訊的HTML內容
  generateEquipmentHTML(equipmentData, isLoading = false) {
    if (isLoading) {
      const isMobile = this.isMobileDevice();
      const loadingText = isMobile 
        ? '正在查詢資料...<br><small>若持續載入失敗，可能是IPv6網路問題<br>建議使用電腦瀏覽器訪問</small>' 
        : '正在查詢維基百科資料...';
      
      return `
        <div class="equipment-info">
          <h4>裝備資訊</h4>
          <div class="equipment-loading" style="font-size: ${isMobile ? '11px' : '13px'};">
            ${loadingText}
          </div>
        </div>
      `;
    }

    if (!equipmentData || equipmentData.length === 0) {
      return '';
    }

    let html = '<div class="equipment-info"><h4>裝備資訊</h4>';
    
    equipmentData.forEach(equipment => {
      const itemClass = equipment.fallback ? 'equipment-item equipment-fallback' : 'equipment-item';
      
      let fallbackLabel = '';
      if (equipment.fallback) {
        if (equipment.localData) {
          fallbackLabel = this.isMobileDevice() ?
            ' <small class="equipment-fallback-success">✓ 離線資料</small>' :
            ' <small class="equipment-fallback-success">✓ 基本資訊</small>';
        } else {
          fallbackLabel = this.isMobileDevice() ?
            ' <small class="equipment-fallback-warning">⚠ 網路問題</small>' :
            ' <small class="equipment-fallback-note">(離線模式)</small>';
        }
      }
      
      html += `
        <div class="${itemClass}">
          <h5>
            ${equipment.wikipediaUrl ? 
              `<a href="${equipment.wikipediaUrl}" target="_blank" rel="noopener noreferrer">${equipment.title}</a>` : 
              equipment.title
            }
            ${fallbackLabel}
          </h5>
          ${equipment.description ? `<p class="${equipment.fallback ? 'equipment-fallback-note' : ''}">${equipment.description}</p>` : ''}
          ${equipment.thumbnail ? this.generateImageHTML(equipment) : ''}
        </div>
      `;
    });
    
    html += '</div>';
    return html;
  }

  // 生成圖片HTML，處理多圖排版
  generateImageHTML(equipment) {
    const imageUrl = equipment.originalImage || equipment.thumbnail;
    const isMobile = this.isMobileDevice();
    
    return `
      <div class="equipment-images">
        <img src="${equipment.thumbnail}" 
             alt="${equipment.title}" 
             onclick="window.equipmentParser.openFullImage('${imageUrl}', '${equipment.title}')"
             title="點擊查看原圖"
             loading="lazy"
             style="max-width: ${isMobile ? '100px' : '160px'}; height: auto;"
             onerror="this.style.display='none'">
      </div>
    `;
  }

  // 開啟全尺寸圖片的方法
  openFullImage(imageUrl, title) {
    // 檢查是否為手機設備
    const isMobile = window.innerWidth <= 768;
    
    if (isMobile) {
      // 手機版：直接開啟新頁面
      window.open(imageUrl, '_blank');
    } else {
      // 桌面版：建立模態視窗（樣式統一由 .image-lightbox-* class 提供）
      const overlay = document.createElement('div');
      overlay.className = 'image-lightbox-overlay';

      const img = document.createElement('img');
      img.className = 'image-lightbox-img';
      img.src = imageUrl;
      img.alt = title;

      const closeBtn = document.createElement('button');
      closeBtn.className = 'image-lightbox-close';
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', '關閉');
      closeBtn.innerHTML = '&times;';

      overlay.appendChild(img);
      overlay.appendChild(closeBtn);
      document.body.appendChild(overlay);

      const close = () => {
        document.body.removeChild(overlay);
        document.removeEventListener('keydown', escHandler);
      };

      // 點擊背景或關閉按鈕關閉（點圖片本身不關閉）
      overlay.addEventListener('click', close);
      img.addEventListener('click', (e) => e.stopPropagation());

      // ESC 鍵關閉
      const escHandler = (e) => {
        if (e.key === 'Escape') close();
      };
      document.addEventListener('keydown', escHandler);
    }
  }
}

// 測試函數
async function testEquipmentParser() {
  const parser = new EquipmentParser();
  
  // 測試不同格式的裝備描述
  const testTexts = [
    "裝備: HQ-12",
    "裝備：HQ-12、HQ-12A",
    "裝備：HQ-12/HQ-12A",
    "這個單位的裝備：Type 96 Tank、HQ-12，還有其他武器。",
    "裝備: M1A2 Abrams、Apache AH-64、Patriot missile system"
  ];
  
  // 測試輸出省略
  
  for (const text of testTexts) {
    // console.log 測試輸出已移除
    const equipmentData = await parser.processEquipmentText(text);
    // console.log 測試輸出已移除
    
    if (equipmentData.length > 0) {
      // console.log 測試輸出已移除
    }
  }
}

// 如果要在瀏覽器中使用，可以將parser實例掛到window上
if (typeof window !== 'undefined') {
  window.equipmentParser = new EquipmentParser();
}

// 如果要在Node.js環境測試，可以取消註解下面這行
// testEquipmentParser();
