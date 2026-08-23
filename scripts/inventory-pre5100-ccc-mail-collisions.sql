-- READ ONLY. Run this before migration 20260820510000 if that migration reports
-- ambiguous durable CCC mail evidence. Preserve every source record; reconcile
-- only against verified Lob/provider history, then rerun this inventory.
with durable_letters as (
  select
    letter.id as letter_id,
    letter.user_id,
    letter.client_id,
    letter.ccc_account_track_snapshots,
    letter.lob_id as letter_lob_id,
    letter.mailed_date,
    submission.id as mail_submission_id,
    submission.status as submission_status,
    submission.lob_id as submission_lob_id
  from public.letters letter
  left join public.mail_submissions submission on submission.letter_id = letter.id
  where coalesce(letter.phase, '') like 'CCC Dispute —%'
    and (
      letter.lob_id is not null
      or letter.mailed_date is not null
      or submission.status in ('submitted', 'accepted_unreconciled')
    )
), valid_expanded as (
  select durable.*, snapshot.value as snapshot
  from durable_letters durable
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
      then durable.ccc_account_track_snapshots else '[]'::jsonb end
  ) snapshot(value)
  where coalesce(snapshot.value->>'trackId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(snapshot.value->>'clientAccountId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(snapshot.value->>'revision', '') ~ '^[0-9]+$'
    and nullif(btrim(coalesce(snapshot.value->>'methodVersion', '')), '') is not null
), malformed as (
  select
    'MALFORMED_OR_DUPLICATE_TRACK_SNAPSHOT'::text as issue_code,
    durable.letter_id,
    durable.mail_submission_id,
    null::text as track_id,
    null::text as track_revision,
    'Durable send lacks an exact unique 1-to-5 track/revision snapshot.'::text as detail
  from durable_letters durable
  where coalesce(jsonb_typeof(durable.ccc_account_track_snapshots), 'null') <> 'array'
    or jsonb_array_length(
      case when jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
        then durable.ccc_account_track_snapshots else '[]'::jsonb end
    ) not between 1 and 5
    or exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
          then durable.ccc_account_track_snapshots else '[]'::jsonb end
      ) snapshot(value)
      where coalesce(snapshot.value->>'trackId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(snapshot.value->>'clientAccountId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(snapshot.value->>'revision', '') !~ '^[0-9]+$'
        or nullif(btrim(coalesce(snapshot.value->>'methodVersion', '')), '') is null
    )
    or (
      select count(*)
      from jsonb_array_elements(
        case when jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
          then durable.ccc_account_track_snapshots else '[]'::jsonb end
      ) snapshot(value)
    ) is distinct from (
      select count(distinct (snapshot.value->>'trackId') || ':' || (snapshot.value->>'revision'))
      from jsonb_array_elements(
        case when jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
          then durable.ccc_account_track_snapshots else '[]'::jsonb end
      ) snapshot(value)
    )
), provider_identity as (
  select
    case
      when durable.submission_status in ('submitted', 'accepted_unreconciled')
        and durable.submission_lob_id is null and durable.letter_lob_id is null
        then 'ACCEPTED_SUBMISSION_MISSING_LOB_ID'
      else 'PROVIDER_LOB_ID_CONFLICT'
    end::text as issue_code,
    durable.letter_id,
    durable.mail_submission_id,
    null::text as track_id,
    null::text as track_revision,
    'Provider acceptance identity is missing or disagrees between durable records.'::text as detail
  from durable_letters durable
  where (
      durable.submission_status in ('submitted', 'accepted_unreconciled')
      and durable.submission_lob_id is null
      and durable.letter_lob_id is null
    )
    or (
      durable.submission_lob_id is not null
      and durable.letter_lob_id is not null
      and durable.submission_lob_id is distinct from durable.letter_lob_id
    )
), track_identity as (
  select
    'TRACK_IDENTITY_MISMATCH'::text as issue_code,
    expanded.letter_id,
    expanded.mail_submission_id,
    expanded.snapshot->>'trackId' as track_id,
    expanded.snapshot->>'revision' as track_revision,
    'Historical track is missing or no longer matches owner, client, account, method, or revision.'::text as detail
  from valid_expanded expanded
  left join public.ccc_account_tracks track on track.id = (expanded.snapshot->>'trackId')::uuid
  where track.id is null
    or track.user_id is distinct from expanded.user_id
    or track.client_id is distinct from expanded.client_id
    or track.client_account_id is distinct from (expanded.snapshot->>'clientAccountId')::uuid
    or track.method_version is distinct from expanded.snapshot->>'methodVersion'
    or track.revision < (expanded.snapshot->>'revision')::integer
), collisions as (
  select
    'TRACK_REVISION_MULTIPLE_DURABLE_SENDS'::text as issue_code,
    min(expanded.letter_id) as letter_id,
    null::uuid as mail_submission_id,
    expanded.snapshot->>'trackId' as track_id,
    expanded.snapshot->>'revision' as track_revision,
    'Multiple durable letters: ' || string_agg(expanded.letter_id, ', ' order by expanded.letter_id) as detail
  from valid_expanded expanded
  group by expanded.snapshot->>'trackId', expanded.snapshot->>'revision'
  having count(distinct expanded.letter_id) > 1
)
select * from malformed
union all select * from provider_identity
union all select * from track_identity
union all select * from collisions
order by issue_code, letter_id, track_id, track_revision;
