-- 員工請假申請系統：Supabase / PostgreSQL 初始建表 SQL。
-- 僅供審閱；應由資料庫擁有者於確認後執行，不在前端執行。
-- 適用尚未建立 public.leave_requests 的專案；不覆寫既有資料表，
-- 也不刪除舊的 public.repair_requests 或 public.overtime_requests。
-- 設計選擇：所有業務欄位必填；姓名最多 100 字、原因最多 1000 字，
-- 拒絕純空白文字；請假結束須晚於開始，可跨日。
-- 請假起訖以「不含時區的當地時間」（timestamp）保存，與員工輸入一致。
-- 示範資料僅使用虛構姓名；anon 可讀取完整清單。
-- 主管簽核：透過 sign_leave_request 函式，須輸入正確的簽核碼；
-- 簽核碼只以雜湊值存在 private 結構描述，前端與 API 均無法讀取。
-- 每筆申請只能簽核一次，簽核時間由資料庫自動產生。

begin;

create table public.leave_requests (
    -- 申請識別碼：隨機 UUID 主鍵，無須由前端提供。
    id uuid primary key default gen_random_uuid(),
    -- 申請時間：由資料庫自動產生，前端不可指定。
    created_at timestamptz not null default now(),
    -- 員工姓名。
    employee_name text not null,
    -- 請假開始與結束（日期及時間）。
    leave_start timestamp not null,
    leave_end timestamp not null,
    -- 請假原因。
    reason text not null,
    -- 審核狀態：公開新增固定為待審核。
    status text not null default '待審核',
    -- 主管簽核：簽核主管、意見與簽核時間；待審核時皆為空值。
    approver_name text,
    approver_comment text,
    signed_at timestamptz,

    constraint leave_requests_employee_name_check check (
        char_length(employee_name) between 1 and 100
        and employee_name ~ '[^[:space:]]'
    ),
    constraint leave_requests_period_check check (
        leave_end > leave_start
    ),
    constraint leave_requests_reason_check check (
        char_length(reason) between 1 and 1000
        and reason ~ '[^[:space:]]'
    ),
    constraint leave_requests_status_check check (
        status in ('待審核', '已核准', '已退回')
    ),
    -- 待審核時不可有簽核資料；已核准或已退回時必須有簽核主管與時間。
    constraint leave_requests_signoff_check check (
        (status = '待審核' and approver_name is null and approver_comment is null and signed_at is null)
        or (status <> '待審核' and signed_at is not null
            and char_length(approver_name) between 1 and 100
            and approver_name ~ '[^[:space:]]')
    ),
    constraint leave_requests_approver_comment_check check (
        approver_comment is null or char_length(approver_comment) <= 500
    )
);

-- 第一層：SQL 權限。僅開放 anon 所需操作。
revoke all privileges on table public.leave_requests
    from public, anon, authenticated;

grant usage on schema public to anon;

grant select on table public.leave_requests to anon;

-- 僅授予四個表單欄位的 INSERT 權限；id、created_at、status 由預設值產生。
grant insert (
    employee_name,
    leave_start,
    leave_end,
    reason
) on table public.leave_requests to anon;

-- 不授予 UPDATE、DELETE、TRUNCATE 或其他寫入權限。

-- 第二層：RLS。
alter table public.leave_requests enable row level security;

create policy leave_requests_anon_select
    on public.leave_requests
    for select
    to anon
    using (true);

create policy leave_requests_anon_insert
    on public.leave_requests
    for insert
    to anon
    with check (status = '待審核');

-- 不建立 UPDATE 或 DELETE policy；anon 無法直接修改或刪除資料。

-- 第三層：主管簽核。簽核碼雜湊存放於不對 API 公開的 private 結構描述。
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.supervisor_codes (
    id bigint generated always as identity primary key,
    -- 以 bcrypt 產生的雜湊值，不保存簽核碼原文。
    code_hash text not null,
    created_at timestamptz not null default now()
);
revoke all privileges on table private.supervisor_codes from public, anon, authenticated;

-- 簽核函式：以擁有者權限執行，只能把「待審核」改為「已核准」或「已退回」，
-- 並寫入簽核主管、意見與簽核時間；不能修改申請內容，也不能重複簽核。
create function public.sign_leave_request(
    p_request_id uuid,
    p_decision text,
    p_approver_name text,
    p_comment text,
    p_code text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_decision not in ('已核准', '已退回') then
        raise exception 'invalid decision' using errcode = '22023';
    end if;
    if p_code is null or not exists (
        select 1 from private.supervisor_codes c
        where c.code_hash = extensions.crypt(p_code, c.code_hash)
    ) then
        raise exception 'invalid supervisor code' using errcode = '28000';
    end if;

    update public.leave_requests
       set status = p_decision,
           approver_name = btrim(p_approver_name),
           approver_comment = nullif(btrim(coalesce(p_comment, '')), ''),
           signed_at = now()
     where id = p_request_id
       and status = '待審核';

    if not found then
        raise exception 'request not found or already signed' using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.sign_leave_request(uuid, text, text, text, text) from public, authenticated;
grant execute on function public.sign_leave_request(uuid, text, text, text, text) to anon;

-- 執行本檔後，由資料庫擁有者另外設定簽核碼（請自訂夠長的簽核碼，勿提交到版本控制）：
--   insert into private.supervisor_codes (code_hash)
--   values (extensions.crypt('自訂簽核碼', extensions.gen_salt('bf')));
-- 停用舊簽核碼：delete from private.supervisor_codes where id = <編號>;
-- 限制：此示範沒有登入與嘗試次數限制，簽核碼外流或過短即可能被冒用；
-- 正式使用前應改為 Supabase Auth 主管帳號。假別與通知尚未決定，暫不實作。

commit;
