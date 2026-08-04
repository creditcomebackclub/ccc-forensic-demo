-- Scale-safe admin exception queue. This function derives current operational
-- failures from durable source tables; it does not copy client data into a
-- second task system that can drift out of sync.

create index if not exists audit_jobs_open_status_idx
  on public.audit_jobs (status, updated_at desc)
  where status in ('queued', 'running', 'error');

create index if not exists phase2_jobs_open_status_idx
  on public.phase2_jobs (status, updated_at desc)
  where status in ('queued', 'running', 'error');

create index if not exists phase4_jobs_open_status_idx
  on public.phase4_jobs (status, updated_at desc)
  where status in ('queued', 'running', 'error');

create index if not exists recovery_blueprints_delivery_queue_idx
  on public.recovery_blueprints (delivery_status, updated_at desc)
  where status = 'sent' or delivery_status is not null;

create or replace function public.get_operations_queue(p_limit integer default 200)
returns table (
  issue_key text,
  source text,
  source_id text,
  severity text,
  status text,
  client_id uuid,
  client_name text,
  title text,
  detail text,
  occurred_at timestamptz,
  updated_at timestamptz,
  destination text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  with issues as (
    select
      'audit_job:' || j.id::text as issue_key,
      'audit_job'::text as source,
      j.id::text as source_id,
      case when j.status = 'error' then 'critical' else 'warning' end as severity,
      j.status,
      j.selected_client_id as client_id,
      c.name as client_name,
      case
        when j.status = 'error' then 'Forensic audit failed'
        when j.status = 'running' then 'Forensic audit appears stalled'
        else 'Forensic audit has not started'
      end as title,
      coalesce(nullif(j.error, ''), nullif(j.stage, ''), 'No diagnostic detail was recorded.') as detail,
      j.created_at as occurred_at,
      j.updated_at,
      case when j.selected_client_id is null then 'audit' else 'clients' end as destination,
      case when j.status = 'error' then 0 else 1 end as severity_rank
    from public.audit_jobs j
    left join public.clients c on c.id = j.selected_client_id
    where
      (j.status = 'error' and j.updated_at >= now() - interval '14 days' and not exists (
        select 1 from public.audit_jobs retry
        where retry.created_at > j.created_at
          and retry.status = 'done'
          and retry.mode = j.mode
          and retry.selected_client_id is not distinct from j.selected_client_id
      ))
      or (j.status = 'queued' and j.updated_at < now() - interval '15 minutes')
      or (j.status = 'running' and j.updated_at < now() - interval '20 minutes')

    union all

    select
      'phase2_job:' || j.id::text,
      'phase2_job'::text,
      j.id::text,
      case when j.status = 'error' then 'critical' else 'warning' end,
      j.status,
      l.client_id,
      coalesce(c.name, l.client_name),
      case
        when j.status = 'error' then 'Response analysis failed'
        when j.status = 'running' then 'Response analysis appears stalled'
        else 'Response analysis has not started'
      end,
      coalesce(nullif(j.error, ''), nullif(j.stage, ''), 'No diagnostic detail was recorded.'),
      j.created_at,
      j.updated_at,
      'inbox'::text,
      case when j.status = 'error' then 0 else 1 end
    from public.phase2_jobs j
    left join public.letters l on l.id = j.letter_id
    left join public.clients c on c.id = l.client_id
    where
      (j.status = 'error' and j.updated_at >= now() - interval '14 days' and not exists (
        select 1 from public.phase2_jobs retry
        where retry.created_at > j.created_at
          and retry.status = 'done'
          and retry.letter_id = j.letter_id
          and retry.kind = j.kind
      ))
      or (j.status = 'queued' and j.updated_at < now() - interval '15 minutes')
      or (j.status = 'running' and j.updated_at < now() - interval '20 minutes')

    union all

    select
      'phase4_job:' || j.id::text,
      'phase4_job'::text,
      j.id::text,
      case when j.status = 'error' then 'critical' else 'warning' end,
      j.status,
      e.client_id,
      c.name,
      case
        when j.status = 'error' then 'Escalation generation failed'
        when j.status = 'running' then 'Escalation generation appears stalled'
        else 'Escalation generation has not started'
      end,
      coalesce(nullif(j.error, ''), nullif(j.stage, ''), 'No diagnostic detail was recorded.'),
      j.created_at,
      j.updated_at,
      'clients'::text,
      case when j.status = 'error' then 0 else 1 end
    from public.phase4_jobs j
    join public.escalations e on e.id = j.escalation_id
    left join public.clients c on c.id = e.client_id
    where
      (j.status = 'error' and j.updated_at >= now() - interval '14 days' and not exists (
        select 1 from public.phase4_jobs retry
        where retry.created_at > j.created_at
          and retry.status = 'done'
          and retry.escalation_id = j.escalation_id
      ))
      or (j.status = 'queued' and j.updated_at < now() - interval '15 minutes')
      or (j.status = 'running' and j.updated_at < now() - interval '20 minutes')

    union all

    select
      'mail_submission:' || m.id::text,
      'mail_submission'::text,
      m.id::text,
      case when m.status = 'accepted_unreconciled' then 'critical' else 'critical' end,
      m.status,
      coalesce(m.client_id, l.client_id),
      coalesce(c.name, l.client_name),
      case
        when m.status = 'accepted_unreconciled' then 'Lob accepted mail, but CCC needs reconciliation'
        when m.status = 'failed' then 'Lob mailing failed'
        else 'Lob submission appears stalled'
      end,
      coalesce(nullif(m.last_error, ''), 'No diagnostic detail was recorded.'),
      m.created_at,
      m.updated_at,
      'letter-tracker'::text,
      0
    from public.mail_submissions m
    left join public.letters l on l.id = m.letter_id
    left join public.clients c on c.id = coalesce(m.client_id, l.client_id)
    where m.status in ('failed', 'accepted_unreconciled')
       or (m.status = 'pending' and m.updated_at < now() - interval '10 minutes')

    union all

    select
      'response_evidence:' || r.id::text,
      'response_evidence'::text,
      r.id::text,
      'critical'::text,
      case when r.upload_status = 'error' then 'upload_error' else 'analysis_error' end,
      r.client_id,
      coalesce(c.name, r.client_name),
      case when r.upload_status = 'error' then 'Client response upload failed' else 'Client response analysis failed' end,
      case
        when r.upload_status = 'error' then 'The response evidence did not finish uploading.'
        else 'The uploaded response could not be analyzed. Open Inbox to retry or review it manually.'
      end,
      r.created_at,
      r.updated_at,
      'inbox'::text,
      0
    from public.response_evidence r
    left join public.clients c on c.id = r.client_id
    where (r.upload_status = 'error' or r.analysis_status = 'error')
      and not exists (
        select 1 from public.response_evidence retry
        where retry.created_at > r.created_at
          and retry.letter_id = r.letter_id
          and retry.upload_status = 'received'
          and retry.analysis_status = 'analyzed'
      )

    union all

    select
      'recovery_blueprint:' || b.id::text,
      'recovery_blueprint'::text,
      b.id::text,
      case when b.delivery_status in ('bounced', 'dropped') then 'critical' else 'warning' end,
      coalesce(b.delivery_status, b.status),
      b.client_id,
      coalesce(c.name, b.client_name),
      case
        when b.delivery_status = 'bounced' then 'Recovery Blueprint email bounced'
        when b.delivery_status = 'dropped' then 'Recovery Blueprint email was dropped'
        when b.delivery_status = 'deferred' then 'Recovery Blueprint delivery is delayed'
        else 'Approved Recovery Blueprint has not been sent'
      end,
      coalesce(nullif(b.delivery_error, ''),
        case when b.status = 'approved' then 'Approved more than 24 hours ago.' else 'SendGrid has not confirmed delivery.' end),
      b.approved_at,
      b.updated_at,
      'clients'::text,
      case when b.delivery_status in ('bounced', 'dropped') then 0 else 1 end
    from public.recovery_blueprints b
    left join public.clients c on c.id = b.client_id
    where b.delivery_status in ('bounced', 'dropped')
       or (b.delivery_status = 'deferred' and b.updated_at < now() - interval '30 minutes')
       or (b.status = 'approved' and b.approved_at < now() - interval '24 hours')

    union all

    select
      'onboarding:' || cp.id::text,
      'onboarding'::text,
      cp.id::text,
      'warning'::text,
      'incomplete'::text,
      cp.client_id,
      coalesce(c.name, cp.full_name),
      'Client onboarding is incomplete',
      'Portal access exists, but onboarding has remained incomplete for more than 24 hours.',
      cp.created_at,
      cp.created_at,
      'clients'::text,
      1
    from public.client_profiles cp
    left join public.clients c on c.id = cp.client_id
    where coalesce(cp.onboarding_complete, false) = false
      and cp.created_at < now() - interval '24 hours'
  )
  select
    i.issue_key, i.source, i.source_id, i.severity, i.status,
    i.client_id, i.client_name, i.title, i.detail,
    i.occurred_at, i.updated_at, i.destination
  from issues i
  order by i.severity_rank, i.updated_at desc, i.issue_key
  limit greatest(1, least(coalesce(p_limit, 200), 500));
end;
$$;

revoke all on function public.get_operations_queue(integer) from public;
grant execute on function public.get_operations_queue(integer) to authenticated;

comment on function public.get_operations_queue(integer) is
  'Admin-only, scale-safe queue of current workflow failures and delayed production work.';

create or replace function public.get_client_production_readiness(p_client_id uuid)
returns table (
  sequence integer,
  check_key text,
  label text,
  status text,
  detail text,
  evidence_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.clients%rowtype;
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select * into target from public.clients c where c.id = p_client_id;
  if not found then
    raise exception 'Client not found' using errcode = 'P0002';
  end if;

  return query
  with facts as (
    select
      exists (
        select 1 from public.client_profiles cp
        where cp.client_id = p_client_id and cp.onboarding_complete = true
      ) as onboarding_complete,
      exists (
        select 1 from public.client_profiles cp
        where cp.client_id = p_client_id and cp.agreement_signed_at is not null
      ) as agreement_signed,
      coalesce(target.lpoa_signed, false) as lpoa_signed,
      (select max(a.saved_at) from public.audits a where a.client_id = p_client_id) as audit_at,
      (select count(*) from public.audits a where a.client_id = p_client_id) as audit_count,
      (select max(b.approved_at) from public.recovery_blueprints b where b.client_id = p_client_id) as blueprint_at,
      (select max(b.delivered_at) from public.recovery_blueprints b where b.client_id = p_client_id and b.delivery_status = 'delivered') as blueprint_delivered_at,
      (select max(b.viewed_at) from public.recovery_blueprints b where b.client_id = p_client_id) as blueprint_viewed_at,
      (select max(l.saved_at) from public.letters l where l.client_id = p_client_id and l.phase like 'Phase 1%') as phase1_at,
      (select max(l.delivered_at) from public.letters l where l.client_id = p_client_id and l.phase like 'Phase 1%' and l.delivered_at is not null) as phase1_delivered_at,
      (select max(r.received_at) from public.response_evidence r where r.client_id = p_client_id and r.response_kind = 'furnisher' and r.upload_status = 'received') as furnisher_response_at,
      (select max(r.analyzed_at) from public.response_evidence r where r.client_id = p_client_id and r.response_kind = 'furnisher' and r.analysis_status = 'analyzed') as furnisher_analysis_at,
      (select max(l.saved_at) from public.letters l where l.client_id = p_client_id and l.phase like 'Phase 3%') as phase3_at,
      (select max(l.delivered_at) from public.letters l where l.client_id = p_client_id and l.phase like 'Phase 3%' and l.delivered_at is not null) as phase3_delivered_at,
      (select max(r.received_at) from public.response_evidence r where r.client_id = p_client_id and r.response_kind = 'bureau' and r.upload_status = 'received') as bureau_response_at,
      (select max(coalesce(r.reviewed_at, r.analyzed_at)) from public.response_evidence r where r.client_id = p_client_id and r.response_kind = 'bureau' and (r.analysis_status = 'analyzed' or r.review_status <> 'not_reviewed')) as bureau_review_at,
      (select max(p.created_at) from public.progress_updates p where p.client_id = p_client_id) as progress_at
  )
  select v.sequence, v.check_key, v.label, v.status, v.detail, v.evidence_at
  from facts f
  cross join lateral (values
    (1, 'onboarding', 'Portal onboarding completed',
      case when f.onboarding_complete then 'passed' else 'pending' end,
      case when f.onboarding_complete then 'Client completed the secure portal setup.' else 'Portal onboarding is not complete.' end,
      null::timestamptz),
    (2, 'agreement', 'Agreement and LPOA completed',
      case when f.agreement_signed and f.lpoa_signed then 'passed' else 'pending' end,
      case
        when f.agreement_signed and f.lpoa_signed then 'Both authorizations are recorded.'
        when not f.agreement_signed and not f.lpoa_signed then 'Service agreement and LPOA are still missing.'
        when not f.agreement_signed then 'Service agreement is still missing.'
        else 'LPOA is still missing.'
      end,
      null::timestamptz),
    (3, 'audit', 'Forensic audit completed',
      case when f.audit_at is not null then 'passed' else 'pending' end,
      case when f.audit_at is not null then 'A reviewed audit is stored for this client.' else 'No completed audit is stored yet.' end,
      f.audit_at),
    (4, 'blueprint_approved', 'Recovery Blueprint approved',
      case when f.blueprint_at is not null then 'passed' else 'pending' end,
      case when f.blueprint_at is not null then 'An immutable approved PDF is archived.' else 'No approved Recovery Blueprint exists yet.' end,
      f.blueprint_at),
    (5, 'blueprint_delivered', 'Recovery Blueprint email delivered',
      case when f.blueprint_delivered_at is not null then 'passed' else 'pending' end,
      case when f.blueprint_delivered_at is not null then 'SendGrid confirmed delivery.' else 'No SendGrid delivered event is recorded yet.' end,
      f.blueprint_delivered_at),
    (6, 'blueprint_viewed', 'Recovery Blueprint opened in portal',
      case when f.blueprint_viewed_at is not null then 'passed' else 'pending' end,
      case when f.blueprint_viewed_at is not null then 'The client opened the archived PDF in the portal.' else 'The client has not opened the Blueprint in the portal yet.' end,
      f.blueprint_viewed_at),
    (7, 'phase1_generated', 'Phase 1 generated and reviewed',
      case when f.phase1_at is not null then 'passed' else 'pending' end,
      case when f.phase1_at is not null then 'At least one Phase 1 campaign letter is stored.' else 'No Phase 1 letter is stored yet.' end,
      f.phase1_at),
    (8, 'phase1_delivered', 'Phase 1 delivered by Lob',
      case when f.phase1_delivered_at is not null then 'passed' else 'pending' end,
      case when f.phase1_delivered_at is not null then 'A Phase 1 delivery timestamp starts the response clock.' else 'No Phase 1 delivery timestamp is recorded yet.' end,
      f.phase1_delivered_at),
    (9, 'furnisher_response', 'Furnisher response path verified',
      case when f.furnisher_analysis_at is not null or f.phase3_at is not null then 'passed' else 'pending' end,
      case
        when f.furnisher_analysis_at is not null then 'A furnisher response was uploaded and analyzed.'
        when f.phase3_at is not null then 'The no-response path advanced successfully to Phase 3.'
        when f.furnisher_response_at is not null then 'A response is uploaded but has not completed analysis.'
        else 'Neither the response nor documented no-response path has completed.'
      end,
      coalesce(f.furnisher_analysis_at, f.phase3_at, f.furnisher_response_at)),
    (10, 'phase3_generated', 'Phase 3 generated with evidence',
      case when f.phase3_at is not null then 'passed' else 'pending' end,
      case when f.phase3_at is not null then 'At least one bureau-directed Phase 3 letter is stored.' else 'No Phase 3 letter is stored yet.' end,
      f.phase3_at),
    (11, 'phase3_delivered', 'Phase 3 delivered by Lob',
      case when f.phase3_delivered_at is not null then 'passed' else 'pending' end,
      case when f.phase3_delivered_at is not null then 'A bureau delivery timestamp starts the CRA response clock.' else 'No Phase 3 delivery timestamp is recorded yet.' end,
      f.phase3_delivered_at),
    (12, 'bureau_response', 'Bureau response analyzed and reviewed',
      case when f.bureau_review_at is not null then 'passed' else 'pending' end,
      case
        when f.bureau_review_at is not null then 'The bureau response path reached staff review.'
        when f.bureau_response_at is not null then 'A bureau response is uploaded but review is incomplete.'
        else 'No completed bureau-response review is recorded yet.'
      end,
      coalesce(f.bureau_review_at, f.bureau_response_at)),
    (13, 'progress_diff', 'Updated report and progress comparison completed',
      case when f.audit_count >= 2 and f.progress_at is not null then 'passed' else 'pending' end,
      case
        when f.audit_count >= 2 and f.progress_at is not null then 'A later report was compared with the prior audit.'
        when f.audit_count < 2 then 'A second audit is required before progress can be compared.'
        else 'Multiple audits exist, but no progress comparison is stored.'
      end,
      f.progress_at)
  ) as v(sequence, check_key, label, status, detail, evidence_at)
  order by v.sequence;
end;
$$;

revoke all on function public.get_client_production_readiness(uuid) from public;
grant execute on function public.get_client_production_readiness(uuid) to authenticated;

comment on function public.get_client_production_readiness(uuid) is
  'Admin-only evidence checklist for certifying one client through the complete CCC production lifecycle.';
