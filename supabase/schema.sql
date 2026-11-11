-- 報修登記系統：Supabase / PostgreSQL 初始建表 SQL。
-- 僅供審閱；應由資料庫擁有者於確認後執行，不在前端執行。
-- 適用尚未建立 public.repair_requests 的專案；不覆寫既有資料表。
-- 設計選擇：所有業務欄位必填；姓名最多 100 字、地點最多 200 字、
-- 問題說明最多 2000 字。長度以字元計算，並拒絕純空白文字。
-- 示範資料僅使用虛構姓名與地點；anon 可讀取完整清單。

-- 使用交易，避免建表、授權與安全政策只完成部分步驟。
begin;

-- 建立報修資料表；必填欄位禁止 NULL，自動欄位由資料庫產生。
create table public.repair_requests (
    -- 報修識別碼：隨機 UUID 主鍵，無須由前端提供。
    id uuid primary key default gen_random_uuid(),
    -- 建立時間：使用具時區的時間型態，預設為目前交易開始時間。
    created_at timestamptz not null default now(),
    -- 報修人與地點：必填文字，字數與空白限制由下方約束檢查。
    reporter_name text not null,
    location text not null,
    -- 類別與問題說明：必填，分別檢查允許選項與文字長度。
    category text not null,
    description text not null,
    -- 緊急程度與狀態：省略時套用預設值，明確傳入 NULL 仍會被拒絕。
    urgency text not null default '中',
    status text not null default '待處理',

    -- 第三層 CHECK：姓名長度為 1–100 字，且至少含一個非空白字元。
    constraint repair_requests_reporter_name_check check (
        char_length(reporter_name) between 1 and 100
        and reporter_name ~ '[^[:space:]]'
    ),
    -- 地點或部門長度為 1–200 字，不接受只有空白的內容。
    constraint repair_requests_location_check check (
        char_length(location) between 1 and 200
        and location ~ '[^[:space:]]'
    ),
    -- 類別僅接受需求筆記列出的四個選項。
    constraint repair_requests_category_check check (
        category in ('設備', '網路', '環境', '其他')
    ),
    -- 問題說明長度為 1–2000 字，不接受只有空白的內容。
    constraint repair_requests_description_check check (
        char_length(description) between 1 and 2000
        and description ~ '[^[:space:]]'
    ),
    -- 緊急程度僅接受低、中、高，其他拼寫或附加空白均不允許。
    constraint repair_requests_urgency_check check (
        urgency in ('低', '中', '高')
    ),
    -- 資料表可保存三種合法狀態；公開新增另受 RLS 限制為待處理。
    constraint repair_requests_status_check check (
        status in ('待處理', '處理中', '已完成')
    )
);

-- 第一層：SQL 權限。明確授權，不依賴專案的新表預設權限。
-- 移除可能由預設權限繼承的公開授權，僅開放 anon 所需操作。
revoke all privileges on table public.repair_requests
    from public, anon, authenticated;

-- 允許 anon 存取 public 結構描述；此授權本身不開放其他資料表。
grant usage on schema public to anon;

-- 允許 anon 讀取本表全部欄位，實際可見資料列仍由 RLS 決定。
grant select on table public.repair_requests to anon;

-- 僅授予五個表單欄位的 INSERT 權限，不給整張表的 INSERT 權限。
grant insert (
    reporter_name,
    location,
    category,
    description,
    urgency
) on table public.repair_requests to anon;

-- anon 不可指定 id、created_at、status；INSERT 時必須省略這些欄位。
-- urgency 可省略，使用「中」；status 固定由預設值產生「待處理」。
-- 不授予 UPDATE、DELETE、TRUNCATE 或其他寫入權限。

-- 第二層：RLS。此無登入示範以 anon 表示公開存取者。
alter table public.repair_requests enable row level security;

-- 公開清單政策：anon 可以讀取所有資料列，沒有使用者隔離。
create policy repair_requests_anon_select
    on public.repair_requests
    for select
    to anon
    using (true);

-- 公開新增政策：檢查套用預設值後的資料列，狀態必須為待處理。
create policy repair_requests_anon_insert
    on public.repair_requests
    for insert
    to anon
    with check (status = '待處理');

-- 不建立 UPDATE 或 DELETE policy；即使日後誤加 SQL 權限，
-- 在未另加政策的前提下，RLS 仍不允許 anon 修改或刪除資料。
-- 第三層：上方 NOT NULL 與 CHECK 約束檢查每筆資料的值及文字長度。
-- 資料庫擁有者與具 BYPASSRLS 的管理角色不在 anon 權限模型內。

-- 全部步驟成功後一併提交；本檔僅產生供審閱，尚未執行。
commit;
