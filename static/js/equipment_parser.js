// 裝備解析器 - 從文本中抓取裝備資訊並查詢維基百科
class EquipmentParser {
  constructor() {
    // 設計魯棒的正則表達式來匹配不同格式的裝備描述
    this.equipmentRegex = /裝備[：:]\s*([^。\n]*?)(?:\s+戰術編號|\s+https?:\/\/|\n|$)/g;
    
    // 用來分割多個裝備的正則表達式
    this.equipmentSeparatorRegex = /[、，,\/]/g;
    
    // 清理裝備名稱的正則表達式
    this.cleanupRegex = /[\s\u3000]+/g; // 移除多餘空白和全形空白
    
    // 快取機制
    this.cache = new Map();
    this.cacheExpiry = 30 * 60 * 1000; // 30分鐘快取
    
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

  // 檢查快取
  getCachedResult(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      return cached.data;
    }
    return null;
  }

  // 設置快取
  setCachedResult(key, data) {
    this.cache.set(key, {
      data: data,
      timestamp: Date.now()
    });
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
      
      // 嘗試不同的API端點
      for (const url of proxyUrls) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), this.requestTimeout);
          
          response = await fetch(url, {
            signal: controller.signal,
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'EquipmentParser/1.0'
            }
          });
          
          clearTimeout(timeoutId);
          
          if (response.ok) {
            data = await response.json();
            break;
          }
          // 若為 404，代表可訪問但無該條目 → 回傳 null（不作為端點失效）
          if (response.status === 404) {
            return null;
          }
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
      console.error(`查詢維基百科時發生錯誤: ${nameForApi}`, error);
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
        console.error('批次處理裝備資訊時發生錯誤:', error);
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
          <div class="equipment-loading" style="
            text-align: center; 
            padding: 20px; 
            color: #666;
            font-size: ${isMobile ? '11px' : '13px'};
            line-height: 1.4;
          ">
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
            ' <small style="color: #4ade80;">✓ 離線資料</small>' : 
            ' <small style="color: #4ade80;">✓ 基本資訊</small>';
        } else {
          fallbackLabel = this.isMobileDevice() ? 
            ' <small style="color: #f87171;">⚠ 網路問題</small>' : 
            ' <small style="color: #888;">(離線模式)</small>';
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
          ${equipment.description ? `<p style="${equipment.fallback ? 'color: #666; font-size: 12px;' : ''}">${equipment.description}</p>` : ''}
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
      // 桌面版：建立模態視窗
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.8);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
        cursor: pointer;
      `;
      
      const img = document.createElement('img');
      img.src = imageUrl;
      img.alt = title;
      img.style.cssText = `
        max-width: 90%;
        max-height: 90%;
        object-fit: contain;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      `;
      
      modal.appendChild(img);
      document.body.appendChild(modal);
      
      // 點擊關閉
      modal.addEventListener('click', () => {
        document.body.removeChild(modal);
      });
      
      // ESC 鍵關閉
      const escHandler = (e) => {
        if (e.key === 'Escape') {
          document.body.removeChild(modal);
          document.removeEventListener('keydown', escHandler);
        }
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
