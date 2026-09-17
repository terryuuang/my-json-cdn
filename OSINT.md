# 圖臺情報（v0.6.8）

搜尋直接提供可在圖臺執行的動作：

- `東部戰區`（及其他個別戰區）：只顯示該戰區，`五大戰區`恢復全部。URL 的 `theater=東部戰區` / `theater=all` 保留顯示範圍；沿用本專案既有戰區 GeoJSON，並非最新官方邊界。
- `機場`：選取公共設施結果後，以目前畫面查詢 OpenStreetMap Overpass，最大範圍為地圖中心向四周約 200 公里，載入後縮放至結果。可再次選取以更新新視野；圖層選單原有座標／半徑查詢保留。
- `機艦繞臺` / `國防部`：在圖臺內顯示每日數量、7／30／90 日統計與官方當日示意圖。
- `試算表` / `PLATracker`：內嵌作者的公開線上試算表；網路或瀏覽器可能限制 iframe。
- `海象`：臺海北、中、南部、臺灣東部與巴士海峽五個固定模型參考點；點選點位閱讀浪高、浪向、週期與模型時間。

## 來源與限制

### 國防部日報

原站：<https://www.mnd.gov.tw/news/plaactlist>。

`scripts/update_mnd_activity.py` 僅擷取每篇公開日報的日期、數量、原文連結、示意圖連結。`data/mnd_activity.json` 是供前端讀取的公開 JSON 快照，不是國防部提供的即時定位 API。保留最近 90 筆；第一次納入多少天由實際下載的列表頁數決定。每日通報期間為前一日 06:00 至當日 06:00（臺灣時間）。

共機與共艦欄位必須能解析；只有原文明示「未偵獲共機／共艦」才記為 0。未提供的公務船、逾越中線／進入通報空域數量為 null。中線與通報空域是合併欄位，不能當成純越線架次；架次／艘次加總不是獨立機艦數。來源沒有座標，因此不推估航跡、海域位置或威脅指數。

`.github/workflows/update_osint.yml` 每日 UTC 01:23、05:23、09:23（臺灣 09:23、13:23、17:23）與手動觸發時更新，需 GitHub Actions 及 repository contents write 可用。解析或下載失敗時保留原快照且工作失敗，不把舊資料標示為最新；前端同時顯示最新通報日及檢查時間，超過兩日提示過期。部署更新後網站取得新快照。無須升級 app shell 才能更新資料。報告不加入 Service Worker 資料快取。

手動更新：`python3 scripts/update_mnd_activity.py --pages 4`。只使用 Python 標準函式庫。

### PLATracker

作者 Gerald C. Brown、Benjamin Lewis：<https://www.platracker.com/trackers>。

<https://www.platracker.com/data-sharing-policy> 規定下載／資料分享需另行申請。本站只嵌入公開閱覽頁，不下載、重新發布其資料，也不以其數據生成本站統計。統計取自上述國防部日報。

### Open-Meteo 海象

文件：<https://open-meteo.com/en/docs/marine-weather-api>。

前端直接呼叫公開 Marine API，查詢五個固定座標的 current wave_height、wave_direction、wave_period，以臺灣時間呈現。數據採 CC BY 4.0 標示來源。模型格點可能與所選座標不同，近岸解析度有限；這是環境背景資料，不是實測船位、軍事動態或航行指引。開啟／按更新時抓取，不做背景輪詢或離線快取。資料中缺值顯示「未提供」，全部缺值則顯示載入失敗。

## QA

執行 `python3 -m unittest discover -s tests -p 'test_mnd_activity.py'` 驗證日報解析與缺值規則。

瀏覽器檢查：單一／全部戰區切換與分享還原、移動地圖後搜尋機場（含重試與查無資料）、每日統計與來源圖片、歷史日期選取、試算表 iframe、海象點位新增／移除、離線與請求逾時提示。手機資料面板保留地圖操作空間，popup 位於面板上方。
