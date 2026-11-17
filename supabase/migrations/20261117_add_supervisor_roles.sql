-- 簽核主管改為固定職稱（廠長、副廠長、課長、副課長），每個職稱使用各自的簽核碼。
-- 適用已執行過 supabase/schema.sql 的專案；新專案直接執行最新的 schema.sql 即可。
-- 執行後，舊的（未指定職稱的）簽核碼將無法再使用，請依 README 為每個職稱設定簽核碼。
-- 簽核碼只以雜湊值保存；請勿把簽核碼原文提交到版本控制。

begin;

alter table private.supervisor_codes
    add column role text;

alter table private.supervisor_codes
    add constraint supervisor_codes_role_check check (
        role in ('廠長', '副廠長', '課長', '副課長')
    );

-- 簽核主管須為四個職稱之一，且簽核碼須與該職稱的簽核碼相符。
create or replace function public.sign_leave_request(
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
    if p_approver_name is null or p_approver_name not in ('廠長', '副廠長', '課長', '副課長') then
        raise exception 'invalid approver role' using errcode = '22023';
    end if;
    if p_code is null or not exists (
        select 1 from private.supervisor_codes c
        where c.role = p_approver_name
          and c.code_hash = extensions.crypt(p_code, c.code_hash)
    ) then
        raise exception 'invalid supervisor code' using errcode = '28000';
    end if;

    update public.leave_requests
       set status = p_decision,
           approver_name = p_approver_name,
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

commit;
