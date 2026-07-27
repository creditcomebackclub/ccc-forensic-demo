-- A small, durable action queue for the staff-shell badge and Inbox.
--
-- Do not discover every raw Storage folder at application startup. Raw
-- legacy response folders remain visible when a staff member opens that
-- client's Documents workflow, but global operations now rely on durable
-- response_evidence rows and the two persisted legacy signals that existed
-- before the evidence table (response_file_url / response_outcome).

create or replace function public.list_response_action_items(
  p_limit integer default 251,
  p_cursor_created_at timestamptz default null,
  p_cursor_key text default null
)
returns table (
  source text,
  item_id text,
  client_id uuid,
  client_name text,
  letter_id text,
  response_kind text,
  created_at timestamptz,
  sort_key text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with items as (
    select
      'response_evidence'::text as source,
      evidence.id::text as item_id,
      evidence.client_id,
      evidence.client_name,
      evidence.letter_id,
      evidence.response_kind,
      coalesce(evidence.received_at, evidence.created_at) as created_at,
      'response_evidence:' || evidence.id::text as sort_key
    from public.response_evidence evidence
    where evidence.upload_status = 'received'
      and evidence.analysis_status in ('not_started', 'error')

    union all

    -- Legacy storage cannot be queried safely from SQL. Count only rows
    -- that have a durable, persisted indication a response exists. The
    -- selected client's Documents tab retains the old folder discovery path
    -- for reconciliation; this queue intentionally does not pretend that a
    -- raw bucket crawl is a scalable source of truth.
    select
      'legacy_signal'::text as source,
      letter.id as item_id,
      letter.client_id,
      letter.client_name,
      letter.id as letter_id,
      case when letter.phase ilike 'Phase 3%' then 'bureau' else 'furnisher' end as response_kind,
      letter.saved_at as created_at,
      'legacy_signal:' || letter.id as sort_key
    from public.letters letter
    where letter.phase2_analyzed_at is null
      and (letter.response_file_url is not null or letter.response_outcome = 'received')
      and not exists (
        select 1
        from public.response_evidence evidence
        where evidence.letter_id = letter.id
          and evidence.upload_status = 'received'
      )
      and (
        letter.phase ilike 'Phase 3%'
        or not exists (
          select 1
          from public.letters phase3
          where phase3.user_id = letter.user_id
            and phase3.phase ilike 'Phase 3%'
            and (
              phase3.client_id = letter.client_id
              or (
                phase3.client_id is null
                and letter.client_id is null
                and phase3.client_name = letter.client_name
              )
            )
            and (
              phase3.furnisher = letter.furnisher
              or coalesce(phase3.covered_furnishers, '[]'::jsonb) ? letter.furnisher
            )
        )
      )
  ), ranked as (
    select items.*, count(*) over () as total_count
    from items
  )
  select
    source,
    item_id,
    client_id,
    client_name,
    letter_id,
    response_kind,
    created_at,
    sort_key,
    total_count
  from ranked
  where p_cursor_created_at is null
    or created_at < p_cursor_created_at
    or (created_at = p_cursor_created_at and sort_key < p_cursor_key)
  order by created_at desc nulls last, sort_key desc
  limit least(greatest(coalesce(p_limit, 251), 1), 501);
$$;

revoke all on function public.list_response_action_items(integer, timestamptz, text) from public;
grant execute on function public.list_response_action_items(integer, timestamptz, text) to authenticated;

create index if not exists response_evidence_action_queue_idx
  on public.response_evidence (received_at desc, id desc)
  include (client_id, client_name, letter_id, response_kind)
  where upload_status = 'received'
    and analysis_status in ('not_started', 'error');

create index if not exists letters_legacy_response_signal_idx
  on public.letters (saved_at desc, id desc)
  include (user_id, client_id, client_name, phase, furnisher, covered_furnishers)
  where phase2_analyzed_at is null
    and (response_file_url is not null or response_outcome = 'received');
