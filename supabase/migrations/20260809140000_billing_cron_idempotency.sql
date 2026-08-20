-- Scheduled functions can be invoked more than once (retries, deploy overlap,
-- or a manual run). Billing changes and outbound notices must remain exactly-once
-- from the business perspective even when that happens.

create table if not exists public.automated_email_sends (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_type text not null,
  client_id uuid references public.clients(id) on delete cascade,
  recipient text not null,
  idempotency_key text not null unique,
  send_status text not null default 'sending' check (send_status in ('sending', 'sent', 'failed')),
  resend_email_id text,
  delivery_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists automated_email_sends_client_created_idx
  on public.automated_email_sends (client_id, created_at desc)
  where client_id is not null;

alter table public.automated_email_sends enable row level security;

-- Claiming happens before a message is handed to Resend. A duplicate invocation
-- receives claimed=false and must not send, including when the prior invocation
-- is still in progress or failed with an ambiguous transport result.
create or replace function public.claim_automated_email_send(
  p_event_key text,
  p_event_type text,
  p_recipient text,
  p_client_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automated_email_sends%rowtype;
begin
  if nullif(trim(p_event_key), '') is null or nullif(trim(p_event_type), '') is null or nullif(trim(p_recipient), '') is null then
    raise exception 'Automated email event key, type, and recipient are required';
  end if;

  insert into public.automated_email_sends (event_key, event_type, client_id, recipient, idempotency_key)
  values (
    trim(p_event_key),
    trim(p_event_type),
    p_client_id,
    lower(trim(p_recipient)),
    'ccc-auto-' || trim(p_event_key)
  )
  on conflict (event_key) do nothing
  returning * into v_row;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object('claimed', true, 'id', v_row.id, 'idempotency_key', v_row.idempotency_key);
end;
$$;

-- Atomically append an automated invoice. The row lock makes a concurrent cron
-- run see the first run's ledger update before deciding whether it may create one.
create or replace function public.claim_billing_invoice(
  p_client_id uuid,
  p_billing_period date,
  p_amount numeric,
  p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_ledger jsonb;
  v_invoice jsonb;
begin
  if p_amount <= 0 or nullif(trim(p_description), '') is null then
    raise exception 'A positive invoice amount and description are required';
  end if;

  select * into v_client from public.clients where id = p_client_id for update;
  if not found then raise exception 'Client not found'; end if;
  v_ledger := coalesce(v_client.ledger, '[]'::jsonb);

  if exists (
    select 1
    from jsonb_array_elements(v_ledger) entry
    where entry->>'type' = 'Invoice'
      and coalesce(entry->>'billing_period_key', entry->>'date') = p_billing_period::text
  ) then
    return jsonb_build_object('created', false, 'ledger', v_ledger);
  end if;

  v_invoice := jsonb_build_object(
    'id', gen_random_uuid()::text,
    'date', p_billing_period::text,
    'billing_period_key', p_billing_period::text,
    'type', 'Invoice',
    'amount', p_amount,
    'description', trim(p_description),
    'status', 'Due',
    'created_at', now()
  );
  v_ledger := v_ledger || jsonb_build_array(v_invoice);
  update public.clients set ledger = v_ledger where id = p_client_id;

  return jsonb_build_object('created', true, 'invoice', v_invoice, 'ledger', v_ledger);
end;
$$;

revoke all on function public.claim_automated_email_send(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.claim_billing_invoice(uuid, date, numeric, text) from public, anon, authenticated;
grant execute on function public.claim_automated_email_send(text, text, text, uuid) to service_role;
grant execute on function public.claim_billing_invoice(uuid, date, numeric, text) to service_role;
