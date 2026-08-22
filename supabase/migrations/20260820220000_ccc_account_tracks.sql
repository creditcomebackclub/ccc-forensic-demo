-- Additive, account-level state for the authoritative CCC Skool method.
-- Legacy letters and legacy round numbers remain historical only; initialization
-- accepts a fresh, reviewed classification snapshot and always starts at R1.

create table if not exists public.ccc_account_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  track_scope text not null default 'cra' check (track_scope in ('cra', 'direct')),
  bureau_code text check (bureau_code is null or bureau_code in ('EQ', 'EXP', 'TU')),
  method_version text not null default 'ccc_skool_2026_v1' check (length(btrim(method_version)) > 0),
  account_kind text not null check (account_kind in (
    'collection', 'repossession', 'charge_off', 'late_payment',
    'student_loan', 'bankruptcy', 'other'
  )),
  native_flow text not null check (native_flow in (
    'accuracy', 'collection', 'consent', 'late_pay', 'repo', 'direct'
  )),
  current_flow text not null check (current_flow in (
    'accuracy', 'collection', 'combo', 'consent', 'late_pay', 'repo', 'direct'
  )),
  current_round integer not null,
  path_role text not null default 'standard' check (path_role in (
    'standard', 'repo_primary', 'repo_companion'
  )),
  status text not null default 'active' check (status in (
    'pending', 'active', 'review_required', 'deleted', 'resolved'
  )),
  cycle integer not null default 1 check (cycle > 0),
  revision integer not null default 0 check (revision >= 0),
  used_native_rounds jsonb not null default '{}'::jsonb check (jsonb_typeof(used_native_rounds) = 'object'),
  source_audit_id text not null,
  source_audit_snapshot jsonb not null check (jsonb_typeof(source_audit_snapshot) = 'object'),
  classification_snapshot jsonb not null check (jsonb_typeof(classification_snapshot) = 'object'),
  activation_provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(activation_provenance) = 'object'),
  review_code text,
  review_reason text,
  initialized_by uuid not null references auth.users(id) on delete restrict,
  initialized_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (user_id, source_audit_id) references public.audits(user_id, id) on delete restrict,
  check (
    (current_flow in ('accuracy', 'combo') and current_round between 1 and 12)
    or (current_flow = 'collection' and current_round between 1 and 10)
    or (current_flow in ('consent', 'repo') and current_round between 1 and 3)
    or (current_flow in ('late_pay', 'direct') and current_round between 1 and 2)
  ),
  check (
    (track_scope = 'cra' and bureau_code is not null and native_flow <> 'direct' and current_flow <> 'direct')
    or (track_scope = 'direct' and bureau_code is null and native_flow = 'direct' and current_flow = 'direct' and path_role = 'standard')
  ),
  check (status <> 'pending' or track_scope = 'direct')
);

create unique index if not exists ccc_account_tracks_cra_uidx
  on public.ccc_account_tracks (user_id, client_account_id, bureau_code, method_version)
  where track_scope = 'cra';

create unique index if not exists ccc_account_tracks_direct_uidx
  on public.ccc_account_tracks (user_id, client_account_id, method_version)
  where track_scope = 'direct';

create index if not exists ccc_account_tracks_client_work_idx
  on public.ccc_account_tracks (user_id, client_id, status, bureau_code, current_flow, current_round);

create unique index if not exists ccc_account_tracks_event_identity_uidx
  on public.ccc_account_tracks (id, user_id, client_id, client_account_id, method_version);

comment on table public.ccc_account_tracks is
  'Server-owned account/bureau state for the CCC Skool flow. CRA rows are bureau-independent; Direct is a separate pending/active lifecycle.';
comment on column public.ccc_account_tracks.used_native_rounds is
  'Aggregate of native law rounds actually reached; immutable events preserve every before/after snapshot.';
comment on column public.ccc_account_tracks.activation_provenance is
  'Direct-track activation condition/evidence or rule provenance. It is never inferred from legacy campaign history.';

create table if not exists public.ccc_account_track_events (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null references public.ccc_account_tracks(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  client_account_id uuid not null references public.client_accounts(id) on delete restrict,
  bureau_code text check (bureau_code is null or bureau_code in ('EQ', 'EXP', 'TU')),
  method_version text not null,
  event_type text not null check (event_type in ('initialized', 'direct_activated', 'transitioned')),
  outcome text,
  transition_code text not null,
  rule_provenance text,
  from_revision integer,
  to_revision integer not null check (to_revision >= 0),
  before_state jsonb,
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  applied_law_coverage jsonb not null default '{}'::jsonb check (jsonb_typeof(applied_law_coverage) = 'object'),
  source_letter_id text,
  event_context jsonb not null default '{}'::jsonb check (jsonb_typeof(event_context) = 'object'),
  actor_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (track_id, user_id, client_id, client_account_id, method_version)
    references public.ccc_account_tracks(id, user_id, client_id, client_account_id, method_version) on delete restrict,
  foreign key (user_id, source_letter_id) references public.letters(user_id, id) on delete restrict,
  unique (track_id, to_revision),
  check (
    (event_type = 'initialized' and from_revision is null and to_revision = 0)
    or (event_type <> 'initialized' and from_revision is not null and to_revision = from_revision + 1)
  )
);

create index if not exists ccc_account_track_events_history_idx
  on public.ccc_account_track_events (track_id, to_revision, created_at);

comment on table public.ccc_account_track_events is
  'Append-only CCC account-state history, including exact law coverage and transition provenance.';

-- Owner-confirmed provisional Combo rule data. Future corrections add a new
-- method/rule version; old event snapshots are never rewritten.
create table if not exists public.ccc_combo_native_law_coverage (
  method_version text not null,
  combo_round integer not null check (combo_round between 1 and 12),
  native_flow text not null check (native_flow in ('accuracy', 'collection')),
  native_round integer not null,
  rule_provenance text not null,
  primary key (method_version, combo_round, native_flow),
  check (
    (native_flow = 'accuracy' and native_round between 1 and 12)
    or (native_flow = 'collection' and native_round between 1 and 10)
  )
);

insert into public.ccc_combo_native_law_coverage
  (method_version, combo_round, native_flow, native_round, rule_provenance)
values
  ('ccc_skool_2026_v1', 1, 'accuracy', 1, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 1, 'collection', 1, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 2, 'accuracy', 2, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 2, 'collection', 2, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 3, 'accuracy', 3, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 3, 'collection', 3, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 4, 'accuracy', 4, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 4, 'collection', 4, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 5, 'accuracy', 5, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 6, 'accuracy', 6, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 7, 'accuracy', 7, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 8, 'accuracy', 8, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 8, 'collection', 5, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 9, 'accuracy', 9, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 9, 'collection', 6, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 10, 'accuracy', 10, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 10, 'collection', 7, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 11, 'accuracy', 11, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 11, 'collection', 8, 'owner_confirmed_next_unused_native_v1_2026_08_20'),
  ('ccc_skool_2026_v1', 12, 'accuracy', 12, 'owner_confirmed_next_unused_native_v1_2026_08_20')
on conflict (method_version, combo_round, native_flow) do update
set native_round = excluded.native_round,
    rule_provenance = excluded.rule_provenance;

alter table public.ccc_account_tracks enable row level security;
alter table public.ccc_account_track_events enable row level security;
alter table public.ccc_combo_native_law_coverage enable row level security;

drop policy if exists "staff_read_ccc_account_tracks" on public.ccc_account_tracks;
create policy "staff_read_ccc_account_tracks"
on public.ccc_account_tracks for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or ccc_account_tracks.user_id = auth.uid())
  )
);

drop policy if exists "staff_read_ccc_account_track_events" on public.ccc_account_track_events;
create policy "staff_read_ccc_account_track_events"
on public.ccc_account_track_events for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or ccc_account_track_events.user_id = auth.uid())
  )
);

drop policy if exists "staff_read_ccc_combo_native_law_coverage" on public.ccc_combo_native_law_coverage;
create policy "staff_read_ccc_combo_native_law_coverage"
on public.ccc_combo_native_law_coverage for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid() and profile.role in ('admin', 'auditor')
  )
);

create or replace function public.prevent_ccc_account_track_event_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'CCC account-track events are immutable';
end;
$$;

drop trigger if exists protect_ccc_account_track_events on public.ccc_account_track_events;
create trigger protect_ccc_account_track_events
before update or delete on public.ccc_account_track_events
for each row execute function public.prevent_ccc_account_track_event_rewrite();

create or replace function public.prevent_ccc_account_track_identity_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.user_id, new.client_id, new.client_account_id, new.track_scope, new.bureau_code,
      new.method_version, new.account_kind, new.native_flow, new.path_role,
      new.source_audit_id, new.source_audit_snapshot, new.classification_snapshot,
      new.initialized_by, new.initialized_at)
     is distinct from
     (old.user_id, old.client_id, old.client_account_id, old.track_scope, old.bureau_code,
      old.method_version, old.account_kind, old.native_flow, old.path_role,
      old.source_audit_id, old.source_audit_snapshot, old.classification_snapshot,
      old.initialized_by, old.initialized_at) then
    raise exception 'Frozen CCC classification and tenant identity cannot be rewritten';
  end if;
  if new.revision <> old.revision + 1 then
    raise exception 'CCC account-track updates require exactly one revision step';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_ccc_account_track_identity on public.ccc_account_tracks;
create trigger protect_ccc_account_track_identity
before update on public.ccc_account_tracks
for each row execute function public.prevent_ccc_account_track_identity_rewrite();

create or replace function public.ccc_add_used_native_round(
  p_history jsonb,
  p_flow text,
  p_round integer
)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_flow is null or p_round is null then coalesce(p_history, '{}'::jsonb)
    else jsonb_set(
      coalesce(p_history, '{}'::jsonb),
      array[p_flow],
      (
        select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
        from (
          select distinct value
          from (
            select jsonb_array_elements_text(coalesce(p_history->p_flow, '[]'::jsonb))::integer as value
            union all select p_round
          ) rounds
        ) unique_rounds
      ),
      true
    )
  end;
$$;

create or replace function public.ccc_concrete_template_step(p_flow text, p_round integer)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when p_flow = 'combo' and p_round between 5 and 7
      then jsonb_build_object('flow', 'accuracy', 'round', p_round)
    when p_flow = 'late_pay' and p_round = 2
      then jsonb_build_object('flow', 'consent', 'round', 2)
    when p_flow = 'repo' and p_round = 1
      then jsonb_build_object('flow', 'collection', 'round', 1)
    when p_flow = 'repo' and p_round = 2
      then jsonb_build_object('flow', 'collection', 'round', 2)
    when p_flow = 'repo' and p_round = 3
      then jsonb_build_object('flow', 'collection', 'round', 6)
    else jsonb_build_object('flow', p_flow, 'round', p_round)
  end;
$$;

create or replace function public.ccc_record_current_law_coverage(p_track public.ccc_account_tracks)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_history jsonb := coalesce(p_track.used_native_rounds, '{}'::jsonb);
  v_rule record;
  v_concrete jsonb;
begin
  if p_track.current_flow = 'combo' then
    for v_rule in
      select native_flow, native_round
      from public.ccc_combo_native_law_coverage
      where method_version = p_track.method_version and combo_round = p_track.current_round
    loop
      v_history := public.ccc_add_used_native_round(v_history, v_rule.native_flow, v_rule.native_round);
    end loop;
  else
    v_concrete := public.ccc_concrete_template_step(p_track.current_flow, p_track.current_round);
    v_history := public.ccc_add_used_native_round(v_history, v_concrete->>'flow', (v_concrete->>'round')::integer);
  end if;
  return v_history;
end;
$$;

create or replace function public.ccc_resolve_combo_side_transition(
  p_method_version text,
  p_used_native_rounds jsonb,
  p_deleted_side text
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_surviving_flow text;
  v_max integer;
  v_round integer;
begin
  v_surviving_flow := case p_deleted_side
    when 'accuracy' then 'collection'
    when 'collection' then 'accuracy'
    else null
  end;
  if v_surviving_flow is null then return null; end if;
  v_max := case v_surviving_flow when 'accuracy' then 12 else 10 end;
  select candidate into v_round
  from generate_series(1, v_max) as series(candidate)
  where not exists (
    select 1
    from jsonb_array_elements_text(coalesce(p_used_native_rounds->v_surviving_flow, '[]'::jsonb)) used(value)
    where used.value::integer = candidate
  )
  order by candidate
  limit 1;
  if v_round is null then return null; end if;
  return jsonb_build_object(
    'flow', v_surviving_flow,
    'round', v_round,
    'rule_provenance', 'owner_confirmed_next_unused_native_v1_2026_08_20',
    'method_version', p_method_version
  );
end;
$$;

create or replace function public.ccc_compute_next_account_state(
  p_track public.ccc_account_tracks,
  p_outcome text,
  p_context jsonb
)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_history jsonb := coalesce(p_track.used_native_rounds, '{}'::jsonb);
  v_next jsonb;
  v_join_round integer;
  v_deleted_side text;
begin
  if p_track.status in ('deleted', 'resolved') then
    raise exception 'Terminal CCC track cannot transition from %', p_track.status;
  end if;
  if p_outcome is null or p_outcome not in ('remains', 'deleted', 'resolved', 'combo_side_deleted') then
    raise exception 'Unsupported CCC transition outcome';
  end if;
  if p_track.status = 'pending' then
    return jsonb_build_object(
      'status', 'review_required', 'current_flow', p_track.current_flow,
      'current_round', p_track.current_round, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', 'review_required',
      'review_code', 'activation_required',
      'review_reason', 'This independent track has not reached its recorded activation condition.'
    );
  end if;
  v_history := public.ccc_record_current_law_coverage(p_track);
  if p_outcome in ('deleted', 'resolved') then
    return jsonb_build_object(
      'status', p_outcome, 'current_flow', p_track.current_flow,
      'current_round', p_track.current_round, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', p_outcome
    );
  end if;
  if p_outcome = 'combo_side_deleted' then
    if p_track.current_flow <> 'combo' then
      return jsonb_build_object(
        'status', 'review_required', 'current_flow', p_track.current_flow,
        'current_round', p_track.current_round, 'cycle', p_track.cycle,
        'used_native_rounds', v_history, 'transition_code', 'review_required',
        'review_code', 'invalid_combo_side_outcome',
        'review_reason', 'Combo-side deletion was reported for a non-Combo track.'
      );
    end if;
    v_deleted_side := lower(nullif(p_context->>'deleted_side', ''));
    v_next := public.ccc_resolve_combo_side_transition(p_track.method_version, v_history, v_deleted_side);
    if v_next is null then
      return jsonb_build_object(
        'status', 'review_required', 'current_flow', p_track.current_flow,
        'current_round', p_track.current_round, 'cycle', p_track.cycle,
        'used_native_rounds', v_history, 'transition_code', 'review_required',
        'review_code', 'combo_native_history_exhausted_or_invalid',
        'review_reason', 'The next unused native law could not be resolved from the immutable Combo history.'
      );
    end if;
    return jsonb_build_object(
      'status', 'active', 'current_flow', v_next->>'flow',
      'current_round', (v_next->>'round')::integer, 'cycle', p_track.cycle,
      'used_native_rounds', v_history, 'transition_code', 'combo_side_switch',
      'rule_provenance', v_next->>'rule_provenance'
    );
  end if;
  if p_track.current_flow = 'repo' then
    if p_track.current_round < 3 then
      return jsonb_build_object('status','active','current_flow','repo','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    if p_track.path_role = 'repo_companion' then
      return jsonb_build_object('status','active','current_flow','collection','current_round',4,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','repo_companion_to_collection');
    end if;
    if p_track.path_role = 'repo_primary' then
      v_join_round := coalesce(nullif(p_context->>'verified_accuracy_join_round','')::integer, 1);
      if v_join_round not between 1 and 12 then
        return jsonb_build_object('status','review_required','current_flow','repo','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','invalid_accuracy_join_round','review_reason','The verified Accuracy join round is invalid.');
      end if;
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',v_join_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code',case when v_join_round=1 then 'repo_to_accuracy_r1' else 'repo_join_accuracy' end);
    end if;
    return jsonb_build_object('status','review_required','current_flow','repo','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','invalid_repo_path_role','review_reason','Repo flow is missing its primary or companion role.');
  end if;
  if p_track.current_flow = 'collection' then
    if p_track.current_round < 10 then
      return jsonb_build_object('status','active','current_flow','collection','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','active','current_flow','collection','current_round',1,'cycle',p_track.cycle+1,'used_native_rounds',v_history,'transition_code','collection_restart');
  end if;
  if p_track.current_flow = 'combo' then
    if p_track.current_round < 12 then
      return jsonb_build_object('status','active','current_flow','combo','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','active','current_flow','combo','current_round',1,'cycle',p_track.cycle+1,'used_native_rounds',v_history,'transition_code','combo_restart');
  end if;
  if p_track.current_flow = 'accuracy' then
    if p_track.current_round < 12 then
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','active','current_flow','consent','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','accuracy_to_consent');
  end if;
  if p_track.current_flow = 'late_pay' then
    if p_track.current_round = 1 then
      return jsonb_build_object('status','active','current_flow','late_pay','current_round',2,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    return jsonb_build_object('status','active','current_flow','accuracy','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','late_pay_to_accuracy');
  end if;
  if p_track.current_flow = 'consent' then
    if p_track.current_round < 3 then
      return jsonb_build_object('status','active','current_flow','consent','current_round',p_track.current_round+1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','advance');
    end if;
    if p_track.account_kind = 'collection' then
      return jsonb_build_object('status','active','current_flow','collection','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','consent_to_collection');
    end if;
    if p_track.account_kind in ('charge_off','late_payment') then
      return jsonb_build_object('status','active','current_flow','accuracy','current_round',1,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','consent_to_accuracy');
    end if;
    return jsonb_build_object('status','review_required','current_flow','consent','current_round',3,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','consent_account_kind_unconfirmed','review_reason','Consent R3 has no owner-confirmed switch for this account kind.');
  end if;
  if p_track.current_flow = 'direct' then
    return jsonb_build_object('status','review_required','current_flow','direct','current_round',p_track.current_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','direct_extension_unconfirmed','review_reason','Direct R1 is independent; automatic advancement is not confirmed by the supplied course material.','rule_provenance','direct_extension_pending_owner_confirmation');
  end if;
  return jsonb_build_object('status','review_required','current_flow',p_track.current_flow,'current_round',p_track.current_round,'cycle',p_track.cycle,'used_native_rounds',v_history,'transition_code','review_required','review_code','flow_transition_unconfirmed','review_reason','No confirmed transition exists for this flow.');
end;
$$;

create or replace function public.initialize_ccc_account_tracks(
  p_client_id uuid,
  p_audit_id text,
  p_classifications jsonb,
  p_method_version text default 'ccc_skool_2026_v1'
)
returns setof public.ccc_account_tracks
language plpgsql
security definer
set search_path = public
as $$
-- Contract: each classification must carry client_account_id from the saved
-- audit account's clientAccountId/client_account_id field. The RPC verifies
-- that canonical UUID against client_accounts and the exact audit snapshot;
-- there is intentionally no furnisher, account-number, or client-name fallback.
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_client public.clients%rowtype;
  v_audit public.audits%rowtype;
  v_item jsonb;
  v_peer jsonb;
  v_audit_account jsonb;
  v_account public.client_accounts%rowtype;
  v_account_id uuid;
  v_kind text;
  v_native_flow text;
  v_bureau text;
  v_has_repo boolean;
  v_has_accuracy boolean;
  v_has_collection boolean;
  v_current_flow text;
  v_path_role text;
  v_track public.ccc_account_tracks%rowtype;
  v_inserted boolean;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select role into v_role from public.profiles where id = v_caller;
  if v_role is null or v_role not in ('admin', 'auditor') then raise exception 'Staff access required' using errcode = '42501'; end if;
  if coalesce(jsonb_typeof(p_classifications), 'null') <> 'array' or jsonb_array_length(p_classifications) = 0 then
    raise exception 'Fresh reviewed classifications are required';
  end if;
  if pg_column_size(p_classifications) > 1048576
    or exists (
      select 1 from jsonb_array_elements(p_classifications) classification(value)
      where jsonb_typeof(classification.value) <> 'object'
    ) then raise exception 'Classifications must be a bounded array of objects'; end if;
  if nullif(btrim(p_method_version), '') is null then raise exception 'Method version is required'; end if;
  if p_method_version <> 'ccc_skool_2026_v1' then raise exception 'Unsupported CCC method version'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_classifications) item(value)
    group by item.value->>'client_account_id' having count(*) > 1
  ) then raise exception 'Each account may appear only once in a CCC initialization'; end if;

  select * into v_client from public.clients where id = p_client_id;
  if not found or (v_role is distinct from 'admin' and v_client.user_id is distinct from v_caller) then
    raise exception 'Client not found' using errcode = '42501';
  end if;
  select * into v_audit from public.audits
  where user_id = v_client.user_id and client_id = v_client.id and id = p_audit_id;
  if not found then raise exception 'The source audit does not belong to this client'; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_client.user_id::text || ':' || p_client_id::text || ':' || p_method_version, 0));

  for v_item in select value from jsonb_array_elements(p_classifications) loop
    v_account_id := nullif(v_item->>'client_account_id', '')::uuid;
    v_kind := lower(replace(coalesce(v_item->>'account_kind',''), '-', '_'));
    v_native_flow := lower(coalesce(v_item->>'native_flow',''));
    if v_kind not in ('collection','repossession','charge_off','late_payment','student_loan','bankruptcy','other') then
      raise exception 'Unsupported frozen account kind: %', v_kind;
    end if;
    if v_native_flow not in ('accuracy','collection','consent','late_pay','repo') then
      raise exception 'Direct/Combo cannot be supplied as a CRA-native classification';
    end if;
    if (v_kind = 'repossession') is distinct from (v_native_flow = 'repo') then
      raise exception 'Repossession must use the independent Repo native flow';
    end if;
    if coalesce(jsonb_typeof(v_item->'bureaus'), 'null') <> 'array' or jsonb_array_length(v_item->'bureaus') = 0 then
      raise exception 'Every CRA classification requires at least one bureau';
    end if;
    if exists (
      select 1 from jsonb_array_elements_text(v_item->'bureaus') bureau(value)
      where bureau.value not in ('EQ','EXP','TU')
    ) then
      raise exception 'Unknown bureau in CCC classification';
    end if;

    select * into v_account from public.client_accounts
    where id = v_account_id and user_id = v_client.user_id and client_id = v_client.id;
    if not found or v_account.needs_review then
      raise exception 'Account identity is missing or requires reconciliation';
    end if;
    select source.value into v_audit_account
    from jsonb_array_elements(coalesce(v_audit.audit->'accounts','[]'::jsonb)) source
    where coalesce(source.value->>'clientAccountId', source.value->>'client_account_id') = v_account_id::text
    limit 1;
    if v_audit_account is null then raise exception 'Classified account is not present in the source audit'; end if;

    for v_bureau in select value from jsonb_array_elements_text(v_item->'bureaus') loop
      if not (coalesce(v_audit_account->'bureaus','[]'::jsonb) ? v_bureau) then
        raise exception 'Classified bureau % is not active in the frozen audit account', v_bureau;
      end if;
      select exists (
        select 1 from jsonb_array_elements(p_classifications) peer(value)
        where peer.value->>'native_flow' = 'repo' and coalesce(peer.value->'bureaus','[]'::jsonb) ? v_bureau
      ) into v_has_repo;
      select exists (
        select 1 from jsonb_array_elements(p_classifications) peer(value)
        where peer.value->>'native_flow' = 'accuracy' and coalesce(peer.value->'bureaus','[]'::jsonb) ? v_bureau
      ) into v_has_accuracy;
      select exists (
        select 1 from jsonb_array_elements(p_classifications) peer(value)
        where peer.value->>'native_flow' = 'collection' and coalesce(peer.value->'bureaus','[]'::jsonb) ? v_bureau
      ) into v_has_collection;

      if v_native_flow = 'repo' then
        v_current_flow := 'repo'; v_path_role := 'repo_primary';
      elsif v_native_flow = 'collection' and v_has_repo then
        v_current_flow := 'repo'; v_path_role := 'repo_companion';
      elsif v_native_flow in ('accuracy','collection') and not v_has_repo and v_has_accuracy and v_has_collection then
        v_current_flow := 'combo'; v_path_role := 'standard';
      else
        v_current_flow := v_native_flow; v_path_role := 'standard';
      end if;

      v_inserted := false;
      insert into public.ccc_account_tracks (
        user_id, client_id, client_account_id, track_scope, bureau_code,
        method_version, account_kind, native_flow, current_flow, current_round,
        path_role, status, cycle, revision, used_native_rounds, source_audit_id,
        source_audit_snapshot, classification_snapshot, initialized_by
      ) values (
        v_client.user_id, v_client.id, v_account.id, 'cra', v_bureau,
        p_method_version, v_kind, v_native_flow, v_current_flow, 1,
        v_path_role, 'active', 1, 0, '{}'::jsonb, v_audit.id,
        v_audit_account, v_item, v_caller
      )
      on conflict (user_id, client_account_id, bureau_code, method_version) where track_scope = 'cra'
      do nothing
      returning * into v_track;
      if found then
        v_inserted := true;
        insert into public.ccc_account_track_events (
          track_id,user_id,client_id,client_account_id,bureau_code,method_version,
          event_type,transition_code,from_revision,to_revision,after_state,event_context,actor_id
        ) values (
          v_track.id,v_track.user_id,v_track.client_id,v_track.client_account_id,v_track.bureau_code,v_track.method_version,
          'initialized','fresh_classification_r1',null,0,to_jsonb(v_track),jsonb_build_object('source_audit_id',v_audit.id),v_caller
        );
      else
        select * into v_track from public.ccc_account_tracks
        where user_id=v_client.user_id and client_account_id=v_account.id
          and bureau_code=v_bureau and method_version=p_method_version and track_scope='cra';
      end if;
    end loop;

    -- Direct debt verification is an explicitly independent extension. It is
    -- created only when the reviewed classification asks for it, and remains
    -- pending until a mailed Collection/Combo/Repo R1 source is verified.
    if coalesce((v_item->>'direct_track')::boolean, false) then
      if v_kind <> 'collection' then raise exception 'Direct debt verification is only confirmed for collection accounts'; end if;
      insert into public.ccc_account_tracks (
        user_id,client_id,client_account_id,track_scope,bureau_code,method_version,
        account_kind,native_flow,current_flow,current_round,path_role,status,cycle,
        revision,used_native_rounds,source_audit_id,source_audit_snapshot,
        classification_snapshot,activation_provenance,initialized_by
      ) values (
        v_client.user_id,v_client.id,v_account.id,'direct',null,p_method_version,
        v_kind,'direct','direct',1,'standard','pending',1,
        0,'{}'::jsonb,v_audit.id,v_audit_account,
        v_item,jsonb_build_object('condition','after_collection_r1_sent','rule_provenance','owner_confirmed_direct_independent_2026_08_20'),v_caller
      )
      on conflict (user_id,client_account_id,method_version) where track_scope='direct'
      do nothing
      returning * into v_track;
      if found then
        insert into public.ccc_account_track_events (
          track_id,user_id,client_id,client_account_id,bureau_code,method_version,
          event_type,transition_code,rule_provenance,from_revision,to_revision,
          after_state,event_context,actor_id
        ) values (
          v_track.id,v_track.user_id,v_track.client_id,v_track.client_account_id,null,v_track.method_version,
          'initialized','direct_pending_collection_r1','owner_confirmed_direct_independent_2026_08_20',null,0,
          to_jsonb(v_track),jsonb_build_object('source_audit_id',v_audit.id),v_caller
        );
      end if;
    end if;
  end loop;

  return query
  select * from public.ccc_account_tracks track
  where track.user_id=v_client.user_id and track.client_id=v_client.id and track.method_version=p_method_version
  order by track.track_scope, track.bureau_code nulls last, track.current_flow, track.client_account_id;
end;
$$;

create or replace function public.activate_ccc_direct_account_track(
  p_track_id uuid,
  p_expected_revision integer,
  p_source_cra_track_id uuid,
  p_source_letter_id text
)
returns public.ccc_account_tracks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_track public.ccc_account_tracks%rowtype;
  v_source public.ccc_account_tracks%rowtype;
  v_letter public.letters%rowtype;
  v_template public.dispute_templates%rowtype;
  v_before jsonb;
  v_bureau_slug text;
  v_letter_found boolean;
  v_initial_flow text;
  v_expected_template jsonb;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_role from public.profiles where id=v_caller;
  if v_role is null or v_role not in ('admin','auditor') then raise exception 'Staff access required' using errcode='42501'; end if;
  select * into v_track from public.ccc_account_tracks where id=p_track_id for update;
  if not found or (v_role is distinct from 'admin' and v_track.user_id is distinct from v_caller) then raise exception 'Direct track not found' using errcode='42501'; end if;
  if v_track.track_scope is distinct from 'direct' or v_track.status is distinct from 'pending' then raise exception 'Only a pending Direct track can be activated'; end if;
  if v_track.revision is distinct from p_expected_revision then raise exception 'CCC track revision conflict' using errcode='40001'; end if;
  select * into v_source from public.ccc_account_tracks where id=p_source_cra_track_id for share;
  if not found or v_source.track_scope is distinct from 'cra' or v_source.user_id is distinct from v_track.user_id
    or v_source.client_id is distinct from v_track.client_id or v_source.client_account_id is distinct from v_track.client_account_id
    or v_source.method_version is distinct from v_track.method_version
    or v_source.native_flow is null or v_source.native_flow not in ('collection','repo') then
    raise exception 'Direct activation source is not this account''s Collection/Repo CRA track';
  end if;
  select * into v_letter from public.letters where user_id=v_track.user_id and id=p_source_letter_id;
  v_letter_found := found;
  if v_letter_found and v_letter.dispute_template_id is not null then
    select * into v_template from public.dispute_templates where id=v_letter.dispute_template_id;
    if not found then raise exception 'Direct activation source template is missing'; end if;
  end if;
  select event.after_state->>'current_flow' into v_initial_flow
  from public.ccc_account_track_events event
  where event.track_id=v_source.id and event.event_type='initialized'
  order by event.to_revision limit 1;
  if v_initial_flow is null then raise exception 'CRA source track has no immutable initialization event'; end if;
  v_expected_template := public.ccc_concrete_template_step(v_initial_flow,1);
  v_bureau_slug := case v_source.bureau_code when 'EQ' then 'equifax' when 'EXP' then 'experian' when 'TU' then 'transunion' end;
  if not v_letter_found or v_bureau_slug is null
    or v_letter.client_id is distinct from v_track.client_id or v_letter.mailed_date is null
    or v_letter.target_type is distinct from 'bureau' or v_letter.target_bureau is distinct from v_bureau_slug
    or v_letter.dispute_bureau_code is distinct from v_source.bureau_code
    or v_letter.dispute_round_number is distinct from (v_expected_template->>'round')::integer
    or v_letter.dispute_flow_code is distinct from v_expected_template->>'flow'
    or (v_letter.dispute_template_id is not null and (
      v_template.flow_code is distinct from v_expected_template->>'flow'
      or v_template.round_number is distinct from (v_expected_template->>'round')::integer
    ))
    or not (
      coalesce(v_letter.client_account_id=v_track.client_account_id,false)
      or exists (
        select 1 from jsonb_array_elements(coalesce(v_letter.dispute_account_snapshot,'[]'::jsonb)) item(value)
        where coalesce(item.value->>'clientAccountId',item.value->>'client_account_id')=v_track.client_account_id::text
      )
    ) then raise exception 'A mailed bureau Collection R1 letter for this exact account is required'; end if;

  v_before := to_jsonb(v_track);
  update public.ccc_account_tracks
  set status='active', revision=revision+1, review_code=null, review_reason=null,
      activation_provenance=activation_provenance || jsonb_build_object(
        'activated_by_cra_track_id',v_source.id,'source_letter_id',v_letter.id,'activated_at',now()
      ), updated_at=now()
  where id=v_track.id
  returning * into v_track;
  insert into public.ccc_account_track_events (
    track_id,user_id,client_id,client_account_id,bureau_code,method_version,event_type,
    transition_code,rule_provenance,from_revision,to_revision,before_state,after_state,
    source_letter_id,event_context,actor_id
  ) values (
    v_track.id,v_track.user_id,v_track.client_id,v_track.client_account_id,null,v_track.method_version,'direct_activated',
    'direct_r1_activated','owner_confirmed_direct_independent_2026_08_20',p_expected_revision,v_track.revision,v_before,to_jsonb(v_track),
    v_letter.id,jsonb_build_object('source_cra_track_id',v_source.id),v_caller
  );
  return v_track;
end;
$$;

create or replace function public.transition_ccc_account_track(
  p_track_id uuid,
  p_expected_revision integer,
  p_outcome text,
  p_context jsonb default '{}'::jsonb,
  p_source_letter_id text default null
)
returns public.ccc_account_tracks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_track public.ccc_account_tracks%rowtype;
  v_join public.ccc_account_tracks%rowtype;
  v_letter public.letters%rowtype;
  v_template public.dispute_templates%rowtype;
  v_before jsonb;
  v_plan jsonb;
  v_internal_context jsonb;
  v_expected_template jsonb;
  v_letter_flow text;
  v_letter_round integer;
  v_bureau_slug text;
  v_before_history jsonb;
  v_after_history jsonb;
  v_letter_found boolean;
begin
  if v_caller is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select role into v_role from public.profiles where id=v_caller;
  if v_role is null or v_role not in ('admin','auditor') then raise exception 'Staff access required' using errcode='42501'; end if;
  if coalesce(jsonb_typeof(p_context),'null')<>'object' or pg_column_size(p_context)>32768 then raise exception 'Transition context must be a small JSON object'; end if;
  select * into v_track from public.ccc_account_tracks where id=p_track_id for update;
  if not found or (v_role is distinct from 'admin' and v_track.user_id is distinct from v_caller) then raise exception 'CCC account track not found' using errcode='42501'; end if;
  if v_track.revision is distinct from p_expected_revision then raise exception 'CCC track revision conflict' using errcode='40001'; end if;
  if v_track.status in ('deleted','resolved') then raise exception 'Terminal CCC track cannot transition'; end if;
  if p_source_letter_id is null then raise exception 'A mailed source letter is required for an account-state transition'; end if;

  select * into v_letter from public.letters where user_id=v_track.user_id and id=p_source_letter_id;
  v_letter_found := found;
  if v_letter.dispute_template_id is not null then
    select * into v_template from public.dispute_templates where id=v_letter.dispute_template_id;
    if not found then raise exception 'Source letter template is missing'; end if;
  end if;
  v_letter_flow := coalesce(v_template.flow_code,v_letter.dispute_flow_code);
  v_letter_round := coalesce(v_template.round_number,v_letter.dispute_round_number);
  v_expected_template := public.ccc_concrete_template_step(v_track.current_flow,v_track.current_round);
  v_bureau_slug := case v_track.bureau_code when 'EQ' then 'equifax' when 'EXP' then 'experian' when 'TU' then 'transunion' end;
  if not v_letter_found or v_letter.client_id is distinct from v_track.client_id or v_letter.mailed_date is null
    or v_letter_flow is distinct from v_expected_template->>'flow'
    or v_letter_round is distinct from (v_expected_template->>'round')::integer
    or v_letter.dispute_flow_code is distinct from v_expected_template->>'flow'
    or v_letter.dispute_round_number is distinct from (v_expected_template->>'round')::integer
    or (v_track.track_scope='cra' and (
      v_bureau_slug is null
      or v_letter.target_type is distinct from 'bureau'
      or v_letter.target_bureau is distinct from v_bureau_slug
      or v_letter.dispute_bureau_code is distinct from v_track.bureau_code
    ))
    or (v_track.track_scope='direct' and (
      v_letter.target_type is distinct from 'furnisher'
      or v_letter.target_bureau is not null
      or v_letter.dispute_bureau_code is not null
    ))
    or not (
      coalesce(v_letter.client_account_id=v_track.client_account_id,false)
      or exists (
        select 1 from jsonb_array_elements(coalesce(v_letter.dispute_account_snapshot,'[]'::jsonb)) item(value)
        where coalesce(item.value->>'clientAccountId',item.value->>'client_account_id')=v_track.client_account_id::text
      )
    ) then raise exception 'Source letter does not prove this track''s exact mailed logical step'; end if;

  v_internal_context := p_context - 'verified_accuracy_join_round';
  if p_context ? 'accuracy_join_track_id' then
    select * into v_join from public.ccc_account_tracks
    where id=(p_context->>'accuracy_join_track_id')::uuid for share;
    if not found or v_join.user_id is distinct from v_track.user_id or v_join.client_id is distinct from v_track.client_id
      or v_join.bureau_code is distinct from v_track.bureau_code or v_join.method_version is distinct from v_track.method_version
      or v_join.track_scope is distinct from 'cra' or v_join.current_flow is distinct from 'accuracy'
      or v_join.status is null or v_join.status not in ('active','review_required') then
      raise exception 'Accuracy join track is not compatible with this Repo track';
    end if;
    v_internal_context := v_internal_context || jsonb_build_object('verified_accuracy_join_round',v_join.current_round);
  end if;

  v_before := to_jsonb(v_track);
  v_before_history := v_track.used_native_rounds;
  v_plan := public.ccc_compute_next_account_state(v_track,lower(p_outcome),v_internal_context);
  update public.ccc_account_tracks
  set status=v_plan->>'status', current_flow=v_plan->>'current_flow',
      current_round=(v_plan->>'current_round')::integer, cycle=(v_plan->>'cycle')::integer,
      used_native_rounds=coalesce(v_plan->'used_native_rounds','{}'::jsonb),
      review_code=nullif(v_plan->>'review_code',''), review_reason=nullif(v_plan->>'review_reason',''),
      activation_provenance=case when v_plan ? 'rule_provenance'
        then activation_provenance || jsonb_build_object('last_transition_rule',v_plan->>'rule_provenance')
        else activation_provenance end,
      revision=revision+1, updated_at=now()
  where id=v_track.id
  returning * into v_track;
  v_after_history := v_track.used_native_rounds;

  insert into public.ccc_account_track_events (
    track_id,user_id,client_id,client_account_id,bureau_code,method_version,event_type,
    outcome,transition_code,rule_provenance,from_revision,to_revision,before_state,
    after_state,applied_law_coverage,source_letter_id,event_context,actor_id
  ) values (
    v_track.id,v_track.user_id,v_track.client_id,v_track.client_account_id,v_track.bureau_code,v_track.method_version,'transitioned',
    lower(p_outcome),v_plan->>'transition_code',nullif(v_plan->>'rule_provenance',''),p_expected_revision,v_track.revision,v_before,
    to_jsonb(v_track),jsonb_build_object('before',v_before_history,'after',v_after_history),v_letter.id,p_context,v_caller
  );
  return v_track;
end;
$$;

revoke all on table public.ccc_account_tracks from anon, authenticated;
revoke all on table public.ccc_account_track_events from anon, authenticated;
revoke all on table public.ccc_combo_native_law_coverage from anon, authenticated;
grant select on public.ccc_account_tracks, public.ccc_account_track_events, public.ccc_combo_native_law_coverage to authenticated;
grant all on public.ccc_account_tracks, public.ccc_account_track_events, public.ccc_combo_native_law_coverage to service_role;

revoke all on function public.ccc_add_used_native_round(jsonb,text,integer) from public;
revoke all on function public.ccc_concrete_template_step(text,integer) from public;
revoke all on function public.ccc_record_current_law_coverage(public.ccc_account_tracks) from public;
revoke all on function public.ccc_resolve_combo_side_transition(text,jsonb,text) from public;
revoke all on function public.ccc_compute_next_account_state(public.ccc_account_tracks,text,jsonb) from public;
revoke all on function public.initialize_ccc_account_tracks(uuid,text,jsonb,text) from public;
revoke all on function public.activate_ccc_direct_account_track(uuid,integer,uuid,text) from public;
revoke all on function public.transition_ccc_account_track(uuid,integer,text,jsonb,text) from public;
grant execute on function public.initialize_ccc_account_tracks(uuid,text,jsonb,text) to authenticated;
grant execute on function public.activate_ccc_direct_account_track(uuid,integer,uuid,text) to authenticated;
grant execute on function public.transition_ccc_account_track(uuid,integer,text,jsonb,text) to authenticated;
