-- 為已建立的 public.leave_requests 新增假別欄位（事假、病假、特休，可複選）。
-- 僅適用已執行過「未含假別」版本 supabase/schema.sql 的專案；新專案直接執行 schema.sql 即可。
-- 既有資料無法得知假別，暫以「事假」填入，請管理者確認後自行修正。

begin;

alter table public.leave_requests
    add column leave_types text[] not null default array['事假']::text[];

-- 回填完成後移除預設值，之後新增的申請必須由表單明確指定假別。
alter table public.leave_requests
    alter column leave_types drop default;

alter table public.leave_requests
    add constraint leave_requests_leave_types_check check (
        cardinality(leave_types) between 1 and 3
        and leave_types <@ array['事假', '病假', '特休']::text[]
        and array_position(leave_types, null) is null
    );

-- anon 可新增假別欄位；讀取權限沿用整張表的 SELECT。
grant insert (leave_types) on table public.leave_requests to anon;

commit;
