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
    this.maxEquipmentItems = 5; // 最多處理5個裝備項目
    this.requestTimeout = this.isMobileDevice() ? 15000 : 8000; // 手機版15秒，桌面版8秒請求超時
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
        // 移除尾隨的非字母數字字符（如空格、符號等）
        cleanName = cleanName.replace(/[^\w\-\u4e00-\u9fff]+$/, '');
        if (cleanName && cleanName.length > 1) {
          equipmentNames.add(cleanName);
        }
      });
    }

    // 限制處理的裝備數量以優化效能
    const result = Array.from(equipmentNames);
    if (result.length > this.maxEquipmentItems) {
      console.log(`裝備數量超過限制，僅處理前${this.maxEquipmentItems}個項目`);
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
    // 檢查快取
    const cached = this.getCachedResult(weaponName);
    if (cached) {
      return cached;
    }

    try {
      // 使用CORS代理服務來避免跨域問題，手機版優先使用更可靠的代理
      const proxyUrls = this.isMobileDevice() ? [
        `https://api.allorigins.win/get?url=${encodeURIComponent(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`)}`,
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`,
        `https://cors-anywhere.herokuapp.com/https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`
      ] : [
        `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`,
        `https://api.allorigins.win/get?url=${encodeURIComponent(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`)}`,
        `https://cors-anywhere.herokuapp.com/https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(weaponName)}`
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
            
            // 如果使用了代理服務，需要解析包裝的數據
            if (url.includes('allorigins.win')) {
              data = JSON.parse(data.contents);
            }
            
            break;
          }
        } catch (error) {
          console.log(`嘗試API端點失敗: ${url}`, error.message);
          
          // 手機版提供更詳細的錯誤信息
          if (this.isMobileDevice()) {
            console.log(`手機版API請求詳情:`, {
              weaponName,
              url,
              error: error.name,
              message: error.message,
              userAgent: navigator.userAgent
            });
          }
          
          continue;
        }
      }
      
      if (!data) {
        console.log(`所有API端點都失敗: ${weaponName}`);
        
        // 提供fallback資訊，至少顯示裝備名稱
        return {
          name: weaponName,
          title: weaponName,
          description: '網路連線問題，無法載入詳細資訊',
          thumbnail: null,
          wikipediaUrl: null,
          fallback: true
        };
      }
      
      // 檢查是否有錯誤狀態
      if (data.status === 404 || data.type === 'Internal error') {
        console.log(`維基百科無此條目: ${weaponName}`);
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
      this.setCachedResult(weaponName, result);
      
      return result;
      
    } catch (error) {
      console.error(`查詢維基百科時發生錯誤: ${weaponName}`, error);
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
    
    console.log('找到的裝備:', equipmentNames);
    
    // 限制並行請求數量以避免過載
    const batchSize = 3;
    const results = [];
    
    for (let i = 0; i < equipmentNames.length; i += batchSize) {
      const batch = equipmentNames.slice(i, i + batchSize);
      const promises = batch.map(name => this.fetchWeaponInfo(name));
      
      try {
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
      } catch (error) {
        console.error('批次處理裝備資訊時發生錯誤:', error);
        // 繼續處理下一批次
      }
      
      // 在批次之間添加短暫延遲以避免API限制
      if (i + batchSize < equipmentNames.length) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // 過濾掉無效的結果
    const validResults = results.filter(result => result !== null);
    
    if (validResults.length === 0) {
      console.log('未找到任何有效的裝備資訊');
    } else {
      console.log(`成功處理 ${validResults.length}/${equipmentNames.length} 個裝備項目`);
    }
    
    return validResults;
  }

  // 生成裝備資訊的HTML內容
  generateEquipmentHTML(equipmentData, isLoading = false) {
    if (isLoading) {
      const isMobile = this.isMobileDevice();
      const loadingText = isMobile ? '正在查詢資料...<br><small>手機版可能需要較長時間</small>' : '正在查詢維基百科資料...';
      
      return `
        <div class="equipment-info">
          <h4>裝備資訊</h4>
          <div class="equipment-loading" style="
            text-align: center; 
            padding: 20px; 
            color: #666;
            font-size: ${isMobile ? '12px' : '13px'};
          ">
            <div style="margin-bottom: 8px;">🔍</div>
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
      html += `
        <div class="${itemClass}">
          <h5>
            ${equipment.wikipediaUrl ? 
              `<a href="${equipment.wikipediaUrl}" target="_blank" rel="noopener noreferrer">${equipment.title}</a>` : 
              equipment.title
            }
            ${equipment.fallback ? ' <small style="color: #888;">(離線模式)</small>' : ''}
          </h5>
          ${equipment.description ? `<p style="${equipment.fallback ? 'color: #888; font-style: italic;' : ''}">${equipment.description}</p>` : ''}
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
    return `
      <div class="equipment-images">
        <img src="${equipment.thumbnail}" 
             alt="${equipment.title}" 
             onclick="window.equipmentParser.openFullImage('${imageUrl}', '${equipment.title}')"
             title="點擊查看原圖"
             loading="lazy"
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
  
  console.log('=== 裝備解析器測試 ===');
  
  for (const text of testTexts) {
    console.log(`\n測試文本: "${text}"`);
    const equipmentData = await parser.processEquipmentText(text);
    console.log('結果:', equipmentData);
    
    if (equipmentData.length > 0) {
      console.log('生成的HTML:', parser.generateEquipmentHTML(equipmentData));
    }
  }
}

// 如果要在瀏覽器中使用，可以將parser實例掛到window上
if (typeof window !== 'undefined') {
  window.equipmentParser = new EquipmentParser();
}

// 如果要在Node.js環境測試，可以取消註解下面這行
// testEquipmentParser();