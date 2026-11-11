報修登記系統
用於新增報修需求並查看問題登記清單。
雲端任務測試
[報修欄位表（Excel）](文件/報修欄位表.xlsx)
[報修系統操作說明（Word）](文件/報修系統操作說明.docx)

## 報修網頁

純 HTML、CSS 與 JavaScript，透過 CDN 載入 supabase-js v2，不需要安裝套件或建置。
在儲存庫根目錄執行 `python -m http.server 8000`，再開啟 http://localhost:8000 預覽。
JavaScript 語法可用 `node --check app.js` 與 `node --check config.js` 檢查。

`config.js` 僅包含 Supabase 專案網址與公開 publishable key，禁止放入 secret 或 service_role 金鑰。
使用網頁前，須由專案管理者另外在 Supabase 建立 `supabase/schema.sql` 的資料表與安全政策；網頁不會執行 SQL。
所有報修內容公開可見，示範時只使用虛構姓名與地點。

GitHub Pages 可在儲存庫 Settings → Pages 選擇 Deploy from a branch，以 `main` 分支的 `/ (root)` 發佈。
預期網址：https://3075zw-byte.github.io/i-prop-520/ 。首頁為根目錄的 `index.html`。

## 清單緊急程度篩選

最近報修清單上方提供「全部、高、中、低」四個按鈕，預設選取「全部」。
選取的按鈕以深綠底色、白字及內框標示，並提供 `aria-pressed` 狀態。
篩選只使用網頁已載入的最近 20 筆報修，不會額外查詢資料庫，也不會搜尋更早的紀錄；沒有符合資料時會顯示提示。
重新整理或新增成功後會保留目前選取的篩選條件。緊急程度為「高」的標籤改為紅字、淡紅底。

手機確認方式：在本分支的預覽頁向下滑到「最近報修」，依序按「高、中、低、全部」，
確認按鈕選取樣式、顯示筆數與卡片緊急程度一致，「高」標籤為紅色，且畫面不需左右捲動。
本次僅修改前端與本說明，未更動 `supabase/`、資料表、欄位或安全政策。
