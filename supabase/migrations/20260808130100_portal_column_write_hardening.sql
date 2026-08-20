-- Portal users must never be able to update their whole CRM or profile rows.
-- These narrow entry points preserve the only legitimate self-service edit:
-- credit-monitoring setup.

drop policy if exists "client_update_own_meta" on public.clients;
drop policy if exists "client_profiles_update_own_or_staff" on public.client_profiles;

drop policy if exists "staff_update_client_profiles" on public.client_profiles;
create policy "staff_update_client_profiles" on public.client_profiles for update to authenticated
using (public.is_staff()) with check (public.is_staff());

create or replace function public.update_own_client_monitoring(
  p_client_id uuid,
  p_monitoring_service text,
  p_monitoring_email text,
  p_monitoring_portal_url text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid() and cp.client_id = p_client_id
  ) then
    raise exception 'Client portal access denied';
  end if;
  update public.clients
  set monitoring_service = nullif(trim(p_monitoring_service), ''),
      monitoring_email = nullif(trim(p_monitoring_email), ''),
      monitoring_portal_url = nullif(trim(p_monitoring_portal_url), ''),
      monitoring_enrolled = true
  where id = p_client_id;
end;
$$;

revoke all on function public.update_own_client_monitoring(uuid, text, text, text) from public;
grant execute on function public.update_own_client_monitoring(uuid, text, text, text) to authenticated;
