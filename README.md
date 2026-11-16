員工加班申請系統
用於送出員工加班申請並查看申請清單。（原報修登記系統改版）
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)
[報修系統操作說明（Word）](文件/報修系統操作說明.docx)
[報修登記系統提案（PowerPoint）](文件/報修登記系統提案.pptx)

## 員工加班申請網頁

網頁已由「報修登記」改為「員工加班申請表」，需求見 `加班申請需求筆記.txt`。表單欄位：

- 員工姓名（必填，最多 100 字，不可只有空白）
- 加班日期（日期選擇器）
- 開始時間、結束時間（結束須晚於開始，不跨日；表單即時顯示加班時數）
- 加班原因（必填，最多 1000 字）
- 申請時間由資料庫自動產生，初始狀態為「待審核」

純 HTML、CSS 與 JavaScript，透過 CDN 載入 supabase-js v2，不需要安裝套件或建置。
在儲存庫根目錄執行 `python -m http.server 8000`，再開啟 http://localhost:8000 預覽。
JavaScript 語法可用 `node --check app.js` 與 `node --check config.js` 檢查。

`config.js` 僅包含 Supabase 專案網址與公開 publishable key，禁止放入 secret 或 service_role 金鑰。
使用網頁前，須由專案管理者在 Supabase 執行 `supabase/schema.sql`，建立 `public.overtime_requests` 資料表與安全政策（可新增、可讀取，不可修改或刪除）；網頁不會執行 SQL。舊的 `repair_requests` 資料表不受影響。
所有申請內容公開可見，示範時只使用虛構姓名。

GitHub Pages 可在儲存庫 Settings → Pages 選擇 Deploy from a branch，以 `main` 分支的 `/ (root)` 發佈。
預期網址：https://3075zw-byte.github.io/i-prop-520/ 。首頁為根目錄的 `index.html`。

`文件/` 內的 Excel、Word、PowerPoint 仍為報修版本，尚未改寫。

[加班申請手機介面預覽](文件/加班申請手機預覽.png)

## PWA 安裝與離線使用

網頁已加入 Web App Manifest、Service Worker、192／512 像素圖示、maskable 圖示及 Apple 主畫面圖示。
所有路徑相對於目前目錄，可部署到 GitHub Pages 的 `/i-prop-520/` 子路徑。

- Android Chrome：開啟網站後，可按頁面出現的「安裝加班申請」，或使用瀏覽器選單的「安裝應用程式／加到主畫面」。按鈕僅在瀏覽器提供安裝功能時顯示。
- iPhone／iPad：用 Safari 開啟網站，按分享，再選「加入主畫面」。
- 桌面 Chrome／Edge：可使用網址列或瀏覽器選單提供的安裝功能。

安裝選項依裝置及瀏覽器而異。正式網站需要 HTTPS，本機開發可用 localhost；直接開啟 `file://` 不支援 Service Worker。
第一次須保持連網，直到頁面顯示「離線介面已準備完成」。之後離線仍能開啟表單介面。

**離線限制：** 送出申請與讀取最新清單仍需連線，離線會停用送出與重新整理。
本頁已讀到的清單可繼續篩選，但僅保留於記憶體，關閉或重新載入後不會離線保存。
填寫內容也不會持久保存、排入背景佇列或自動補送；恢復連線後會重讀清單，使用者須自行送出表單。
若連線在送出途中中斷，請先確認清單，避免重複新增。

Service Worker 僅快取指定的介面檔案、公開設定、圖示與固定版本 supabase-js v2 CDN SDK，不快取 Supabase API 回應，也不攔截 POST 請求。
快取名稱包含部署範圍，不會清除同網域其他應用程式的快取。
更新介面、公開設定或 SDK 時，請同步增加 `sw.js` 的快取版本。
新版備妥後會提示關閉此網站所有分頁及獨立視窗再重開，不會強制重新載入正在填寫的表單。

開發檢查：執行 `node --check app.js`、`node --check pwa.js`、`node --check sw.js`。
瀏覽器驗證：先連網開啟並等離線介面準備完成，再用開發者工具切換離線並重新載入，確認可開啟介面且不能送出；恢復連線後確認可重新讀取清單。
本次不修改 `supabase/`、資料表或安全政策。

[PWA 手機介面預覽](文件/PWA手機預覽.png)
