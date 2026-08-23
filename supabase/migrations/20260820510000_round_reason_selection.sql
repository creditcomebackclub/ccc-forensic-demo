-- Additive reason-selection contract for current CCC CRA letters. Historical
-- snapshots without reasonSelectionVersion remain readable. New versioned
-- snapshots are bounded, shape-checked, and immutable; mail-time code re-proves
-- every selected reason against ccc_account_tracks.source_audit_snapshot.

create or replace function public.ccc_round_reason_snapshot_valid_or_legacy(p_snapshot jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when coalesce(pg_catalog.jsonb_typeof(p_snapshot), 'null') <> 'array' then false
    when not exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_snapshot) item(value)
      where item.value ? 'reasonSelectionVersion'
    ) then true
    when pg_catalog.jsonb_array_length(p_snapshot) not between 1 and 5
      or pg_catalog.pg_column_size(p_snapshot) > 262144 then false
    when exists (
      select 1
      from pg_catalog.jsonb_array_elements(p_snapshot) item(value)
      where coalesce(pg_catalog.jsonb_typeof(item.value), 'null') <> 'object'
        or item.value->>'reasonSelectionVersion' is distinct from '1'
        or coalesce(item.value->>'clientAccountId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or item.value->>'accountKey' is distinct from 'client-account:' || (item.value->>'clientAccountId')
        or nullif(pg_catalog.btrim(coalesce(item.value->>'furnisher', '')), '') is null
        or pg_catalog.length(item.value->>'furnisher') > 500
        or (
          not (item.value ? 'accountNumberMasked')
          or coalesce(pg_catalog.jsonb_typeof(item.value->'accountNumberMasked'), 'missing') not in ('null', 'string')
          or (
            pg_catalog.jsonb_typeof(item.value->'accountNumberMasked') = 'string'
            and coalesce(item.value->>'accountNumberMasked', '') !~ '^\*{4}[A-Za-z0-9]{4}$'
          )
        )
        or coalesce(pg_catalog.jsonb_typeof(item.value->'selectedReasons'), 'null') <> 'array'
        or pg_catalog.jsonb_array_length(
          case when pg_catalog.jsonb_typeof(item.value->'selectedReasons') = 'array'
            then item.value->'selectedReasons' else '[]'::jsonb end
        ) not between 1 and 20
        or coalesce(pg_catalog.jsonb_typeof(item.value->'internalStaffInstructions'), 'null') <> 'string'
        or pg_catalog.length(item.value->>'internalStaffInstructions') > 1200
        or pg_catalog.length(item.value->>'internalStaffInstructions') between 1 and 7
        or item.value->>'internalStaffInstructions' is distinct from pg_catalog.btrim(item.value->>'internalStaffInstructions')
        or exists (
          select 1
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(item.value->'selectedReasons') = 'array'
              then item.value->'selectedReasons' else '[]'::jsonb end
          ) reason(value)
          where coalesce(pg_catalog.jsonb_typeof(reason.value), 'null') <> 'object'
            or nullif(pg_catalog.btrim(coalesce(reason.value->>'reasonId', '')), '') is null
            or nullif(pg_catalog.btrim(coalesce(reason.value->>'ruleId', '')), '') is null
            or nullif(pg_catalog.btrim(coalesce(reason.value->>'issue', '')), '') is null
            or coalesce(pg_catalog.jsonb_typeof(reason.value->'evidenceRefs'), 'null') <> 'array'
            or pg_catalog.jsonb_array_length(
              case when pg_catalog.jsonb_typeof(reason.value->'evidenceRefs') = 'array'
                then reason.value->'evidenceRefs' else '[]'::jsonb end
            ) = 0
            or exists (
              select 1
              from pg_catalog.jsonb_array_elements(
                case when pg_catalog.jsonb_typeof(reason.value->'evidenceRefs') = 'array'
                  then reason.value->'evidenceRefs' else '[]'::jsonb end
              ) evidence(value)
              where coalesce(pg_catalog.jsonb_typeof(evidence.value), 'null') <> 'object'
                or evidence.value->>'bureauCode' not in ('EQ', 'EXP', 'TU')
            )
        )
        or (
          select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(item.value->'selectedReasons') = 'array'
              then item.value->'selectedReasons' else '[]'::jsonb end
          ) reason(value)
        ) <> (
          select pg_catalog.count(distinct reason.value->>'reasonId')
          from pg_catalog.jsonb_array_elements(
            case when pg_catalog.jsonb_typeof(item.value->'selectedReasons') = 'array'
              then item.value->'selectedReasons' else '[]'::jsonb end
          ) reason(value)
        )
    ) then false
    when (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(p_snapshot) item(value)
    ) <> (
      select pg_catalog.count(distinct item.value->>'clientAccountId')
      from pg_catalog.jsonb_array_elements(p_snapshot) item(value)
    ) then false
    else true
  end
$$;

revoke all on function public.ccc_round_reason_snapshot_valid_or_legacy(jsonb) from public;
grant execute on function public.ccc_round_reason_snapshot_valid_or_legacy(jsonb) to authenticated, service_role;

alter table public.letters
  drop constraint if exists letters_round_reason_snapshot_shape,
  add constraint letters_round_reason_snapshot_shape
    check (public.ccc_round_reason_snapshot_valid_or_legacy(dispute_account_snapshot)) not valid;

comment on column public.letters.dispute_account_snapshot is
  'Historical account evidence or, for reasonSelectionVersion=1, the exact 1-to-5 selected accounts, deterministic reasons/source refs, and private staff instructions frozen for one physical CCC letter.';

create or replace function public.protect_saved_ccc_round_reason_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.dispute_account_snapshot is distinct from new.dispute_account_snapshot
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(old.dispute_account_snapshot) = 'array'
          then old.dispute_account_snapshot else '[]'::jsonb end
      ) item(value)
      where item.value ? 'reasonSelectionVersion'
    ) then
    raise exception 'A saved CCC account/reason snapshot is immutable. Create a new letter revision.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_saved_ccc_round_reason_snapshot_trigger on public.letters;
create trigger protect_saved_ccc_round_reason_snapshot_trigger
before update on public.letters
for each row execute function public.protect_saved_ccc_round_reason_snapshot();

-- Bind one provider idempotency generation to one byte-exact Lob request.
-- Historical rows inherit their original creation timestamp; a nullable hash
-- deliberately means that no exact request was captured before this cutover.
alter table public.mail_submissions
  add column if not exists lob_request_sha256 text,
  add column if not exists idempotency_created_at timestamptz;

update public.mail_submissions
set idempotency_created_at = created_at
where idempotency_created_at is null;

alter table public.mail_submissions
  alter column idempotency_created_at set default now(),
  alter column idempotency_created_at set not null,
  drop constraint if exists mail_submissions_lob_request_sha256_shape,
  add constraint mail_submissions_lob_request_sha256_shape
    check (lob_request_sha256 is null or lob_request_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.mail_submissions.lob_request_sha256 is
  'SHA-256 of the exact JSON bytes sent to Lob for this idempotency-key generation. A different request may never reuse the key.';
comment on column public.mail_submissions.idempotency_created_at is
  'Server timestamp for the current Lob idempotency-key generation. Pending generations older than 24 hours require manual reconciliation.';

-- Pre-cutover accepted/mail evidence has no 5100 claim row. Inventory every
-- such CCC letter before backfill and abort rather than guessing whenever the
-- saved track revision or provider identity is ambiguous. The companion
-- scripts/inventory-pre5100-ccc-mail-collisions.sql query is safe to run before
-- this migration and prints the records that need operator reconciliation.
create or replace view public.ccc_pre5100_mail_inventory
with (security_invoker = true)
as
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
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
      then durable.ccc_account_track_snapshots else '[]'::jsonb end
  ) snapshot(value)
  where coalesce(snapshot.value->>'trackId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(snapshot.value->>'clientAccountId', '')
      ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and coalesce(snapshot.value->>'revision', '') ~ '^[0-9]+$'
    and nullif(pg_catalog.btrim(coalesce(snapshot.value->>'methodVersion', '')), '') is not null
), malformed as (
  select
    'MALFORMED_OR_DUPLICATE_TRACK_SNAPSHOT'::text as issue_code,
    durable.letter_id,
    durable.mail_submission_id,
    null::text as track_id,
    null::text as track_revision,
    'A durable pre-5100 CCC send does not have an exact unique 1-to-5 track/revision snapshot.'::text as detail
  from durable_letters durable
  where coalesce(pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots), 'null') <> 'array'
    or pg_catalog.jsonb_array_length(
      case when pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
        then durable.ccc_account_track_snapshots else '[]'::jsonb end
    ) not between 1 and 5
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
          then durable.ccc_account_track_snapshots else '[]'::jsonb end
      ) snapshot(value)
      where coalesce(snapshot.value->>'trackId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(snapshot.value->>'clientAccountId', '')
          !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or coalesce(snapshot.value->>'revision', '') !~ '^[0-9]+$'
        or nullif(pg_catalog.btrim(coalesce(snapshot.value->>'methodVersion', '')), '') is null
    )
    or (
      select pg_catalog.count(*)
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
          then durable.ccc_account_track_snapshots else '[]'::jsonb end
      ) snapshot(value)
    ) is distinct from (
      select pg_catalog.count(distinct (snapshot.value->>'trackId') || ':' || (snapshot.value->>'revision'))
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(durable.ccc_account_track_snapshots) = 'array'
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
    'Provider acceptance evidence is missing or disagrees between the letter and durable submission.'::text as detail
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
    'The historical track is missing or no longer matches the saved owner, client, account, method, or minimum revision.'::text as detail
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
    pg_catalog.min(expanded.letter_id) as letter_id,
    null::uuid as mail_submission_id,
    expanded.snapshot->>'trackId' as track_id,
    expanded.snapshot->>'revision' as track_revision,
    'Multiple durable pre-5100 letters reference this same track revision: '
      || pg_catalog.string_agg(expanded.letter_id, ', ' order by expanded.letter_id) as detail
  from valid_expanded expanded
  group by expanded.snapshot->>'trackId', expanded.snapshot->>'revision'
  having pg_catalog.count(distinct expanded.letter_id) > 1
)
select * from malformed
union all select * from provider_identity
union all select * from track_identity
union all select * from collisions;

revoke all on public.ccc_pre5100_mail_inventory from public, anon, authenticated;
grant select on public.ccc_pre5100_mail_inventory to service_role;

do $$
declare
  v_inventory text;
begin
  select pg_catalog.string_agg(
    issue.issue_code || ' letter=' || coalesce(issue.letter_id, '<none>')
      || ' track=' || coalesce(issue.track_id, '<none>')
      || ' revision=' || coalesce(issue.track_revision, '<none>'),
    '; ' order by issue.issue_code, issue.letter_id
  ) into v_inventory
  from (
    select * from public.ccc_pre5100_mail_inventory
    order by issue_code, letter_id
    limit 25
  ) issue;

  if v_inventory is not null then
    raise exception using
      errcode = 'P0001',
      message = '5100 blocked: ambiguous durable pre-cutover CCC mail evidence must be reconciled before claims can be enabled.',
      detail = v_inventory,
      hint = 'Run scripts/inventory-pre5100-ccc-mail-collisions.sql, preserve the original evidence, and correct only verified source records before rerunning this migration.';
  end if;
end;
$$;

create table if not exists public.ccc_track_revision_prior_sends (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ccc_account_tracks(id) on delete restrict,
  track_revision integer not null check (track_revision >= 0),
  user_id uuid not null references auth.users(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  method_version text not null,
  letter_id text not null,
  mail_submission_id uuid references public.mail_submissions(id) on delete restrict,
  provider_lob_id text,
  evidence_snapshot jsonb not null check (pg_catalog.jsonb_typeof(evidence_snapshot) = 'object'),
  recorded_at timestamptz not null default now(),
  unique (track_id, track_revision),
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete restrict
);

insert into public.ccc_track_revision_prior_sends (
  track_id, track_revision, user_id, client_id, client_account_id, method_version,
  letter_id, mail_submission_id, provider_lob_id, evidence_snapshot
)
select
  track.id,
  (snapshot.value->>'revision')::integer,
  letter.user_id,
  letter.client_id,
  track.client_account_id,
  track.method_version,
  letter.id,
  submission.id,
  coalesce(submission.lob_id, letter.lob_id),
  pg_catalog.jsonb_build_object(
    'version', 1,
    'source', 'pre-5100-durable-send',
    'letterLobId', letter.lob_id,
    'letterMailedDate', letter.mailed_date,
    'submissionId', submission.id,
    'submissionStatus', submission.status,
    'submissionLobId', submission.lob_id,
    'trackSnapshot', snapshot.value
  )
from public.letters letter
left join public.mail_submissions submission on submission.letter_id = letter.id
cross join lateral pg_catalog.jsonb_array_elements(letter.ccc_account_track_snapshots) snapshot(value)
join public.ccc_account_tracks track on track.id = (snapshot.value->>'trackId')::uuid
where coalesce(letter.phase, '') like 'CCC Dispute —%'
  and (
    letter.lob_id is not null
    or letter.mailed_date is not null
    or submission.status in ('submitted', 'accepted_unreconciled')
  );

comment on table public.ccc_track_revision_prior_sends is
  'Immutable fail-closed barrier for exact account-track revisions with durable mail/acceptance evidence before the 5100 claim protocol existed.';

alter table public.ccc_track_revision_prior_sends enable row level security;
revoke all on public.ccc_track_revision_prior_sends from public, anon, authenticated, service_role;
grant select on public.ccc_track_revision_prior_sends to authenticated, service_role;

drop policy if exists "staff_read_ccc_track_revision_prior_sends" on public.ccc_track_revision_prior_sends;
create policy "staff_read_ccc_track_revision_prior_sends"
on public.ccc_track_revision_prior_sends for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or public.ccc_track_revision_prior_sends.user_id = auth.uid())
  )
);

create or replace function public.protect_ccc_track_revision_prior_send()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Pre-5100 CCC mail history is immutable.';
end;
$$;

drop trigger if exists protect_ccc_track_revision_prior_send_trigger on public.ccc_track_revision_prior_sends;
create trigger protect_ccc_track_revision_prior_send_trigger
before update or delete on public.ccc_track_revision_prior_sends
for each row execute function public.protect_ccc_track_revision_prior_send();

-- One account-track revision may be represented by only one durable physical
-- mail attempt. This closes the gap left by letter-level Lob idempotency: two
-- separately saved drafts must not each buy postage for the same account
-- round before either request advances the track.
create table if not exists public.ccc_track_revision_mail_claims (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null,
  track_revision integer not null check (track_revision >= 0),
  user_id uuid not null references auth.users(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  method_version text not null check (length(btrim(method_version)) between 1 and 100),
  track_scope text not null check (track_scope in ('cra', 'direct')),
  bureau_code text check (
    (track_scope = 'cra' and bureau_code in ('EQ', 'EXP', 'TU'))
    or (track_scope = 'direct' and bureau_code is null)
  ),
  letter_id text not null,
  mail_submission_id uuid not null references public.mail_submissions(id) on delete restrict,
  letter_html_sha256 text not null check (letter_html_sha256 ~ '^[0-9a-f]{64}$'),
  mailpiece_sha256 text not null check (mailpiece_sha256 ~ '^[0-9a-f]{64}$'),
  lob_request_sha256 text not null check (lob_request_sha256 ~ '^[0-9a-f]{64}$'),
  lob_idempotency_key text not null check (length(btrim(lob_idempotency_key)) between 1 and 256),
  lob_idempotency_created_at timestamptz not null,
  attachment_manifest jsonb not null default '[]'::jsonb check (
    jsonb_typeof(attachment_manifest) = 'array'
    and pg_column_size(attachment_manifest) <= 262144
  ),
  recipient_snapshot jsonb not null check (
    jsonb_typeof(recipient_snapshot) = 'object'
    and recipient_snapshot->>'version' = '1'
    and coalesce(recipient_snapshot->>'addressKey', '') <> ''
    and length(recipient_snapshot->>'addressKey') <= 1000
  ),
  claim_status text not null default 'active' check (claim_status in ('active', 'released')),
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  release_reason text check (release_reason in ('lob_rejected_preaccept', 'pre_lob_integrity_failure', 'signed_cancelled')),
  check (
    (claim_status = 'active' and released_at is null and release_reason is null)
    or (claim_status = 'released' and released_at is not null and release_reason is not null)
  ),
  foreign key (track_id, user_id, client_id, client_account_id, method_version)
    references public.ccc_account_tracks(id, user_id, client_id, client_account_id, method_version) on delete restrict,
  foreign key (user_id, letter_id) references public.letters(user_id, id) on delete restrict
);

create unique index if not exists ccc_track_revision_one_active_mail_claim
  on public.ccc_track_revision_mail_claims(track_id, track_revision)
  where claim_status = 'active';

comment on table public.ccc_track_revision_mail_claims is
  'Server-owned claim history proving which durable letter submission owns postage for an exact CCC account-track revision. Only an explicit pre-accept rejection or signed cancellation may release an active claim.';
comment on column public.ccc_track_revision_mail_claims.mailpiece_sha256 is
  'SHA-256 of the exact final packet layout after ephemeral signed tokens are replaced by ordered path/SHA/byte identities.';
comment on column public.ccc_track_revision_mail_claims.attachment_manifest is
  'Ordered all-exhibit manifest for screenshots, R1 identity evidence, and optional enclosures; active rows lock these source objects against browser mutation.';
comment on column public.ccc_track_revision_mail_claims.lob_request_sha256 is
  'SHA-256 of the exact JSON body handed to Lob for this immutable idempotency-key generation.';

alter table public.ccc_track_revision_mail_claims enable row level security;
revoke all on public.ccc_track_revision_mail_claims from public, anon, authenticated, service_role;
grant select on public.ccc_track_revision_mail_claims to authenticated;
grant select on public.ccc_track_revision_mail_claims to service_role;

drop policy if exists "staff_read_ccc_track_revision_mail_claims" on public.ccc_track_revision_mail_claims;
create policy "staff_read_ccc_track_revision_mail_claims"
on public.ccc_track_revision_mail_claims for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or public.ccc_track_revision_mail_claims.user_id = auth.uid())
  )
);

-- Lob fetches linked packet images after accepting the HTML. Once the exact
-- account-round claim exists, authenticated browsers must not replace, delete,
-- or recreate any source object in the all-exhibit manifest while Lob may be
-- rendering it. The service role remains the trusted server boundary and RLS
-- continues to be bypassed only there.
create or replace function public.ccc_storage_object_has_active_mail_claim(
  p_bucket text,
  p_name text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ccc_track_revision_mail_claims claim
    cross join lateral pg_catalog.jsonb_array_elements(claim.attachment_manifest) asset(value)
    where claim.claim_status = 'active'
      and asset.value->>'bucket' = p_bucket
      and asset.value->>'storagePath' = p_name
  )
$$;

revoke all on function public.ccc_storage_object_has_active_mail_claim(text, text) from public;
grant execute on function public.ccc_storage_object_has_active_mail_claim(text, text) to authenticated, service_role;

drop policy if exists "active_ccc_claim_blocks_packet_asset_insert" on storage.objects;
create policy "active_ccc_claim_blocks_packet_asset_insert"
on storage.objects as restrictive for insert to authenticated
with check (not public.ccc_storage_object_has_active_mail_claim(bucket_id, name));

drop policy if exists "active_ccc_claim_blocks_packet_asset_update" on storage.objects;
create policy "active_ccc_claim_blocks_packet_asset_update"
on storage.objects as restrictive for update to authenticated
using (not public.ccc_storage_object_has_active_mail_claim(bucket_id, name))
with check (not public.ccc_storage_object_has_active_mail_claim(bucket_id, name));

drop policy if exists "active_ccc_claim_blocks_packet_asset_delete" on storage.objects;
create policy "active_ccc_claim_blocks_packet_asset_delete"
on storage.objects as restrictive for delete to authenticated
using (not public.ccc_storage_object_has_active_mail_claim(bucket_id, name));

create or replace function public.protect_ccc_track_revision_mail_claim()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'CCC track-revision mail claim history cannot be deleted';
  end if;
  if old.claim_status = 'active'
    and new.claim_status = 'released'
    and (old.id, old.track_id, old.track_revision, old.user_id, old.client_id,
      old.client_account_id, old.method_version, old.track_scope, old.bureau_code,
      old.letter_id, old.mail_submission_id, old.letter_html_sha256,
      old.mailpiece_sha256, old.lob_request_sha256, old.lob_idempotency_key,
      old.lob_idempotency_created_at, old.attachment_manifest, old.recipient_snapshot, old.claimed_at)
      is not distinct from
      (new.id, new.track_id, new.track_revision, new.user_id, new.client_id,
      new.client_account_id, new.method_version, new.track_scope, new.bureau_code,
      new.letter_id, new.mail_submission_id, new.letter_html_sha256,
      new.mailpiece_sha256, new.lob_request_sha256, new.lob_idempotency_key,
      new.lob_idempotency_created_at, new.attachment_manifest, new.recipient_snapshot, new.claimed_at)
    and new.released_at is not null
    and new.release_reason in ('lob_rejected_preaccept', 'pre_lob_integrity_failure', 'signed_cancelled') then
    return new;
  end if;
  raise exception 'CCC track-revision mail claim history is immutable except for an authorized release transition';
end;
$$;

drop trigger if exists protect_ccc_track_revision_mail_claim_trigger on public.ccc_track_revision_mail_claims;
create trigger protect_ccc_track_revision_mail_claim_trigger
before update or delete on public.ccc_track_revision_mail_claims
for each row execute function public.protect_ccc_track_revision_mail_claim();

-- The RPC both rechecks and locks current tracks before claiming them. The
-- Netlify service is the only caller; browser roles cannot manufacture or
-- release a claim. The entire 1-to-5 account packet succeeds or rolls back.
drop function if exists public.claim_ccc_track_revisions_for_mail(text, uuid, jsonb, jsonb, text, jsonb, jsonb);

create or replace function public.claim_ccc_track_revisions_for_mail(
  p_letter_id text,
  p_mail_submission_id uuid,
  p_track_snapshots jsonb,
  p_expected_letter_snapshot jsonb,
  p_mailpiece_sha256 text,
  p_lob_request_sha256 text,
  p_attachment_manifest jsonb,
  p_recipient_snapshot jsonb
)
returns setof public.ccc_track_revision_mail_claims
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mail_submissions%rowtype;
  v_letter public.letters%rowtype;
  v_template public.dispute_templates%rowtype;
  v_direct_recipient public.furnisher_addresses%rowtype;
  v_expected_count integer;
  v_matching_count integer;
  v_current_letter_snapshot jsonb;
  v_track_scope text;
  v_bureau_code text;
  v_expected_recipient_key text;
begin
  if coalesce(pg_catalog.jsonb_typeof(p_track_snapshots), 'null') <> 'array'
    or pg_catalog.jsonb_array_length(p_track_snapshots) not between 1 and 5 then
    raise exception 'A CCC physical mail claim requires between 1 and 5 track snapshots.';
  end if;

  if exists (
    select 1 from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    where coalesce(snapshot.value->>'trackId', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(snapshot.value->>'clientAccountId', '')
        !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(snapshot.value->>'revision', '') !~ '^[0-9]+$'
      or coalesce(snapshot.value->>'logicalRound', '') !~ '^[1-9][0-9]*$'
      or coalesce(snapshot.value->>'cycle', '') !~ '^[1-9][0-9]*$'
      or snapshot.value->>'trackScope' not in ('cra', 'direct')
      or nullif(pg_catalog.btrim(coalesce(snapshot.value->>'methodVersion', '')), '') is null
  ) then
    raise exception 'A CCC physical mail claim contains a malformed track snapshot.';
  end if;

  if coalesce(p_mailpiece_sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_lob_request_sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(pg_catalog.jsonb_typeof(p_attachment_manifest), 'null') <> 'array'
    or pg_catalog.pg_column_size(p_attachment_manifest) > 262144
    or coalesce(pg_catalog.jsonb_typeof(p_recipient_snapshot), 'null') <> 'object'
    or p_recipient_snapshot->>'version' is distinct from '1'
    or nullif(pg_catalog.btrim(coalesce(p_recipient_snapshot->>'addressKey', '')), '') is null
    or pg_catalog.length(p_recipient_snapshot->>'addressKey') > 1000 then
    raise exception 'The final CCC packet or recipient claim is malformed.';
  end if;
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_attachment_manifest) asset(value)
    where coalesce(pg_catalog.jsonb_typeof(asset.value), 'null') <> 'object'
      or asset.value->>'version' is distinct from '1'
      or coalesce(asset.value->>'order', '') !~ '^[1-9][0-9]*$'
      or asset.value->>'kind' not in ('screenshot', 'identity-id', 'identity-address', 'optional')
      or nullif(pg_catalog.btrim(coalesce(asset.value->>'id', '')), '') is null
      or asset.value->>'bucket' is distinct from 'documents'
      or nullif(pg_catalog.btrim(coalesce(asset.value->>'storagePath', '')), '') is null
      or asset.value->>'storagePath' ~ '(?:^|/)\.\.(?:/|$)|\\|[[:cntrl:]]'
      or coalesce(asset.value->>'sha256', '') !~ '^[0-9a-f]{64}$'
      or coalesce(asset.value->>'byteSize', '') !~ '^[1-9][0-9]*$'
  ) or (
    select pg_catalog.count(distinct asset.value->>'order')
    from pg_catalog.jsonb_array_elements(p_attachment_manifest) asset(value)
  ) <> pg_catalog.jsonb_array_length(p_attachment_manifest)
  or (
    select pg_catalog.count(distinct (asset.value->>'bucket') || pg_catalog.chr(31) || (asset.value->>'storagePath'))
    from pg_catalog.jsonb_array_elements(p_attachment_manifest) asset(value)
  ) <> pg_catalog.jsonb_array_length(p_attachment_manifest) then
    raise exception 'The all-exhibit CCC attachment manifest is malformed or duplicated.';
  end if;

  v_expected_count := pg_catalog.jsonb_array_length(p_track_snapshots);
  if (
    select pg_catalog.count(distinct snapshot.value->>'trackId')
    from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
  ) <> v_expected_count
  or (
    select pg_catalog.count(distinct snapshot.value->>'clientAccountId')
    from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
  ) <> v_expected_count then
    raise exception 'A CCC physical mail claim contains duplicate tracks or accounts.';
  end if;

  select * into v_submission
  from public.mail_submissions submission
  where submission.id = p_mail_submission_id
    and submission.letter_id = p_letter_id
  for update;
  if not found then raise exception 'The durable mail submission does not own this letter.'; end if;
  if v_submission.status is distinct from 'pending'
    or v_submission.lob_id is not null
    or v_submission.idempotency_created_at is null
    or v_submission.idempotency_created_at < pg_catalog.now() - interval '24 hours' then
    raise exception using
      errcode = 'P0001',
      message = 'The durable Lob attempt is accepted, uncertain, or older than 24 hours and requires manual reconciliation.';
  end if;
  if v_submission.lob_request_sha256 is not null
    and v_submission.lob_request_sha256 is distinct from p_lob_request_sha256 then
    raise exception using
      errcode = '23505',
      message = 'A different exact Lob request is already bound to this idempotency key.';
  end if;

  select * into v_letter
  from public.letters letter
  where letter.user_id = v_submission.user_id
    and letter.id = p_letter_id
  for share;
  if not found
    or v_letter.client_id is null
    or v_submission.client_id is distinct from v_letter.client_id
    or coalesce(v_letter.phase, '') not like 'CCC Dispute —%' then
    raise exception 'The durable submission is not bound to a current CCC letter.';
  end if;
  if v_letter.ccc_account_track_snapshots is distinct from p_track_snapshots then
    raise exception 'The claimed tracks do not exactly match the saved letter snapshot.';
  end if;

  if (
    select pg_catalog.count(distinct snapshot.value->>'trackScope')
    from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
  ) <> 1 then
    raise exception 'One physical CCC mail claim must use exactly one recipient scope.';
  end if;
  select snapshot.value->>'trackScope', nullif(snapshot.value->>'bureauCode', '')
  into v_track_scope, v_bureau_code
  from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
  limit 1;

  select * into v_template
  from public.dispute_templates template
  where template.id = v_letter.dispute_template_id
  for share;
  if not found
    or v_template.is_active is distinct from true
    or v_template.flow_code is distinct from v_letter.dispute_flow_code
    or v_template.round_number is distinct from v_letter.dispute_round_number
    or (
      v_template.bureau_code is distinct from 'ALL'
      and v_template.bureau_code is distinct from v_letter.dispute_bureau_code
    )
    or v_template.body_text is distinct from v_letter.dispute_template_snapshot then
    raise exception 'The bound CCC template changed or was retired before the physical mail claim.';
  end if;

  if v_track_scope = 'direct' then
    if v_expected_count <> 1
      or v_bureau_code is not null
      or v_letter.target_type is distinct from 'furnisher'
      or v_letter.target_bureau is not null
      or v_letter.dispute_bureau_code is not null
      or nullif(pg_catalog.btrim(coalesce(p_recipient_snapshot->>'furnisherKey', '')), '') is null then
      raise exception 'A Direct claim must bind one bureau-independent account and one verified furnisher recipient.';
    end if;
    select * into v_direct_recipient
    from public.furnisher_addresses recipient
    where recipient.user_id = v_letter.user_id
      and recipient.furnisher_key = p_recipient_snapshot->>'furnisherKey'
    for share;
    if not found or p_recipient_snapshot->>'addressKey' is distinct from
      pg_catalog.concat_ws('|',
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(v_direct_recipient.display_name), '[^a-zA-Z0-9]+', '', 'g')),
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(v_direct_recipient.address_line1), '[^a-zA-Z0-9]+', '', 'g')),
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(coalesce(v_direct_recipient.address_line2, '')), '[^a-zA-Z0-9]+', '', 'g')),
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(v_direct_recipient.city), '[^a-zA-Z0-9]+', '', 'g')),
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(v_direct_recipient.state), '[^a-zA-Z0-9]+', '', 'g')),
        pg_catalog.lower(pg_catalog.regexp_replace(pg_catalog.btrim(v_direct_recipient.zip), '[^a-zA-Z0-9]+', '', 'g'))
      ) then
      raise exception 'The verified Direct recipient changed before the physical mail claim.';
    end if;
  elsif v_track_scope = 'cra' then
    if (
      select pg_catalog.count(distinct nullif(snapshot.value->>'bureauCode', ''))
      from pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    ) <> 1
      or v_bureau_code not in ('EQ', 'EXP', 'TU')
      or v_letter.target_type is distinct from 'bureau'
      or v_letter.dispute_bureau_code is distinct from v_bureau_code
      or nullif(pg_catalog.btrim(coalesce(p_recipient_snapshot->>'furnisherKey', '')), '') is not null then
      raise exception 'A CRA claim must bind one exact bureau and its fixed recipient.';
    end if;
    v_expected_recipient_key := case v_bureau_code
      when 'EQ' then 'equifaxinformationservicesllc|pobox740256||atlanta|ga|303740256'
      when 'EXP' then 'experianinformationsolutionsinc|pobox4500||allen|tx|75013'
      when 'TU' then 'transunionllc|pobox2000||chester|pa|19016'
      else null
    end;
    if v_letter.target_bureau is distinct from (case v_bureau_code
        when 'EQ' then 'equifax'
        when 'EXP' then 'experian'
        when 'TU' then 'transunion'
        else null
      end)
      or p_recipient_snapshot->>'addressKey' is distinct from v_expected_recipient_key then
      raise exception 'The fixed CRA recipient does not match the exact bound bureau.';
    end if;
  else
    raise exception 'The CCC recipient scope is unsupported.';
  end if;
  if coalesce(pg_catalog.jsonb_typeof(p_expected_letter_snapshot), 'null') <> 'object'
    or pg_catalog.pg_column_size(p_expected_letter_snapshot) > 1048576
    or coalesce(p_expected_letter_snapshot->>'htmlSha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'The expected printable-letter claim snapshot is invalid.';
  end if;
  v_current_letter_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'htmlSha256', pg_catalog.encode(
      extensions.digest(pg_catalog.convert_to(coalesce(v_letter.html, ''), 'UTF8'), 'sha256'),
      'hex'
    ),
    'phase', v_letter.phase,
    'clientId', v_letter.client_id,
    'clientAccountId', v_letter.client_account_id,
    'clientName', v_letter.client_name,
    'accountId', v_letter.account_id,
    'furnisher', v_letter.furnisher,
    'targetType', v_letter.target_type,
    'targetBureau', v_letter.target_bureau,
    'coveredFurnishers', v_letter.covered_furnishers,
    'disputeTemplateId', v_letter.dispute_template_id,
    'disputeFlowCode', v_letter.dispute_flow_code,
    'disputeRoundNumber', v_letter.dispute_round_number,
    'disputeBureauCode', v_letter.dispute_bureau_code,
    'disputeTemplateSnapshot', v_letter.dispute_template_snapshot,
    'disputeEditableSections', v_letter.dispute_editable_sections,
    'disputeAccountSnapshot', v_letter.dispute_account_snapshot,
    'cccAccountTrackSnapshots', v_letter.ccc_account_track_snapshots,
    'cccLetterIdentitySnapshot', v_letter.ccc_letter_identity_snapshot,
    'disputeAutomaticValuesSnapshot', v_letter.dispute_automatic_values_snapshot,
    'disputeScreenshotPolicySnapshot', v_letter.dispute_screenshot_policy_snapshot,
    'disputeScreenshotManifest', v_letter.dispute_screenshot_manifest
  );
  if v_current_letter_snapshot is distinct from p_expected_letter_snapshot then
    raise exception 'The printable CCC letter changed before its physical mail claim.';
  end if;

  -- Serialize competing sends on the current track rows, then repeat the
  -- exact state comparison at the claim boundary immediately before Lob.
  perform track.id
  from public.ccc_account_tracks track
  join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    on track.id = (snapshot.value->>'trackId')::uuid
  order by track.id
  for update of track;

  select pg_catalog.count(*) into v_matching_count
  from public.ccc_account_tracks track
  join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    on track.id = (snapshot.value->>'trackId')::uuid
  where track.user_id = v_submission.user_id
    and track.client_id = v_letter.client_id
    and track.client_account_id = (snapshot.value->>'clientAccountId')::uuid
    and track.revision = (snapshot.value->>'revision')::integer
    and track.method_version = snapshot.value->>'methodVersion'
    and track.track_scope = snapshot.value->>'trackScope'
    and track.bureau_code is not distinct from nullif(snapshot.value->>'bureauCode', '')
    and track.account_kind = snapshot.value->>'accountKind'
    and track.native_flow = snapshot.value->>'nativeFlow'
    and track.current_flow = snapshot.value->>'logicalFlow'
    and track.current_round = (snapshot.value->>'logicalRound')::integer
    and track.cycle = (snapshot.value->>'cycle')::integer
    and track.path_role = snapshot.value->>'pathRole'
    and track.status = 'active';
  if v_matching_count <> v_expected_count then
    raise exception 'One or more CCC account tracks changed before the physical mail claim.';
  end if;

  if exists (
    select 1
    from public.ccc_track_revision_prior_sends prior_send
    join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
      on prior_send.track_id = (snapshot.value->>'trackId')::uuid
      and prior_send.track_revision = (snapshot.value->>'revision')::integer
  ) then
    raise exception using
      errcode = '23505',
      message = 'One or more selected account rounds already has durable pre-cutover mail evidence. No new postage was purchased.';
  end if;

  if exists (
    select 1
    from public.ccc_track_revision_mail_claims claim
    join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
      on claim.track_id = (snapshot.value->>'trackId')::uuid
      and claim.track_revision = (snapshot.value->>'revision')::integer
    where claim.claim_status = 'active'
      and (
        claim.letter_id is distinct from p_letter_id
        or claim.mail_submission_id is distinct from p_mail_submission_id
        or claim.letter_html_sha256 is distinct from p_expected_letter_snapshot->>'htmlSha256'
        or claim.mailpiece_sha256 is distinct from p_mailpiece_sha256
        or claim.lob_request_sha256 is distinct from p_lob_request_sha256
        or claim.lob_idempotency_key is distinct from v_submission.idempotency_key
        or claim.lob_idempotency_created_at is distinct from v_submission.idempotency_created_at
        or claim.attachment_manifest is distinct from p_attachment_manifest
        or claim.recipient_snapshot is distinct from p_recipient_snapshot
      )
  ) then
    raise exception using
      errcode = '23505',
      message = 'A different saved letter already owns physical mail for one or more selected account rounds.';
  end if;

  insert into public.ccc_track_revision_mail_claims (
    track_id, track_revision, user_id, client_id, client_account_id,
    method_version, track_scope, bureau_code, letter_id, mail_submission_id, letter_html_sha256
    , mailpiece_sha256, lob_request_sha256, lob_idempotency_key,
    lob_idempotency_created_at, attachment_manifest, recipient_snapshot
  )
  select
    track.id,
    track.revision,
    track.user_id,
    track.client_id,
    track.client_account_id,
    track.method_version,
    track.track_scope,
    track.bureau_code,
    p_letter_id,
    p_mail_submission_id,
    p_expected_letter_snapshot->>'htmlSha256',
    p_mailpiece_sha256,
    p_lob_request_sha256,
    v_submission.idempotency_key,
    v_submission.idempotency_created_at,
    p_attachment_manifest,
    p_recipient_snapshot
  from public.ccc_account_tracks track
  join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    on track.id = (snapshot.value->>'trackId')::uuid
  where not exists (
    select 1 from public.ccc_track_revision_mail_claims existing
    where existing.track_id = track.id
      and existing.track_revision = track.revision
      and existing.claim_status = 'active'
  );

  if (
    select pg_catalog.count(*)
    from public.ccc_track_revision_mail_claims claim
    join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
      on claim.track_id = (snapshot.value->>'trackId')::uuid
      and claim.track_revision = (snapshot.value->>'revision')::integer
    where claim.letter_id = p_letter_id
      and claim.mail_submission_id = p_mail_submission_id
      and claim.claim_status = 'active'
      and claim.letter_html_sha256 = p_expected_letter_snapshot->>'htmlSha256'
      and claim.mailpiece_sha256 = p_mailpiece_sha256
      and claim.lob_request_sha256 = p_lob_request_sha256
      and claim.lob_idempotency_key = v_submission.idempotency_key
      and claim.lob_idempotency_created_at = v_submission.idempotency_created_at
      and claim.attachment_manifest = p_attachment_manifest
      and claim.recipient_snapshot = p_recipient_snapshot
  ) <> v_expected_count then
    raise exception using
      errcode = '23505',
      message = 'A different saved letter already owns physical mail for one or more selected account rounds.';
  end if;

  update public.mail_submissions submission
  set lob_request_sha256 = p_lob_request_sha256,
      updated_at = pg_catalog.now()
  where submission.id = p_mail_submission_id
    and submission.letter_id = p_letter_id
    and submission.status = 'pending'
    and submission.lob_id is null
    and submission.idempotency_key = v_submission.idempotency_key
    and submission.idempotency_created_at = v_submission.idempotency_created_at
    and (
      submission.lob_request_sha256 is null
      or submission.lob_request_sha256 = p_lob_request_sha256
    );
  if not found then
    raise exception 'The exact Lob request binding changed before the physical mail claim completed.';
  end if;

  return query
  select claim.*
  from public.ccc_track_revision_mail_claims claim
  join pg_catalog.jsonb_array_elements(p_track_snapshots) snapshot(value)
    on claim.track_id = (snapshot.value->>'trackId')::uuid
    and claim.track_revision = (snapshot.value->>'revision')::integer
  where claim.claim_status = 'active'
    and claim.letter_id = p_letter_id
    and claim.mail_submission_id = p_mail_submission_id
  order by claim.track_id;
end;
$$;

revoke all on function public.claim_ccc_track_revisions_for_mail(text, uuid, jsonb, jsonb, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.claim_ccc_track_revisions_for_mail(text, uuid, jsonb, jsonb, text, text, jsonb, jsonb) to service_role;

-- Release is deliberately narrower than "retry": it only records that an
-- accepted physical send can no longer occur for the active claim. The
-- durable submission/webhook state is re-proved under lock, and the released
-- row remains as history. A subsequent corrected packet must acquire a new
-- active claim before Lob can be called.
create or replace function public.release_ccc_track_revision_mail_claims(
  p_letter_id text,
  p_mail_submission_id uuid,
  p_release_reason text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.mail_submissions%rowtype;
  v_letter public.letters%rowtype;
  v_released_count integer;
  v_active_count integer;
  v_rejection_code text;
begin
  if p_release_reason not in ('lob_rejected_preaccept', 'pre_lob_integrity_failure', 'signed_cancelled') then
    raise exception 'Unsupported CCC physical-mail claim release reason.';
  end if;

  select * into v_submission
  from public.mail_submissions submission
  where submission.id = p_mail_submission_id
    and submission.letter_id = p_letter_id
  for update;
  if not found then raise exception 'The durable mail submission does not own this letter.'; end if;

  select * into v_letter
  from public.letters letter
  where letter.user_id = v_submission.user_id
    and letter.id = p_letter_id
  for update;
  if not found then raise exception 'The claimed CCC letter no longer exists.'; end if;

  select pg_catalog.count(*) into v_active_count
  from public.ccc_track_revision_mail_claims claim
  where claim.letter_id = p_letter_id
    and claim.mail_submission_id = p_mail_submission_id
    and claim.claim_status = 'active';
  if v_active_count = 0 then
    raise exception 'The exact CCC letter/submission has no active account-round claim to release.';
  end if;
  if v_submission.lob_request_sha256 is null or exists (
    select 1
    from public.ccc_track_revision_mail_claims claim
    where claim.letter_id = p_letter_id
      and claim.mail_submission_id = p_mail_submission_id
      and claim.claim_status = 'active'
      and (
        claim.lob_request_sha256 is distinct from v_submission.lob_request_sha256
        or claim.lob_idempotency_key is distinct from v_submission.idempotency_key
        or claim.lob_idempotency_created_at is distinct from v_submission.idempotency_created_at
      )
  ) then
    raise exception 'The active CCC claim does not match the exact Lob request generation.';
  end if;

  if p_release_reason = 'lob_rejected_preaccept' then
    v_rejection_code := pg_catalog.split_part(coalesce(v_submission.last_error, ''), ':', 2);
    if not (
      v_submission.status = 'pending'
      and v_submission.lob_id is null
      and v_submission.submitted_at is null
      and v_submission.attempt_count >= 1
      and v_submission.last_attempt_at is not null
      and v_letter.lob_id is null
      and pg_catalog.split_part(coalesce(v_submission.last_error, ''), ':', 1) = 'LOB_PREACCEPT_REJECTED'
      and pg_catalog.split_part(coalesce(v_submission.last_error, ''), ':', 3) = v_submission.lob_request_sha256
      and v_rejection_code in (
        'ADDRESS_LENGTH_EXCEEDS_LIMIT',
        'FAILED_DELIVERABILITY_STRICTNESS',
        'FILE_PAGES_BELOW_MIN',
        'FILE_PAGES_EXCEED_MAX',
        'FILE_SIZE_EXCEEDS_LIMIT',
        'FOREIGN_RETURN_ADDRESS',
        'INCONSISTENT_PAGE_DIMENSIONS',
        'INVALID_FILE',
        'INVALID_FILE_DIMENSIONS',
        'INVALID_IMAGE_DPI',
        'INVALID_INTERNATIONAL_FEATURE',
        'INVALID_PERFORATION_RETURN_ENVELOPE',
        'INVALID_TEMPLATE_HTML',
        'MAIL_USE_TYPE_CAN_NOT_BE_NULL',
        'UNEMBEDDED_FONTS'
      )
    ) then
      raise exception 'Only an exact documented Lob pre-accept validation code may release this claim.';
    end if;
  elsif p_release_reason = 'pre_lob_integrity_failure' then
    if not (
      v_submission.status = 'pending'
      and v_submission.lob_id is null
      and v_submission.submitted_at is null
      and v_submission.attempt_count = 0
      and v_submission.last_attempt_at is null
      and v_letter.lob_id is null
      and pg_catalog.split_part(coalesce(v_submission.last_error, ''), ':', 1) = 'PRE_LOB_INTEGRITY_FAILURE'
      and pg_catalog.split_part(coalesce(v_submission.last_error, ''), ':', 2) = v_submission.lob_request_sha256
    ) then
      raise exception 'Only an exact never-submitted pre-Lob integrity failure may release this claim.';
    end if;
  elsif not (
    v_submission.status = 'cancelled'
    and v_submission.lob_id is not null
    and v_letter.lob_id = v_submission.lob_id
    and v_letter.tracking_status = 'Cancelled'
  ) then
    raise exception 'Only the exact signed cancelled Lob attempt may release this claim.';
  end if;

  update public.ccc_track_revision_mail_claims claim
  set claim_status = 'released', released_at = pg_catalog.now(), release_reason = p_release_reason
  where claim.letter_id = p_letter_id
    and claim.mail_submission_id = p_mail_submission_id
    and claim.claim_status = 'active';
  get diagnostics v_released_count = row_count;

  -- A corrected pre-Lob/pre-accept packet must never reuse the provider key
  -- or exact request hash that belongs to the released history row.
  if p_release_reason in ('lob_rejected_preaccept', 'pre_lob_integrity_failure') then
    update public.mail_submissions submission
    set idempotency_key = extensions.gen_random_uuid()::text,
        idempotency_created_at = pg_catalog.now(),
        lob_request_sha256 = null,
        status = 'pending',
        lob_id = null,
        tracking_number = null,
        attempt_count = 0,
        last_attempt_at = null,
        submitted_at = null,
        last_error = null,
        attachment_manifest = '[]'::jsonb,
        consumer_statement_text = null,
        consumer_statement_sha256 = null,
        consumer_statement_captured_at = null,
        updated_at = pg_catalog.now()
    where submission.id = p_mail_submission_id
      and submission.letter_id = p_letter_id
      and submission.idempotency_key = v_submission.idempotency_key
      and submission.lob_request_sha256 = v_submission.lob_request_sha256
      and submission.status = 'pending'
      and submission.lob_id is null;
    if not found then
      raise exception 'The released CCC attempt could not rotate to a fresh provider idempotency generation.';
    end if;
  end if;
  return v_released_count;
end;
$$;

revoke all on function public.release_ccc_track_revision_mail_claims(text, uuid, text) from public, anon, authenticated;
grant execute on function public.release_ccc_track_revision_mail_claims(text, uuid, text) to service_role;

-- Once a physical-mail claim exists, no tab may replace the printable record
-- while the server is sending the already-scanned bytes. Failed or uncertain
-- attempts retain the same frozen claim; only the guarded cancellation and
-- explicit pre-accept rejection transitions above can release it.
create or replace function public.protect_claimed_ccc_letter_printable_snapshot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.ccc_track_revision_mail_claims claim
    where claim.user_id = old.user_id and claim.letter_id = old.id
      and claim.claim_status = 'active'
  ) and (
    old.phase,
    old.client_id,
    old.client_account_id,
    old.client_name,
    old.account_id,
    old.furnisher,
    old.target_type,
    old.target_bureau,
    old.covered_furnishers,
    old.html,
    old.dispute_template_id,
    old.dispute_flow_code,
    old.dispute_round_number,
    old.dispute_bureau_code,
    old.dispute_template_snapshot,
    old.dispute_editable_sections,
    old.dispute_account_snapshot,
    old.ccc_account_track_snapshots,
    old.ccc_letter_identity_snapshot,
    old.dispute_automatic_values_snapshot,
    old.dispute_screenshot_policy_snapshot,
    old.dispute_screenshot_manifest
  ) is distinct from (
    new.phase,
    new.client_id,
    new.client_account_id,
    new.client_name,
    new.account_id,
    new.furnisher,
    new.target_type,
    new.target_bureau,
    new.covered_furnishers,
    new.html,
    new.dispute_template_id,
    new.dispute_flow_code,
    new.dispute_round_number,
    new.dispute_bureau_code,
    new.dispute_template_snapshot,
    new.dispute_editable_sections,
    new.dispute_account_snapshot,
    new.ccc_account_track_snapshots,
    new.ccc_letter_identity_snapshot,
    new.dispute_automatic_values_snapshot,
    new.dispute_screenshot_policy_snapshot,
    new.dispute_screenshot_manifest
  ) then
    raise exception 'A claimed CCC physical letter is immutable. Retry the same durable mail attempt.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_claimed_ccc_letter_printable_snapshot_trigger on public.letters;
create trigger protect_claimed_ccc_letter_printable_snapshot_trigger
before update on public.letters
for each row execute function public.protect_claimed_ccc_letter_printable_snapshot();
