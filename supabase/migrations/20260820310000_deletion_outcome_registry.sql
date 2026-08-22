-- First-class confirmed-deletion registry.
--
-- Forward path (expand -> link -> verify): add canonical client/account/source
-- coordinates without rewriting the legacy outcome payload, link the one
-- owner-confirmed Robert Kerstner record, then expose a narrow portal RPC.
-- Mixed-version clients remain safe: the legacy columns and table name stay
-- intact, while pre-migration frontends simply do not request these columns.
--
-- Rollback path (manual, only after exporting the new coordinates): revoke and
-- drop get_my_deletion_outcomes(), drop the validation trigger/indexes/FKs, and
-- finally drop only the columns introduced below. No contraction is performed
-- by this migration because doing so would discard newly linked history.

alter table public.deletions
  add column if not exists client_id uuid,
  add column if not exists client_account_id uuid,
  add column if not exists bureau_code text,
  add column if not exists account_last4 text,
  add column if not exists source_kind text,
  add column if not exists source_audit_user_id uuid,
  add column if not exists source_audit_id text,
  add column if not exists source_letter_user_id uuid,
  add column if not exists source_letter_id text,
  add column if not exists created_at timestamptz,
  add column if not exists updated_at timestamptz;

-- Existing rows retain every original value. These fields only provide a
-- durable event timestamp and provenance classification where neither existed.
update public.deletions
set
  source_kind = coalesce(nullif(btrim(source_kind), ''), 'legacy_manual'),
  created_at = coalesce(created_at, deletion_confirmed_at, statement_timestamp()),
  updated_at = coalesce(updated_at, deletion_confirmed_at, created_at, statement_timestamp())
where source_kind is null
   or btrim(source_kind) = ''
   or created_at is null
   or updated_at is null;

alter table public.deletions
  alter column source_kind set default 'legacy_manual',
  alter column source_kind set not null,
  alter column created_at set default statement_timestamp(),
  alter column created_at set not null,
  alter column updated_at set default statement_timestamp(),
  alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_client_id_fkey'
  ) then
    alter table public.deletions
      add constraint deletions_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_client_account_id_fkey'
  ) then
    alter table public.deletions
      add constraint deletions_client_account_id_fkey
      foreign key (client_account_id) references public.client_accounts(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_source_audit_fkey'
  ) then
    alter table public.deletions
      add constraint deletions_source_audit_fkey
      foreign key (source_audit_user_id, source_audit_id)
      references public.audits(user_id, id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_source_letter_fkey'
  ) then
    alter table public.deletions
      add constraint deletions_source_letter_fkey
      foreign key (source_letter_user_id, source_letter_id)
      references public.letters(user_id, id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_bureau_code_check'
  ) then
    alter table public.deletions
      add constraint deletions_bureau_code_check
      check (bureau_code is null or bureau_code in ('EQ', 'EXP', 'TU'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_account_last4_check'
  ) then
    alter table public.deletions
      add constraint deletions_account_last4_check
      check (account_last4 is null or account_last4 ~ '^[0-9]{4}$');
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_source_audit_pair_check'
  ) then
    alter table public.deletions
      add constraint deletions_source_audit_pair_check
      check ((source_audit_user_id is null) = (source_audit_id is null));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_source_letter_pair_check'
  ) then
    alter table public.deletions
      add constraint deletions_source_letter_pair_check
      check ((source_letter_user_id is null) = (source_letter_id is null));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_linked_outcome_check'
  ) then
    alter table public.deletions
      add constraint deletions_linked_outcome_check
      check (
        client_id is null
        or (bureau_code is not null and deletion_confirmed_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.deletions'::regclass
      and conname = 'deletions_source_kind_nonblank_check'
  ) then
    alter table public.deletions
      add constraint deletions_source_kind_nonblank_check
      check (btrim(source_kind) <> '');
  end if;
end
$$;

create index if not exists deletions_client_confirmed_idx
  on public.deletions (client_id, deletion_confirmed_at desc, id)
  where client_id is not null and deletion_confirmed_at is not null;

create index if not exists deletions_source_letter_idx
  on public.deletions (source_letter_user_id, source_letter_id)
  where source_letter_id is not null;

-- One account can be confirmed removed once per bureau in the current
-- registry. A later result must update/link the same event instead of silently
-- creating a second dashboard win for the same account and bureau.
create unique index if not exists deletions_client_account_bureau_unique
  on public.deletions (client_id, client_account_id, bureau_code)
  where client_id is not null
    and client_account_id is not null
    and bureau_code is not null;

create or replace function public.ccc_validate_deletion_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients%rowtype;
  v_account public.client_accounts%rowtype;
  v_source_client_id uuid;
begin
  new.source_kind := coalesce(nullif(btrim(new.source_kind), ''), 'legacy_manual');
  new.created_at := coalesce(new.created_at, new.deletion_confirmed_at, statement_timestamp());
  new.updated_at := statement_timestamp();

  if new.bureau_code is null then
    new.bureau_code := case lower(btrim(coalesce(new.bureau, '')))
      when 'eq' then 'EQ'
      when 'equifax' then 'EQ'
      when 'exp' then 'EXP'
      when 'ex' then 'EXP'
      when 'experian' then 'EXP'
      when 'tu' then 'TU'
      when 'transunion' then 'TU'
      when 'trans union' then 'TU'
      else null
    end;
  else
    new.bureau_code := upper(btrim(new.bureau_code));
  end if;

  if new.client_id is not null then
    select * into v_client
    from public.clients client
    where client.id = new.client_id;
    if not found then
      raise exception using errcode = '23503', message = 'Deletion outcome client does not exist';
    end if;
    if v_client.user_id is distinct from new.user_id then
      raise exception using errcode = '23514', message = 'Deletion outcome firm/client ownership mismatch';
    end if;
    if lower(btrim(v_client.name)) is distinct from lower(btrim(new.client_name)) then
      raise exception using errcode = '23514', message = 'Deletion outcome client name does not match the linked client';
    end if;
    if new.bureau_code is null or new.deletion_confirmed_at is null then
      raise exception using errcode = '23514', message = 'A linked deletion outcome requires a canonical bureau and confirmation timestamp';
    end if;
  elsif tg_op = 'INSERT' and (
    new.client_account_id is not null
    or new.source_audit_id is not null
    or new.source_letter_id is not null
  ) then
    raise exception using errcode = '23514', message = 'Account and source links require a canonical client';
  end if;

  if new.client_account_id is not null then
    select * into v_account
    from public.client_accounts account
    where account.id = new.client_account_id;
    if not found then
      raise exception using errcode = '23503', message = 'Deletion outcome account does not exist';
    end if;
    if v_account.user_id is distinct from new.user_id
       or (new.client_id is not null and v_account.client_id is distinct from new.client_id) then
      raise exception using errcode = '23514', message = 'Deletion outcome account does not belong to the linked client';
    end if;
    if new.account_last4 is not null
       and v_account.account_last4 is not null
       and new.account_last4 is distinct from v_account.account_last4 then
      raise exception using errcode = '23514', message = 'Deletion outcome account suffix does not match the linked account';
    end if;
    new.account_last4 := coalesce(new.account_last4, v_account.account_last4);
  end if;

  if (new.source_audit_user_id is null) is distinct from (new.source_audit_id is null) then
    raise exception using errcode = '23514', message = 'Deletion outcome audit source coordinates must be provided together';
  end if;
  if new.source_audit_id is not null then
    if new.source_audit_user_id is distinct from new.user_id then
      raise exception using errcode = '23514', message = 'Deletion outcome audit source belongs to another firm';
    end if;
    select audit.client_id into v_source_client_id
    from public.audits audit
    where audit.user_id = new.source_audit_user_id
      and audit.id = new.source_audit_id;
    if not found
       or (new.client_id is not null and v_source_client_id is distinct from new.client_id) then
      raise exception using errcode = '23514', message = 'Deletion outcome audit source does not belong to the linked client';
    end if;
  end if;

  if (new.source_letter_user_id is null) is distinct from (new.source_letter_id is null) then
    raise exception using errcode = '23514', message = 'Deletion outcome letter source coordinates must be provided together';
  end if;
  if new.source_letter_id is not null then
    if new.source_letter_user_id is distinct from new.user_id then
      raise exception using errcode = '23514', message = 'Deletion outcome letter source belongs to another firm';
    end if;
    select letter.client_id into v_source_client_id
    from public.letters letter
    where letter.user_id = new.source_letter_user_id
      and letter.id = new.source_letter_id;
    if not found
       or (new.client_id is not null and v_source_client_id is distinct from new.client_id) then
      raise exception using errcode = '23514', message = 'Deletion outcome letter source does not belong to the linked client';
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.ccc_validate_deletion_outcome() from public, anon, authenticated;

drop trigger if exists deletions_validate_outcome on public.deletions;
create trigger deletions_validate_outcome
before insert or update on public.deletions
for each row execute function public.ccc_validate_deletion_outcome();

-- Preserve the production event row and its original notes/fee/name/bureau
-- text. Only the new canonical coordinates are populated.
update public.deletions deletion
set
  client_id = 'ea41862f-c22a-4acc-9455-8550556f907d'::uuid,
  client_account_id = '0c5fcb7e-b09e-4636-84d8-51aeaed84a4c'::uuid,
  bureau_code = 'TU',
  account_last4 = '8989',
  source_kind = 'owner_confirmed_historical',
  source_audit_user_id = deletion.user_id,
  source_audit_id = 'robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07'
where deletion.id = '3b4d2416-fe75-4daa-a9d4-8904a509eb00'::uuid
  and (
    deletion.client_id is distinct from 'ea41862f-c22a-4acc-9455-8550556f907d'::uuid
    or deletion.client_account_id is distinct from '0c5fcb7e-b09e-4636-84d8-51aeaed84a4c'::uuid
    or deletion.bureau_code is distinct from 'TU'
    or deletion.account_last4 is distinct from '8989'
    or deletion.source_kind is distinct from 'owner_confirmed_historical'
    or deletion.source_audit_user_id is distinct from deletion.user_id
    or deletion.source_audit_id is distinct from 'robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07'
  )
  and exists (
    select 1
    from public.clients client
    join public.client_accounts account
      on account.id = '0c5fcb7e-b09e-4636-84d8-51aeaed84a4c'::uuid
     and account.client_id = client.id
     and account.user_id = client.user_id
    join public.audits audit
      on audit.user_id = client.user_id
     and audit.id = 'robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07'
     and audit.client_id = client.id
    where client.id = 'ea41862f-c22a-4acc-9455-8550556f907d'::uuid
      and client.user_id = deletion.user_id
  );

do $$
begin
  if exists (
    select 1 from public.deletions
    where id = '3b4d2416-fe75-4daa-a9d4-8904a509eb00'::uuid
  ) and not exists (
    select 1 from public.deletions
    where id = '3b4d2416-fe75-4daa-a9d4-8904a509eb00'::uuid
      and client_id = 'ea41862f-c22a-4acc-9455-8550556f907d'::uuid
      and client_account_id = '0c5fcb7e-b09e-4636-84d8-51aeaed84a4c'::uuid
      and bureau_code = 'TU'
      and account_last4 = '8989'
      and source_audit_id = 'robert-kerstner__ea41862f-c22a-4acc-9455-8550556f907d__2026-08-07'
  ) then
    raise exception 'Robert Kerstner deletion outcome exists but could not be linked safely';
  end if;
end
$$;

-- Direct table access is staff-only and follows the same firm boundary as
-- clients/audits. Portal clients receive only the narrow RPC projection below.
drop policy if exists "Admin manages deletions" on public.deletions;
drop policy if exists "Client sees own deletions" on public.deletions;
drop policy if exists deletions_staff_manage on public.deletions;
create policy deletions_staff_manage
on public.deletions for all to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and (
        profile.role = 'admin'
        or (profile.role = 'auditor' and deletions.user_id = auth.uid())
      )
  )
)
with check (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and (
        profile.role = 'admin'
        or (profile.role = 'auditor' and deletions.user_id = auth.uid())
      )
  )
);

revoke all on table public.deletions from public, anon;
grant select, insert, update, delete on table public.deletions to authenticated;
grant all on table public.deletions to service_role;

create or replace function public.get_my_deletion_outcomes()
returns table (
  deletion_id uuid,
  furnisher text,
  account_type text,
  bureau_code text,
  confirmed_at timestamptz,
  source_letter_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_client_id uuid;
  v_profile_count integer;
  v_client_profile_count integer;
begin
  if v_caller is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select count(*)::integer, max(profile.client_id::text)::uuid
  into v_profile_count, v_client_id
  from public.client_profiles profile
  where profile.user_id = v_caller;

  if v_profile_count <> 1 or v_client_id is null then
    raise exception using errcode = '42501', message = 'An exact client portal profile is required';
  end if;

  select count(*)::integer into v_client_profile_count
  from public.client_profiles profile
  where profile.client_id = v_client_id;

  if v_client_profile_count <> 1 then
    raise exception using errcode = '42501', message = 'The client portal mapping is ambiguous';
  end if;

  return query
  select
    deletion.id,
    deletion.furnisher,
    deletion.account_type,
    deletion.bureau_code,
    deletion.deletion_confirmed_at,
    deletion.source_letter_id
  from public.deletions deletion
  where deletion.client_id = v_client_id
    and deletion.deletion_confirmed_at is not null
    and deletion.bureau_code is not null
  order by deletion.deletion_confirmed_at desc, deletion.id;
end
$$;

revoke all on function public.get_my_deletion_outcomes() from public, anon;
grant execute on function public.get_my_deletion_outcomes() to authenticated;

comment on function public.get_my_deletion_outcomes() is
  'Portal-safe confirmed deletion outcomes for the caller exact one-to-one client profile. Excludes notes, fees, firm IDs, account IDs, and account suffixes.';

comment on column public.deletions.bureau_code is
  'Canonical bureau code (EQ, EXP, TU). Legacy bureau display text remains unchanged.';
comment on column public.deletions.source_letter_id is
  'Optional exact letter coordinate used only to deduplicate a deletion already represented by a letter outcome.';
