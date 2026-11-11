報修登記系統
用於新增報修需求並查看問題登記清單。
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)

## 報修網頁

純 HTML、CSS 與 JavaScript，透過 CDN 載入 supabase-js v2，不需要安裝套件或建置。
在儲存庫根目錄執行 `python -m http.server 8000`，再開啟 http://localhost:8000 預覽。
JavaScript 語法可用 `node --check app.js` 與 `node --check config.js` 檢查。

`config.js` 僅包含 Supabase 專案網址與公開 publishable key，禁止放入 secret 或 service_role 金鑰。
使用網頁前，須由專案管理者另外在 Supabase 建立 `supabase/schema.sql` 的資料表與安全政策；網頁不會執行 SQL。
所有報修內容公開可見，示範時只使用虛構姓名與地點。

GitHub Pages 可在儲存庫 Settings → Pages 選擇 Deploy from a branch，以 `main` 分支的 `/ (root)` 發佈。
預期網址：https://3075zw-byte.github.io/i-prop-520/ 。首頁為根目錄的 `index.html`。
