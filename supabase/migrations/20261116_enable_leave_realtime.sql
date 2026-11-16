-- 讓「每月請假統計表」即時更新：將 public.leave_requests 加入 Supabase Realtime 發佈。
-- 只開放資料變更通知；anon 仍只能讀取與新增，RLS 與權限不變（通知內容依 SELECT policy 過濾）。
-- 未執行時，網頁會改為每 30 秒自動重新讀取統計。可重複執行。

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'leave_requests'
    ) then
        alter publication supabase_realtime add table public.leave_requests;
    end if;
end;
$$;
