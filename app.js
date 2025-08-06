(async function exportGeoJSON () {
    if (typeof _pageData === 'undefined') {
      return alert('Sorry, no map data found');
    }
  
    /* ---------- 1. 工具 ---------- */
    const STRIP_BIDI = /[\u200E\u200F\u202A-\u202E]/g;       // LRM/RLM 及 Bidi 控制碼
    const stripHtml  = true;                                // 若要保留 <br> 等標籤，設 false
  
    const cleanText = txt => {
      if (typeof txt !== 'string') return txt;
      let s = txt.replace(STRIP_BIDI, '');
      if (stripHtml) s = s.replace(/<[^>]+>/g, '');         // 很陽春的去標籤
      return s.trim();
    };
  
    /* ---------- 2. 解析 _pageData ---------- */
    const parsed   = JSON.parse(_pageData);
    const layers   = parsed?.[1]?.[6] || [];
    const features = [];
  
    layers.forEach(layer => {
      const shapes = layer?.[12]?.[0]?.[13]?.[0] || [];
  
      shapes.forEach(shp => {
        const c = shp?.[1]?.[0]?.[0];                       // [lat,lng]
        if (!c) return;
  
        const f = {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [c[1], c[0]] },
          properties: {}
        };
  
        /* 2-1 逐欄掃描 metadata → properties */
        (shp?.[5] || []).forEach(entry => {
          // 形態 A：["欄名", ["值"]] ；形態 B：["欄名", "值"]
          if (Array.isArray(entry) && typeof entry[0] === 'string') {
            const key = cleanText(entry[0]);
            const val = cleanText(Array.isArray(entry[1]) ? entry[1][0] : entry[1]);
            if (key) f.properties[key] = val;
          }
        });
  
        /* 2-2 如有多圖層 → 帶上 layer 名稱 */
        if (layers.length > 1 && layer?.[2]) {
          f.properties.layer = cleanText(layer[2]);
        }
  
        features.push(f);
      });
    });
  
    const geojsonStr = JSON.stringify(
      { type: 'FeatureCollection', features },
      null,
      2                              // pretty print；不想縮排就移除這個參數
    );
  
    /* ---------- 3. 先嘗試寫入剪貼簿 ---------- */
    try {
      await navigator.clipboard.writeText(geojsonStr);
      alert(`✅ 已複製 ${features.length} 筆資料（含「說明」等欄位）到剪貼簿。\n直接貼到檔案並存成 .geojson！`);
      return;
    } catch (err) {
      console.info('Clipboard API 失敗，改用下載方式…', err);
    }
  
    /* ---------- 4. 後備：about:blank 分頁自動下載 ---------- */
    const blob = new Blob([geojsonStr], { type: 'application/geo+json' });
    const url  = URL.createObjectURL(blob);
  
    const win  = window.open('about:blank');
    win.document.write(
      `<html><body>
         <a id="dl" href="${url}" download="export.geojson">download</a>
         <script>document.getElementById('dl').click();<\/script>
       </body></html>`
    );
    setTimeout(() => { win.close(); URL.revokeObjectURL(url); }, 2000);
  
    console.log(`✅ 已匯出 ${features.length} features → export.geojson（已含「說明」等欄位）`);
  })();
  