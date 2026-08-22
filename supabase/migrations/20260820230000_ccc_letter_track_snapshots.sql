-- Bind every new CCC physical letter to the exact server-owned account state
-- that selected its logical step and concrete template. Historical/non-CCC
-- rows keep an empty array; old unmailed CCC drafts must be rebuilt before Lob
-- will accept them. No historical evidence is inferred or backfilled.

alter table public.letters
  add column if not exists ccc_account_track_snapshots jsonb not null default '[]'::jsonb,
  add column if not exists dispute_automatic_values_snapshot jsonb not null default '{}'::jsonb;

create or replace function public.ccc_letter_track_snapshots_valid(p_snapshots jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_required_keys constant text[] := array[
    'trackId', 'revision', 'methodVersion', 'trackScope',
    'clientAccountId', 'bureauCode', 'accountKind', 'nativeFlow',
    'logicalFlow', 'logicalRound', 'concreteFlow', 'concreteRound',
    'cycle', 'pathRole'
  ];
begin
  if coalesce(jsonb_typeof(p_snapshots), 'null') <> 'array' then
    return false;
  end if;
  if jsonb_array_length(p_snapshots) > 50 or pg_column_size(p_snapshots) > 262144 then
    return false;
  end if;

  for v_item in select value from jsonb_array_elements(p_snapshots) loop
    if jsonb_typeof(v_item) <> 'object' then
      return false;
    end if;
    if not (v_item ?& v_required_keys)
      or (select count(*) from jsonb_object_keys(v_item)) <> cardinality(v_required_keys)
      or jsonb_typeof(v_item->'trackId') <> 'string'
      or not ((v_item->>'trackId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or jsonb_typeof(v_item->'clientAccountId') <> 'string'
      or not ((v_item->>'clientAccountId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or jsonb_typeof(v_item->'revision') <> 'number'
      or not ((v_item->>'revision') ~ '^[0-9]+$')
      or length(v_item->>'revision') > 10
      or jsonb_typeof(v_item->'methodVersion') <> 'string'
      or nullif(btrim(v_item->>'methodVersion'), '') is null
      or length(v_item->>'methodVersion') > 100
      or jsonb_typeof(v_item->'trackScope') <> 'string'
      or (v_item->>'trackScope') not in ('cra', 'direct')
      or jsonb_typeof(v_item->'accountKind') <> 'string'
      or (v_item->>'accountKind') not in (
        'collection', 'repossession', 'charge_off', 'late_payment',
        'student_loan', 'bankruptcy', 'other'
      )
      or jsonb_typeof(v_item->'nativeFlow') <> 'string'
      or (v_item->>'nativeFlow') not in (
        'accuracy', 'collection', 'consent', 'late_pay', 'repo', 'direct'
      )
      or jsonb_typeof(v_item->'logicalFlow') <> 'string'
      or (v_item->>'logicalFlow') not in (
        'accuracy', 'collection', 'combo', 'consent', 'late_pay', 'repo', 'direct'
      )
      or jsonb_typeof(v_item->'concreteFlow') <> 'string'
      or (v_item->>'concreteFlow') not in (
        'accuracy', 'collection', 'combo', 'consent', 'late_pay', 'direct'
      )
      or jsonb_typeof(v_item->'logicalRound') <> 'number'
      or not ((v_item->>'logicalRound') ~ '^[1-9][0-9]*$')
      or length(v_item->>'logicalRound') > 2
      or jsonb_typeof(v_item->'concreteRound') <> 'number'
      or not ((v_item->>'concreteRound') ~ '^[1-9][0-9]*$')
      or length(v_item->>'concreteRound') > 2
      or jsonb_typeof(v_item->'cycle') <> 'number'
      or not ((v_item->>'cycle') ~ '^[1-9][0-9]*$')
      or length(v_item->>'cycle') > 10
      or jsonb_typeof(v_item->'pathRole') <> 'string'
      or (v_item->>'pathRole') not in ('standard', 'repo_primary', 'repo_companion')
      or (
        v_item->>'trackScope' = 'cra'
        and (
          jsonb_typeof(v_item->'bureauCode') <> 'string'
          or (v_item->>'bureauCode') not in ('EQ', 'EXP', 'TU')
        )
      )
      or (
        v_item->>'trackScope' = 'direct'
        and (
          jsonb_typeof(v_item->'bureauCode') <> 'null'
          or v_item->>'nativeFlow' <> 'direct'
          or v_item->>'logicalFlow' <> 'direct'
          or v_item->>'concreteFlow' <> 'direct'
          or v_item->>'pathRole' <> 'standard'
        )
      ) then
      return false;
    end if;

    if (v_item->>'revision')::numeric > 2147483647
      or (v_item->>'cycle')::numeric > 2147483647
      or not (
        ((v_item->>'logicalFlow') in ('accuracy', 'combo') and (v_item->>'logicalRound')::integer between 1 and 12)
        or ((v_item->>'logicalFlow') = 'collection' and (v_item->>'logicalRound')::integer between 1 and 10)
        or ((v_item->>'logicalFlow') in ('consent', 'repo') and (v_item->>'logicalRound')::integer between 1 and 3)
        or ((v_item->>'logicalFlow') in ('late_pay', 'direct') and (v_item->>'logicalRound')::integer between 1 and 2)
      )
      or not (
        ((v_item->>'concreteFlow') in ('accuracy', 'combo') and (v_item->>'concreteRound')::integer between 1 and 12)
        or ((v_item->>'concreteFlow') = 'collection' and (v_item->>'concreteRound')::integer between 1 and 10)
        or ((v_item->>'concreteFlow') = 'consent' and (v_item->>'concreteRound')::integer between 1 and 3)
        or ((v_item->>'concreteFlow') in ('late_pay', 'direct') and (v_item->>'concreteRound')::integer between 1 and 2)
      )
      or (
        v_item->>'logicalFlow' = 'combo'
        and (v_item->>'logicalRound')::integer between 5 and 7
        and (
          v_item->>'concreteFlow' <> 'accuracy'
          or (v_item->>'concreteRound')::integer <> (v_item->>'logicalRound')::integer
        )
      )
      or (
        v_item->>'logicalFlow' = 'late_pay'
        and (v_item->>'logicalRound')::integer = 2
        and (v_item->>'concreteFlow', (v_item->>'concreteRound')::integer) is distinct from ('consent', 2)
      )
      or (
        v_item->>'logicalFlow' = 'repo'
        and (
          (v_item->>'concreteFlow') <> 'collection'
          or (v_item->>'concreteRound')::integer <> case (v_item->>'logicalRound')::integer
            when 1 then 1 when 2 then 2 when 3 then 6 end
        )
      )
      or (
        not (
          (v_item->>'logicalFlow' = 'combo' and (v_item->>'logicalRound')::integer between 5 and 7)
          or (v_item->>'logicalFlow' = 'late_pay' and (v_item->>'logicalRound')::integer = 2)
          or v_item->>'logicalFlow' = 'repo'
        )
        and (
          v_item->>'concreteFlow' <> v_item->>'logicalFlow'
          or (v_item->>'concreteRound')::integer <> (v_item->>'logicalRound')::integer
        )
      ) then
      return false;
    end if;
  end loop;

  if exists (
    select 1
    from jsonb_array_elements(p_snapshots) snapshot(value)
    group by lower(snapshot.value->>'trackId')
    having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(p_snapshots) snapshot(value)
    group by lower(snapshot.value->>'clientAccountId')
    having count(*) > 1
  ) then
    return false;
  end if;

  return true;
end;
$$;

alter table public.letters
  drop constraint if exists letters_ccc_account_track_snapshots_shape,
  add constraint letters_ccc_account_track_snapshots_shape
    check (public.ccc_letter_track_snapshots_valid(ccc_account_track_snapshots)),
  drop constraint if exists letters_dispute_automatic_values_snapshot_shape,
  add constraint letters_dispute_automatic_values_snapshot_shape
    check (
      jsonb_typeof(dispute_automatic_values_snapshot) = 'object'
      and pg_column_size(dispute_automatic_values_snapshot) <= 262144
    );

comment on column public.letters.ccc_account_track_snapshots is
  'Immutable per-account CCC method binding: exact track/revision/classification, logical step, concrete template step, cycle, scope, bureau, and path role saved before mail.';

comment on column public.letters.dispute_automatic_values_snapshot is
  'Bounded reviewed snapshot of the automatic curly merge inputs used for this saved CCC letter; masked before persistence by Campaign Studio.';

-- Keep the 1900 printable-snapshot trigger unchanged. This independent guard
-- adds the new evidence field without replacing or weakening any existing
-- immutable-field comparison.
create or replace function public.prevent_mailed_ccc_track_snapshot_rewrite()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (
    coalesce(old.phase, '') like 'CCC Dispute —%'
    or coalesce(new.phase, '') like 'CCC Dispute —%'
  )
  and (
    old.mailed_date is not null
    or old.lob_id is not null
    or new.mailed_date is not null
    or new.lob_id is not null
  )
  and (
    old.ccc_account_track_snapshots is distinct from new.ccc_account_track_snapshots
    or old.dispute_automatic_values_snapshot is distinct from new.dispute_automatic_values_snapshot
  ) then
    raise exception 'A mailed CCC letter state/input snapshot is immutable. Create a new letter revision.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_mailed_ccc_track_snapshots on public.letters;
create trigger protect_mailed_ccc_track_snapshots
before update on public.letters
for each row execute function public.prevent_mailed_ccc_track_snapshot_rewrite();

revoke all on function public.ccc_letter_track_snapshots_valid(jsonb) from public;
grant execute on function public.ccc_letter_track_snapshots_valid(jsonb) to authenticated, service_role;

-- Rollback path: deploy readers that ignore the additive column. Keep the
-- column, constraint, and mailed-evidence trigger in place; dropping them
-- would weaken proof for letters already mailed under this method version.
