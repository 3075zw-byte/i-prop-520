-- 員工加班申請系統：Supabase / PostgreSQL 初始建表 SQL。
-- 僅供審閱；應由資料庫擁有者於確認後執行，不在前端執行。
-- 適用尚未建立 public.overtime_requests 的專案；不覆寫既有資料表，
-- 也不刪除舊的 public.repair_requests。
-- 設計選擇：所有業務欄位必填；姓名最多 100 字、原因最多 1000 字，
-- 拒絕純空白文字；結束時間須晚於開始時間（不跨日）。
-- 示範資料僅使用虛構姓名；anon 可讀取完整清單。

begin;

create table public.overtime_requests (
    -- 申請識別碼：隨機 UUID 主鍵，無須由前端提供。
    id uuid primary key default gen_random_uuid(),
    -- 申請時間：由資料庫自動產生，前端不可指定。
    created_at timestamptz not null default now(),
    -- 員工姓名。
    employee_name text not null,
    -- 加班日期與時段。
    overtime_date date not null,
    start_time time not null,
    end_time time not null,
    -- 加班原因。
    reason text not null,
    -- 審核狀態：公開新增固定為待審核。
    status text not null default '待審核',

    constraint overtime_requests_employee_name_check check (
        char_length(employee_name) between 1 and 100
        and employee_name ~ '[^[:space:]]'
    ),
    constraint overtime_requests_time_range_check check (
        end_time > start_time
    ),
    constraint overtime_requests_reason_check check (
        char_length(reason) between 1 and 1000
        and reason ~ '[^[:space:]]'
    ),
    constraint overtime_requests_status_check check (
        status in ('待審核', '已核准', '已退回')
    )
);

-- 第一層：SQL 權限。僅開放 anon 所需操作。
revoke all privileges on table public.overtime_requests
    from public, anon, authenticated;

grant usage on schema public to anon;

grant select on table public.overtime_requests to anon;

-- 僅授予五個表單欄位的 INSERT 權限；id、created_at、status 由預設值產生。
grant insert (
    employee_name,
    overtime_date,
    start_time,
    end_time,
    reason
) on table public.overtime_requests to anon;

-- 不授予 UPDATE、DELETE、TRUNCATE 或其他寫入權限。

-- 第二層：RLS。
alter table public.overtime_requests enable row level security;

create policy overtime_requests_anon_select
    on public.overtime_requests
    for select
    to anon
    using (true);

create policy overtime_requests_anon_insert
    on public.overtime_requests
    for insert
    to anon
    with check (status = '待審核');

-- 不建立 UPDATE 或 DELETE policy；anon 無法修改或刪除資料。
-- 審核（變更狀態）、登入與通知尚未決定，暫不實作。

commit;
