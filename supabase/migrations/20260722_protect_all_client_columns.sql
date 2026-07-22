-- Widen client-row tamper protection from "billing columns only" to an
-- allowlist covering the WHOLE clients row.
--
-- 20260722_billing_schema_and_rls.sql froze a fixed list of billing columns
-- against client edits, but the same client_update_own_meta RLS policy also
-- lets a client PATCH other sensitive columns on their own row — notably
-- user_id (row ownership, used by staff_all_clients RLS) and status
-- (lead/client pipeline state) — plus any sensitive column added in future.
--
-- This replaces the denylist trigger with an allowlist one: a signed-in
-- client may change ONLY the columns they legitimately write from the portal
-- (LPOA signing in ClientSetupFlow, credit-monitoring enrollment in
-- DocumentsTab — the only two client-facing clients-table writes in the app).
-- Every other column reverts to its OLD value. Service role (cron / Netlify
-- functions, auth.uid() null) and staff (profiles.role in admin/auditor)
-- still pass through untouched, so admin edits and cron billing are unaffected.
--
-- Adding a new client-writable column later means adding it to allowed_cols
-- here; forgetting is fail-safe (the write is silently ignored, not a leak).

drop trigger if exists trg_protect_client_billing on public.clients;
drop function if exists public.protect_client_billing_columns();

create or replace function public.protect_client_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- The ONLY columns a signed-in client may change on their own clients row.
  allowed_cols text[] := array[
    'lpoa_signed', 'lpoa_signed_at', 'lpoa_signature_data',
    'monitoring_service', 'monitoring_email', 'monitoring_enrolled', 'monitoring_portal_url'
  ];
  col    text;
  merged jsonb;
begin
  -- Service role (cron / Netlify background functions) has no auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  -- Staff (admin/auditor). Must be role-based, not "has a profiles row":
  -- handle_new_user() gives matched clients a profiles row with role='client'.
  if exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    return new;
  end if;

  -- Signed-in client: start from OLD, then re-apply only the allowed columns
  -- from NEW. Anything else the client tried to change is reverted.
  merged := to_jsonb(old);
  foreach col in array allowed_cols loop
    merged := jsonb_set(merged, array[col], to_jsonb(new) -> col);
  end loop;
  return jsonb_populate_record(new, merged);
end;
$$;

drop trigger if exists trg_protect_client_columns on public.clients;
create trigger trg_protect_client_columns
  before update on public.clients
  for each row
  execute function public.protect_client_columns();
