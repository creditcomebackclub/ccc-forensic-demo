-- Fixes an orphaned trigger. 20260722_protect_all_client_columns.sql replaced
-- the old protect_client_billing_columns() trigger with the allowlist-based
-- protect_client_columns(), dropping the old function and its trigger. But
-- two later migrations (20260723_lifecycle_status.sql,
-- 20260723_winback_notifications.sql) did `create or replace function
-- protect_client_billing_columns()` under the same name, assuming it was
-- still wired to a trigger — it wasn't. That function has been dead code
-- since 20260722, and its status_changed_at auto-stamping (which the
-- winback-email day-counting sweep depends on) has not run on any real
-- billing_status change since. This folds that stamping logic into the
-- trigger that is actually live, and drops the dead duplicate function.

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
  if auth.uid() is null then
    -- Service role (cron / Netlify background functions) — allow untouched.
    null;
  elsif exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'auditor')
  ) then
    -- Staff — allow untouched.
    null;
  else
    -- Signed-in client: start from OLD, then re-apply only the allowed
    -- columns from NEW. Anything else the client tried to change is reverted.
    merged := to_jsonb(old);
    foreach col in array allowed_cols loop
      merged := jsonb_set(merged, array[col], to_jsonb(new) -> col);
    end loop;
    new := jsonb_populate_record(new, merged);
  end if;

  -- Stamp status_changed_at whenever billing_status actually changes,
  -- regardless of which code path changed it (admin UI, daily-cron
  -- auto-pause, a future winback job) — evaluated after the client-tamper
  -- reversion above, so a blocked client write never bumps this stamp.
  if new.billing_status is distinct from old.billing_status then
    new.status_changed_at := now();
  else
    new.status_changed_at := old.status_changed_at;
  end if;

  return new;
end;
$$;

-- trg_protect_client_columns (created in 20260722_protect_all_client_columns.sql)
-- already points at protect_client_columns() — no trigger changes needed,
-- create or replace on the function body is enough.
