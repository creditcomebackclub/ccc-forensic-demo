-- Release-blocking staff tenant isolation.
--
-- The baseline treated every admin/auditor profile as one global staff tenant
-- on these tables. The application ownership model is narrower: an auditor's
-- firm identity is auth.uid(), while admins may operate globally. Keep the
-- service role for trusted server workflows and keep the affiliate portal's
-- exact user_id self-read, but make every staff auditor path owner-scoped.

begin;

-- ---------------------------------------------------------------------------
-- Furnisher address book: direct firm ownership.
-- ---------------------------------------------------------------------------
alter table public.furnisher_addresses enable row level security;

drop policy if exists "furnisher_addresses_staff_all" on public.furnisher_addresses;
drop policy if exists "furnisher_addresses_staff_owner_scope" on public.furnisher_addresses;
create policy "furnisher_addresses_staff_owner_scope"
on public.furnisher_addresses
for all to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and furnisher_addresses.user_id = auth.uid()
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and furnisher_addresses.user_id = auth.uid()
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Canonical client accounts: direct firm ownership, plus an exact clients
-- join whenever client_id is present. Legacy name-only rows retain their
-- direct user_id owner; a mismatched/nonexistent client_id fails closed.
-- ---------------------------------------------------------------------------
alter table public.client_accounts enable row level security;

drop policy if exists "staff_all_client_accounts" on public.client_accounts;
drop policy if exists "client_accounts_staff_owner_scope" on public.client_accounts;
create policy "client_accounts_staff_owner_scope"
on public.client_accounts
for all to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and client_accounts.user_id = auth.uid()
          and (
            client_accounts.client_id is null
            or exists (
              select 1
              from public.clients client
              where client.id = client_accounts.client_id
                and client.user_id = client_accounts.user_id
                and client.user_id = auth.uid()
            )
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and client_accounts.user_id = auth.uid()
          and (
            client_accounts.client_id is null
            or exists (
              select 1
              from public.clients client
              where client.id = client_accounts.client_id
                and client.user_id = client_accounts.user_id
                and client.user_id = auth.uid()
            )
          )
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Raw response evidence: the direct firm key must agree with the immutable
-- letter owner and, when present, the exact client/account relationships.
-- Orphaned or cross-linked evidence stays admin-only instead of falling back
-- to client_name or another mutable label.
-- ---------------------------------------------------------------------------
alter table public.response_evidence enable row level security;

drop policy if exists "staff_all_response_evidence" on public.response_evidence;
drop policy if exists "response_evidence_staff_owner_scope" on public.response_evidence;
create policy "response_evidence_staff_owner_scope"
on public.response_evidence
for all to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and response_evidence.firm_user_id = auth.uid()
          and exists (
            select 1
            from public.letters letter
            where letter.id = response_evidence.letter_id
              and letter.user_id = response_evidence.firm_user_id
              and (
                response_evidence.client_id is null
                or (
                  letter.client_id = response_evidence.client_id
                  and exists (
                    select 1
                    from public.clients client
                    where client.id = response_evidence.client_id
                      and client.user_id = response_evidence.firm_user_id
                  )
                )
              )
              and (
                response_evidence.client_account_id is null
                or (
                  letter.client_account_id = response_evidence.client_account_id
                  and exists (
                    select 1
                    from public.client_accounts account
                    where account.id = response_evidence.client_account_id
                      and account.user_id = response_evidence.firm_user_id
                      and (
                        response_evidence.client_id is null
                        or account.client_id = response_evidence.client_id
                      )
                  )
                )
              )
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and response_evidence.firm_user_id = auth.uid()
          and exists (
            select 1
            from public.letters letter
            where letter.id = response_evidence.letter_id
              and letter.user_id = response_evidence.firm_user_id
              and (
                response_evidence.client_id is null
                or (
                  letter.client_id = response_evidence.client_id
                  and exists (
                    select 1
                    from public.clients client
                    where client.id = response_evidence.client_id
                      and client.user_id = response_evidence.firm_user_id
                  )
                )
              )
              and (
                response_evidence.client_account_id is null
                or (
                  letter.client_account_id = response_evidence.client_account_id
                  and exists (
                    select 1
                    from public.client_accounts account
                    where account.id = response_evidence.client_account_id
                      and account.user_id = response_evidence.firm_user_id
                      and (
                        response_evidence.client_id is null
                        or account.client_id = response_evidence.client_id
                      )
                  )
                )
              )
          )
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Per-account packet assessments: user_id alone is not a sufficient tenant
-- boundary because the original table allowed an authenticated caller to pair
-- that owned user_id with foreign evidence/coverage/account UUIDs. Bind the
-- entire graph. A consolidated packet's evidence.client_account_id is only the
-- legacy primary/first account, so per-account identity comes from the exact
-- coverage row rather than incorrectly requiring every assessment to equal it.
-- ---------------------------------------------------------------------------
alter table public.response_evidence_account_assessment enable row level security;

drop policy if exists "staff_manage_response_account_assessment"
  on public.response_evidence_account_assessment;
drop policy if exists "response_account_assessment_staff_owner_scope"
  on public.response_evidence_account_assessment;
create policy "response_account_assessment_staff_owner_scope"
on public.response_evidence_account_assessment
for all to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and response_evidence_account_assessment.user_id = auth.uid()
          and exists (
            select 1
            from public.response_evidence evidence
            join public.letter_account_coverage coverage
              on coverage.id = response_evidence_account_assessment.coverage_id
            join public.client_accounts account
              on account.id = response_evidence_account_assessment.client_account_id
            join public.clients client
              on client.id = coverage.client_id
            join public.dispute_rounds dispute_round
              on dispute_round.id = coverage.dispute_round_id
            where evidence.id = response_evidence_account_assessment.response_evidence_id
              and evidence.firm_user_id = response_evidence_account_assessment.user_id
              and evidence.letter_id = coverage.letter_id
              and evidence.client_id = coverage.client_id
              and coverage.user_id = response_evidence_account_assessment.user_id
              and coverage.client_account_id = response_evidence_account_assessment.client_account_id
              and account.user_id = response_evidence_account_assessment.user_id
              and account.client_id = coverage.client_id
              and client.user_id = response_evidence_account_assessment.user_id
              and dispute_round.user_id = response_evidence_account_assessment.user_id
              and dispute_round.client_id = coverage.client_id
              and dispute_round.client_account_id = response_evidence_account_assessment.client_account_id
          )
        )
      )
  )
)
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and response_evidence_account_assessment.user_id = auth.uid()
          and exists (
            select 1
            from public.response_evidence evidence
            join public.letter_account_coverage coverage
              on coverage.id = response_evidence_account_assessment.coverage_id
            join public.client_accounts account
              on account.id = response_evidence_account_assessment.client_account_id
            join public.clients client
              on client.id = coverage.client_id
            join public.dispute_rounds dispute_round
              on dispute_round.id = coverage.dispute_round_id
            where evidence.id = response_evidence_account_assessment.response_evidence_id
              and evidence.firm_user_id = response_evidence_account_assessment.user_id
              and evidence.letter_id = coverage.letter_id
              and evidence.client_id = coverage.client_id
              and coverage.user_id = response_evidence_account_assessment.user_id
              and coverage.client_account_id = response_evidence_account_assessment.client_account_id
              and account.user_id = response_evidence_account_assessment.user_id
              and account.client_id = coverage.client_id
              and client.user_id = response_evidence_account_assessment.user_id
              and dispute_round.user_id = response_evidence_account_assessment.user_id
              and dispute_round.client_id = coverage.client_id
              and dispute_round.client_account_id = response_evidence_account_assessment.client_account_id
          )
        )
      )
  )
);

-- The UI reads assessment rows directly but reviews them through this RPC.
-- Trusted ingestion remains service-role-owned. Revalidate and lock every
-- downstream row inside the SECURITY DEFINER boundary before mutating it.
create or replace function public.review_packet_account_assessment(
  p_assessment_id uuid,
  p_disposition text,
  p_next_action text,
  p_notes text default null,
  p_document_request text default null
)
returns public.response_evidence_account_assessment
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_assessment public.response_evidence_account_assessment%rowtype;
  v_evidence public.response_evidence%rowtype;
  v_coverage public.letter_account_coverage%rowtype;
  v_account public.client_accounts%rowtype;
  v_client public.clients%rowtype;
  v_round public.dispute_rounds%rowtype;
begin
  if v_caller is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role is null or v_role not in ('admin', 'auditor') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  if p_disposition is null or p_disposition not in (
    'corrected_deleted', 'verified', 'partial', 'needs_documents',
    'no_response', 'follow_up_eligible', 'resolved'
  ) then
    raise exception 'Invalid account disposition';
  end if;
  if p_next_action is null or p_next_action not in (
    'resolved', 'next_round', 'needs_documents', 'escalate'
  ) then
    raise exception 'Invalid next action';
  end if;
  if p_disposition in ('corrected_deleted', 'resolved') and p_next_action <> 'resolved' then
    raise exception 'A resolved disposition must use the resolved next action';
  end if;
  if p_disposition = 'needs_documents' and p_next_action <> 'needs_documents' then
    raise exception 'A document request must use the needs_documents next action';
  end if;
  if p_next_action = 'needs_documents' and nullif(btrim(p_document_request), '') is null then
    raise exception 'Enter the client-facing document request before approval';
  end if;
  if length(coalesce(p_document_request, '')) > 1000
     or length(coalesce(p_notes, '')) > 2000 then
    raise exception 'Packet review notes exceed the allowed length';
  end if;

  select * into v_assessment
  from public.response_evidence_account_assessment
  where id = p_assessment_id
    and (v_role = 'admin' or user_id = v_caller)
  for update;
  if not found then
    raise exception 'Packet account assessment not found';
  end if;

  select * into v_evidence
  from public.response_evidence
  where id = v_assessment.response_evidence_id
  for update;

  select * into v_coverage
  from public.letter_account_coverage
  where id = v_assessment.coverage_id
  for update;

  select * into v_account
  from public.client_accounts
  where id = v_assessment.client_account_id
  for update;

  select * into v_client
  from public.clients
  where id = v_coverage.client_id
  for update;

  select * into v_round
  from public.dispute_rounds
  where id = v_coverage.dispute_round_id
  for update;

  if (v_role = 'auditor' and v_assessment.user_id is distinct from v_caller)
     or v_evidence.id is null
     or v_coverage.id is null
     or v_account.id is null
     or v_client.id is null
     or v_round.id is null
     or v_evidence.firm_user_id is distinct from v_assessment.user_id
     or v_evidence.letter_id is distinct from v_coverage.letter_id
     or v_evidence.client_id is distinct from v_coverage.client_id
     or v_coverage.user_id is distinct from v_assessment.user_id
     or v_coverage.client_account_id is distinct from v_assessment.client_account_id
     or v_account.user_id is distinct from v_assessment.user_id
     or v_account.client_id is distinct from v_coverage.client_id
     or v_client.user_id is distinct from v_assessment.user_id
     or v_round.user_id is distinct from v_assessment.user_id
     or v_round.client_id is distinct from v_coverage.client_id
     or v_round.client_account_id is distinct from v_assessment.client_account_id then
    raise exception 'Not authorized for this packet account assessment'
      using errcode = '42501';
  end if;

  update public.response_evidence_account_assessment
  set disposition = p_disposition,
      next_action = p_next_action,
      staff_notes = nullif(btrim(p_notes), ''),
      review_status = 'reviewed',
      client_document_request = case
        when p_next_action = 'needs_documents' then btrim(p_document_request)
        else null
      end,
      reviewed_by = v_caller,
      reviewed_at = now(),
      updated_at = now()
  where id = v_assessment.id
    and user_id = v_assessment.user_id
    and response_evidence_id = v_evidence.id
    and coverage_id = v_coverage.id
    and client_account_id = v_account.id
  returning * into v_assessment;

  update public.letter_account_coverage
  set response_status = 'reviewed', updated_at = now()
  where id = v_coverage.id
    and user_id = v_assessment.user_id
    and client_id = v_client.id
    and client_account_id = v_account.id
    and dispute_round_id = v_round.id
    and letter_id = v_evidence.letter_id;

  if p_next_action <> 'needs_documents' then
    update public.dispute_rounds
    set status = 'closed',
        final_disposition = case p_next_action
          when 'resolved' then 'resolved'
          when 'escalate' then 'escalate'
          else 'next_round'
        end,
        final_notes = nullif(btrim(p_notes), ''),
        closed_at = now(),
        closed_by = v_caller,
        updated_at = now()
    where id = v_round.id
      and user_id = v_assessment.user_id
      and client_id = v_client.id
      and client_account_id = v_account.id
      and status = 'open';
  end if;

  if not exists (
    select 1
    from public.response_evidence_account_assessment sibling
    where sibling.response_evidence_id = v_evidence.id
      and sibling.user_id = v_assessment.user_id
      and sibling.review_status = 'not_reviewed'
  ) then
    update public.response_evidence
    set review_status = case
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_evidence.id
              and sibling.user_id = v_assessment.user_id
              and sibling.next_action = 'needs_documents'
          ) then 'needs_documents'
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_evidence.id
              and sibling.user_id = v_assessment.user_id
              and sibling.next_action = 'escalate'
          ) then 'escalated'
          when exists (
            select 1 from public.response_evidence_account_assessment sibling
            where sibling.response_evidence_id = v_evidence.id
              and sibling.user_id = v_assessment.user_id
              and sibling.next_action = 'next_round'
          ) then 'follow_up'
          else 'resolved'
        end,
        reviewed_by = v_caller,
        reviewed_at = now(),
        updated_at = now()
    where id = v_evidence.id
      and firm_user_id = v_assessment.user_id
      and letter_id = v_coverage.letter_id
      and client_id = v_client.id;
  end if;

  return v_assessment;
end;
$$;

revoke all on function public.review_packet_account_assessment(uuid, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_packet_account_assessment(uuid, text, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Phase 2 / bureau-response analysis jobs: retain browser create/poll for the
-- caller's own jobs, but require the exact owned letter. If an evidence FK is
-- present it must resolve to that same firm and letter. This retains legacy
-- response/nonresponse jobs with a null evidence FK without allowing a job to
-- point at another firm's evidence.
-- ---------------------------------------------------------------------------
alter table public.phase2_jobs enable row level security;

drop policy if exists "phase2_jobs_insert_own" on public.phase2_jobs;
drop policy if exists "phase2_jobs_select_own" on public.phase2_jobs;
drop policy if exists "phase2_jobs_insert_own_staff" on public.phase2_jobs;
drop policy if exists "phase2_jobs_select_own_staff" on public.phase2_jobs;
drop policy if exists "phase2_jobs_insert_staff_owner_scope" on public.phase2_jobs;
drop policy if exists "phase2_jobs_select_staff_owner_scope" on public.phase2_jobs;

create policy "phase2_jobs_insert_staff_owner_scope"
on public.phase2_jobs
for insert to authenticated
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and staff.role in ('admin', 'auditor')
      and phase2_jobs.user_id = auth.uid()
      and exists (
        select 1
        from public.letters letter
        where letter.id = phase2_jobs.letter_id
          and (
            staff.role = 'admin'
            or letter.user_id = phase2_jobs.user_id
          )
          and (
            phase2_jobs.response_evidence_id is null
            or exists (
              select 1
              from public.response_evidence evidence
              where evidence.id = phase2_jobs.response_evidence_id
                and evidence.firm_user_id = letter.user_id
                and evidence.letter_id = phase2_jobs.letter_id
            )
          )
      )
  )
);

create policy "phase2_jobs_select_staff_owner_scope"
on public.phase2_jobs
for select to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and phase2_jobs.user_id = auth.uid()
          and exists (
            select 1
            from public.letters letter
            where letter.id = phase2_jobs.letter_id
              and letter.user_id = phase2_jobs.user_id
          )
          and (
            phase2_jobs.response_evidence_id is null
            or exists (
              select 1
              from public.response_evidence evidence
              where evidence.id = phase2_jobs.response_evidence_id
                and evidence.firm_user_id = phase2_jobs.user_id
                and evidence.letter_id = phase2_jobs.letter_id
            )
          )
        )
      )
  )
);

-- ---------------------------------------------------------------------------
-- Affiliates: preserve the affiliate portal's exact user_id self-read. Staff
-- auditors see only affiliate records assigned to their owner_user_id; null
-- legacy ownership is deliberately admin-only.
-- ---------------------------------------------------------------------------
alter table public.affiliates enable row level security;

drop policy if exists "Admins can manage affiliates" on public.affiliates;
drop policy if exists "Affiliate select for auth lookup" on public.affiliates;
drop policy if exists "Affiliates can read own record" on public.affiliates;
drop policy if exists "Affiliates can update own user_id" on public.affiliates;
drop policy if exists "affiliate_select_own_or_matching_email" on public.affiliates;
drop policy if exists "affiliate_staff_read" on public.affiliates;
drop policy if exists "affiliate_read_own" on public.affiliates;

create policy "affiliate_staff_read"
on public.affiliates
for select to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and affiliates.owner_user_id = auth.uid()
        )
      )
  )
);

create policy "affiliate_read_own"
on public.affiliates
for select to authenticated
using (affiliates.user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Affiliate commission payouts (public.commission_payouts): auditors need an
-- exact three-way relationship. The affiliate owner and client firm must both
-- be the caller, and the client must still identify that same affiliate as its
-- referral source. Any null/orphan/mismatched link is admin-only.
-- ---------------------------------------------------------------------------
alter table public.commission_payouts enable row level security;

drop policy if exists "staff_all_commission_payouts" on public.commission_payouts;
drop policy if exists "commission_payout_staff_read" on public.commission_payouts;
drop policy if exists "commission_payout_owner_write" on public.commission_payouts;

create policy "commission_payout_staff_read"
on public.commission_payouts
for select to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and (
        staff.role = 'admin'
        or (
          staff.role = 'auditor'
          and exists (
            select 1
            from public.affiliates affiliate
            join public.clients client
              on client.id = commission_payouts.client_id
             and client.referred_by = affiliate.id
            where affiliate.id = commission_payouts.affiliate_id
              and affiliate.owner_user_id = auth.uid()
              and client.user_id = auth.uid()
          )
        )
      )
  )
);

-- Payout writes remain an admin-only browser action. The service role keeps
-- its direct table grant and BYPASSRLS behavior for trusted server workflows.
create policy "commission_payout_owner_write"
on public.commission_payouts
for all to authenticated
using (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and staff.role = 'admin'
  )
)
with check (
  exists (
    select 1
    from public.profiles staff
    where staff.id = auth.uid()
      and staff.role = 'admin'
  )
);

-- Remove the baseline's browser-wide ALL grants, then restore only the verbs
-- used by the current app. RLS remains the row boundary for authenticated
-- staff. Anonymous users receive no direct table privilege.
revoke all privileges on table public.furnisher_addresses from public, anon, authenticated;
revoke all privileges on table public.client_accounts from public, anon, authenticated;
revoke all privileges on table public.response_evidence from public, anon, authenticated;
revoke all privileges on table public.response_evidence_account_assessment from public, anon, authenticated;
revoke all privileges on table public.phase2_jobs from public, anon, authenticated;
revoke all privileges on table public.affiliates from public, anon, authenticated;
revoke all privileges on table public.commission_payouts from public, anon, authenticated;

grant select, insert, update on table public.furnisher_addresses to authenticated;
grant select on table public.client_accounts to authenticated;
grant select, update on table public.response_evidence to authenticated;
grant select on table public.response_evidence_account_assessment to authenticated;
grant select, insert on table public.phase2_jobs to authenticated;
grant select on table public.affiliates to authenticated;
grant select, insert, update, delete on table public.commission_payouts to authenticated;

grant all privileges on table public.furnisher_addresses to service_role;
grant all privileges on table public.client_accounts to service_role;
grant all privileges on table public.response_evidence to service_role;
grant all privileges on table public.response_evidence_account_assessment to service_role;
grant all privileges on table public.phase2_jobs to service_role;
grant all privileges on table public.affiliates to service_role;
grant all privileges on table public.commission_payouts to service_role;

-- Deployment-time catalog probes. These checks run during every reset/deploy,
-- fail the migration on policy drift, and prove the intended privilege split
-- against the live database rather than only checking SQL source text.
do $$
declare
  target_table text;
  privilege_name text;
begin
  foreach target_table in array array[
    'furnisher_addresses',
    'client_accounts',
    'response_evidence',
    'response_evidence_account_assessment',
    'phase2_jobs',
    'affiliates',
    'commission_payouts'
  ] loop
    if not exists (
      select 1
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = target_table
        and relation.relrowsecurity
    ) then
      raise exception 'RLS must be enabled on public.%', target_table;
    end if;

    foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if pg_catalog.has_table_privilege('anon', 'public.' || target_table, privilege_name) then
        raise exception 'anon retains % on public.%', privilege_name, target_table;
      end if;
      if not pg_catalog.has_table_privilege('service_role', 'public.' || target_table, privilege_name) then
        raise exception 'service_role is missing % on public.%', privilege_name, target_table;
      end if;
    end loop;
  end loop;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'furnisher_addresses'
      and policyname <> 'furnisher_addresses_staff_owner_scope'
  ) then raise exception 'Unexpected furnisher_addresses policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'client_accounts'
      and policyname <> 'client_accounts_staff_owner_scope'
  ) then raise exception 'Unexpected client_accounts policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'response_evidence'
      and policyname <> 'response_evidence_staff_owner_scope'
  ) then raise exception 'Unexpected response_evidence policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'response_evidence_account_assessment'
      and policyname <> 'response_account_assessment_staff_owner_scope'
  ) then raise exception 'Unexpected response_evidence_account_assessment policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'phase2_jobs'
      and policyname not in (
        'phase2_jobs_insert_staff_owner_scope',
        'phase2_jobs_select_staff_owner_scope'
      )
  ) then raise exception 'Unexpected phase2_jobs policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'affiliates'
      and policyname not in ('affiliate_staff_read', 'affiliate_read_own')
  ) then raise exception 'Unexpected affiliates policy remains'; end if;

  if exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'commission_payouts'
      and policyname not in ('commission_payout_staff_read', 'commission_payout_owner_write')
  ) then raise exception 'Unexpected commission_payouts policy remains'; end if;

  if pg_catalog.has_function_privilege(
    'anon',
    'public.review_packet_account_assessment(uuid,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'anon retains EXECUTE on review_packet_account_assessment';
  end if;
  if not pg_catalog.has_function_privilege(
    'authenticated',
    'public.review_packet_account_assessment(uuid,text,text,text,text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'service_role',
    'public.review_packet_account_assessment(uuid,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'review_packet_account_assessment executor grants are incomplete';
  end if;

  if not pg_catalog.has_table_privilege(
    'authenticated',
    'public.response_evidence_account_assessment',
    'SELECT'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.response_evidence_account_assessment',
    'INSERT'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.response_evidence_account_assessment',
    'UPDATE'
  ) or pg_catalog.has_table_privilege(
    'authenticated',
    'public.response_evidence_account_assessment',
    'DELETE'
  ) then
    raise exception 'assessment browser privileges must be SELECT-only';
  end if;

  -- Preserve every existing row, but stop the release rather than silently
  -- carrying a cross-tenant assessment graph into the hardened RPC.
  if exists (
    select 1
    from public.response_evidence_account_assessment assessment
    left join public.response_evidence evidence
      on evidence.id = assessment.response_evidence_id
    left join public.letter_account_coverage coverage
      on coverage.id = assessment.coverage_id
    left join public.client_accounts account
      on account.id = assessment.client_account_id
    left join public.clients client
      on client.id = coverage.client_id
    left join public.dispute_rounds dispute_round
      on dispute_round.id = coverage.dispute_round_id
    where evidence.id is null
       or coverage.id is null
       or account.id is null
       or client.id is null
       or dispute_round.id is null
       or evidence.firm_user_id is distinct from assessment.user_id
       or evidence.letter_id is distinct from coverage.letter_id
       or evidence.client_id is distinct from coverage.client_id
       or coverage.user_id is distinct from assessment.user_id
       or coverage.client_account_id is distinct from assessment.client_account_id
       or account.user_id is distinct from assessment.user_id
       or account.client_id is distinct from coverage.client_id
       or client.user_id is distinct from assessment.user_id
       or dispute_round.user_id is distinct from assessment.user_id
       or dispute_round.client_id is distinct from coverage.client_id
       or dispute_round.client_account_id is distinct from assessment.client_account_id
  ) then
    raise exception 'Cross-tenant response account assessment graph requires manual remediation';
  end if;
end;
$$;

commit;

-- Rollback: restore the immediately preceding policies/grants from
-- 20260727070500_ai_job_staff_rls.sql and
-- 20260820380000_affiliate_agreement_onboarding.sql plus the baseline policies
-- for furnisher_addresses/client_accounts/response_evidence and the prior
-- assessment policy/function from 20260814160000. No rows or columns are
-- added, changed, or deleted by this migration.
