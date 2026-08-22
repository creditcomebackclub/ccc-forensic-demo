-- Additive, staff-attested merge identity for CCC letters. Existing client,
-- document, and letter rows are preserved. New CCC drafts must snapshot this
-- record; historical drafts remain readable but fail the current mail gate.

begin;

create table if not exists public.ccc_client_letter_identities (
  client_id uuid primary key references public.clients(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade,
  first_name text not null,
  last_name text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  state text not null,
  zip text not null,
  identity_document_id uuid not null references public.documents(id) on delete restrict,
  identity_document_sha256 text not null,
  identity_document_storage_path text not null,
  address_document_id uuid not null references public.documents(id) on delete restrict,
  address_document_sha256 text not null,
  address_document_storage_path text not null,
  revision integer not null default 1 check (revision > 0),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (identity_document_id <> address_document_id),
  check (first_name = btrim(first_name) and length(first_name) between 1 and 100 and first_name !~ '[{}\r\n]'),
  check (last_name = btrim(last_name) and length(last_name) between 1 and 150 and last_name !~ '[{}\r\n]'),
  check (address_line1 = btrim(address_line1) and length(address_line1) between 1 and 200 and address_line1 !~ '[{}\r\n]'),
  check (address_line2 is null or (address_line2 = btrim(address_line2) and length(address_line2) between 1 and 200 and address_line2 !~ '[{}\r\n]')),
  check (city = btrim(city) and length(city) between 1 and 100 and city !~ '[{}\r\n]'),
  check (state ~ '^[A-Z]{2}$'),
  check (zip ~ '^\d{5}(-\d{4})?$'),
  check (identity_document_sha256 ~ '^[0-9a-f]{64}$'),
  check (address_document_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.ccc_client_letter_identities is
  'One current staff-attested legal name/address and exact ID/address-document binding used for CCC letter curlys. No client-name splitting or report-address fallback is allowed.';

alter table public.ccc_client_letter_identities enable row level security;

drop policy if exists "staff_read_ccc_client_letter_identities"
  on public.ccc_client_letter_identities;
create policy "staff_read_ccc_client_letter_identities"
on public.ccc_client_letter_identities for select to authenticated
using (
  exists (
    select 1 from public.profiles profile
    where profile.id = auth.uid()
      and profile.role in ('admin', 'auditor')
      and (profile.role = 'admin' or ccc_client_letter_identities.user_id = auth.uid())
  )
);

revoke all on table public.ccc_client_letter_identities
  from public, anon, authenticated;
grant select on table public.ccc_client_letter_identities to authenticated, service_role;

create or replace function public.ccc_letter_identity_snapshot(
  p_identity public.ccc_client_letter_identities
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'revision', p_identity.revision,
    'userId', p_identity.user_id,
    'clientId', p_identity.client_id,
    'firstName', p_identity.first_name,
    'lastName', p_identity.last_name,
    'addressLine1', p_identity.address_line1,
    'addressLine2', coalesce(p_identity.address_line2, ''),
    'city', p_identity.city,
    'state', p_identity.state,
    'zip', p_identity.zip,
    'identityDocumentId', p_identity.identity_document_id,
    'identityDocumentSha256', p_identity.identity_document_sha256,
    'identityDocumentStoragePath', p_identity.identity_document_storage_path,
    'addressDocumentId', p_identity.address_document_id,
    'addressDocumentSha256', p_identity.address_document_sha256,
    'addressDocumentStoragePath', p_identity.address_document_storage_path,
    'verifiedBy', p_identity.verified_by,
    'verifiedAt', p_identity.verified_at
  );
$$;

create or replace function public.ccc_letter_identity_snapshot_valid(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_required_keys constant text[] := array[
    'revision', 'userId', 'clientId', 'firstName', 'lastName',
    'addressLine1', 'addressLine2', 'city', 'state', 'zip',
    'identityDocumentId', 'identityDocumentSha256', 'identityDocumentStoragePath',
    'addressDocumentId', 'addressDocumentSha256', 'addressDocumentStoragePath',
    'verifiedBy', 'verifiedAt'
  ];
begin
  if p_snapshot = '{}'::jsonb then return true; end if;
  if coalesce(pg_catalog.jsonb_typeof(p_snapshot), 'null') <> 'object'
    or not (p_snapshot ?& v_required_keys)
    or (select count(*) from pg_catalog.jsonb_object_keys(p_snapshot)) <> pg_catalog.cardinality(v_required_keys)
    or coalesce(p_snapshot->>'revision', '') !~ '^[1-9][0-9]*$'
    or (p_snapshot->>'revision')::numeric > 2147483647
    or coalesce(p_snapshot->>'userId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_snapshot->>'clientId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_snapshot->>'verifiedBy', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_snapshot->>'identityDocumentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_snapshot->>'addressDocumentId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_snapshot->>'identityDocumentSha256', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_snapshot->>'addressDocumentSha256', '') !~ '^[0-9a-f]{64}$'
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'identityDocumentStoragePath', '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'addressDocumentStoragePath', '')), '') is null
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'firstName', '')), '') is null
    or length(p_snapshot->>'firstName') > 100
    or p_snapshot->>'firstName' ~ '[{}\r\n]'
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'lastName', '')), '') is null
    or length(p_snapshot->>'lastName') > 150
    or p_snapshot->>'lastName' ~ '[{}\r\n]'
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'addressLine1', '')), '') is null
    or length(p_snapshot->>'addressLine1') > 200
    or p_snapshot->>'addressLine1' ~ '[{}\r\n]'
    or length(coalesce(p_snapshot->>'addressLine2', '')) > 200
    or coalesce(p_snapshot->>'addressLine2', '') ~ '[{}\r\n]'
    or nullif(pg_catalog.btrim(coalesce(p_snapshot->>'city', '')), '') is null
    or length(p_snapshot->>'city') > 100
    or p_snapshot->>'city' ~ '[{}\r\n]'
    or coalesce(p_snapshot->>'state', '') !~ '^[A-Z]{2}$'
    or coalesce(p_snapshot->>'zip', '') !~ '^\d{5}(-\d{4})?$' then
    return false;
  end if;
  perform (p_snapshot->>'verifiedAt')::timestamptz;
  return true;
exception when others then
  return false;
end;
$$;

create or replace function public.ccc_letter_identity_snapshot_matches_current(
  p_user_id uuid,
  p_client_id uuid,
  p_snapshot jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_identity public.ccc_client_letter_identities%rowtype;
begin
  if p_snapshot = '{}'::jsonb or not public.ccc_letter_identity_snapshot_valid(p_snapshot) then
    return false;
  end if;
  select identity.* into v_identity
  from public.ccc_client_letter_identities identity
  where identity.user_id = p_user_id and identity.client_id = p_client_id;
  if not found or public.ccc_letter_identity_snapshot(v_identity) is distinct from p_snapshot then
    return false;
  end if;
  return exists (
    select 1 from public.documents document
    where document.id = v_identity.identity_document_id
      and document.user_id = p_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'id'
      and document.sha256 = v_identity.identity_document_sha256
      and document.storage_path = v_identity.identity_document_storage_path
      and document.content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      and document.byte_size > 0
  ) and exists (
    select 1 from public.documents document
    where document.id = v_identity.address_document_id
      and document.user_id = p_user_id
      and document.client_id = p_client_id
      and document.doc_type = 'address'
      and document.sha256 = v_identity.address_document_sha256
      and document.storage_path = v_identity.address_document_storage_path
      and document.content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
      and document.byte_size > 0
  );
exception when others then
  return false;
end;
$$;

create or replace function public.save_ccc_client_letter_identity(
  p_client_id uuid,
  p_expected_revision integer,
  p_first_name text,
  p_last_name text,
  p_address_line1 text,
  p_address_line2 text,
  p_city text,
  p_state text,
  p_zip text,
  p_identity_document_id uuid,
  p_address_document_id uuid,
  p_staff_attested boolean
)
returns public.ccc_client_letter_identities
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_role text;
  v_client public.clients%rowtype;
  v_existing public.ccc_client_letter_identities%rowtype;
  v_result public.ccc_client_letter_identities%rowtype;
  v_id_document public.documents%rowtype;
  v_address_document public.documents%rowtype;
  v_first_name text := pg_catalog.btrim(coalesce(p_first_name, ''));
  v_last_name text := pg_catalog.btrim(coalesce(p_last_name, ''));
  v_address_line1 text := pg_catalog.btrim(coalesce(p_address_line1, ''));
  v_address_line2 text := nullif(pg_catalog.btrim(coalesce(p_address_line2, '')), '');
  v_city text := pg_catalog.btrim(coalesce(p_city, ''));
  v_state text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_state, '')));
  v_zip text := pg_catalog.btrim(coalesce(p_zip, ''));
begin
  if v_caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  select profile.role into v_role from public.profiles profile where profile.id = v_caller;
  if v_role is null or v_role not in ('admin', 'auditor') then
    raise exception 'Staff access required' using errcode = '42501';
  end if;
  select client.* into v_client from public.clients client where client.id = p_client_id;
  if not found then raise exception 'Client not found' using errcode = 'P0002'; end if;
  if v_role is distinct from 'admin' and v_client.user_id is distinct from v_caller then
    raise exception 'Client access denied' using errcode = '42501';
  end if;
  if p_staff_attested is not true then raise exception 'Staff must attest that the typed identity matches both reviewed documents'; end if;
  if v_first_name = '' or length(v_first_name) > 100 or v_first_name ~ '[{}\r\n]'
    or v_last_name = '' or length(v_last_name) > 150 or v_last_name ~ '[{}\r\n]'
    or v_address_line1 = '' or length(v_address_line1) > 200 or v_address_line1 ~ '[{}\r\n]'
    or (v_address_line2 is not null and (length(v_address_line2) > 200 or v_address_line2 ~ '[{}\r\n]'))
    or v_city = '' or length(v_city) > 100 or v_city ~ '[{}\r\n]'
    or v_state !~ '^[A-Z]{2}$'
    or v_zip !~ '^\d{5}(-\d{4})?$' then
    raise exception 'Enter the exact legal first/last name and structured current mailing address';
  end if;
  if p_identity_document_id is null or p_address_document_id is null or p_identity_document_id = p_address_document_id then
    raise exception 'Choose one government ID and one proof-of-address document';
  end if;

  select document.* into v_id_document
  from public.documents document
  where document.id = p_identity_document_id
    and document.user_id = v_client.user_id
    and document.client_id = v_client.id
    and document.doc_type = 'id';
  if not found
    or coalesce(v_id_document.sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(v_id_document.content_type, '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or coalesce(v_id_document.byte_size, 0) <= 0
    or coalesce(v_id_document.storage_path, '') !~ ('/identity/id-' || pg_catalog.substr(v_id_document.sha256, 1, 16) || '\.[a-z0-9]+$') then
    raise exception 'The government ID lacks immutable integrity evidence. Re-upload it through Documents.';
  end if;

  select document.* into v_address_document
  from public.documents document
  where document.id = p_address_document_id
    and document.user_id = v_client.user_id
    and document.client_id = v_client.id
    and document.doc_type = 'address';
  if not found
    or coalesce(v_address_document.sha256, '') !~ '^[0-9a-f]{64}$'
    or coalesce(v_address_document.content_type, '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or coalesce(v_address_document.byte_size, 0) <= 0
    or coalesce(v_address_document.storage_path, '') !~ ('/identity/address-' || pg_catalog.substr(v_address_document.sha256, 1, 16) || '\.[a-z0-9]+$') then
    raise exception 'The proof of address lacks immutable integrity evidence. Re-upload it through Documents.';
  end if;

  select identity.* into v_existing
  from public.ccc_client_letter_identities identity
  where identity.client_id = p_client_id
  for update;

  if found then
    if p_expected_revision is null or p_expected_revision <> v_existing.revision then
      raise exception 'The CCC letter identity changed in another session. Reload and review it again.' using errcode = '40001';
    end if;
    update public.ccc_client_letter_identities identity set
      first_name = v_first_name,
      last_name = v_last_name,
      address_line1 = v_address_line1,
      address_line2 = v_address_line2,
      city = v_city,
      state = v_state,
      zip = v_zip,
      identity_document_id = v_id_document.id,
      identity_document_sha256 = v_id_document.sha256,
      identity_document_storage_path = v_id_document.storage_path,
      address_document_id = v_address_document.id,
      address_document_sha256 = v_address_document.sha256,
      address_document_storage_path = v_address_document.storage_path,
      revision = identity.revision + 1,
      verified_by = v_caller,
      verified_at = statement_timestamp(),
      updated_at = statement_timestamp()
    where identity.client_id = p_client_id and identity.revision = p_expected_revision
    returning identity.* into v_result;
    if not found then raise exception 'The CCC letter identity changed in another session. Reload and review it again.' using errcode = '40001'; end if;
  else
    if p_expected_revision is not null then raise exception 'The CCC letter identity was removed or changed. Reload and review it again.' using errcode = '40001'; end if;
    insert into public.ccc_client_letter_identities (
      client_id, user_id, first_name, last_name, address_line1, address_line2,
      city, state, zip, identity_document_id, identity_document_sha256,
      identity_document_storage_path, address_document_id,
      address_document_sha256, address_document_storage_path, revision,
      verified_by, verified_at
    ) values (
      v_client.id, v_client.user_id, v_first_name, v_last_name, v_address_line1,
      v_address_line2, v_city, v_state, v_zip, v_id_document.id,
      v_id_document.sha256, v_id_document.storage_path, v_address_document.id,
      v_address_document.sha256, v_address_document.storage_path, 1,
      v_caller, statement_timestamp()
    ) returning * into v_result;
  end if;
  return v_result;
exception when unique_violation then
  raise exception 'The CCC letter identity changed in another session. Reload and review it again.' using errcode = '40001';
end;
$$;

alter table public.letters
  add column if not exists ccc_letter_identity_snapshot jsonb not null default '{}'::jsonb;

alter table public.letters
  drop constraint if exists letters_ccc_letter_identity_snapshot_shape,
  add constraint letters_ccc_letter_identity_snapshot_shape
    check (public.ccc_letter_identity_snapshot_valid(ccc_letter_identity_snapshot));

create or replace function public.prevent_mailed_ccc_letter_identity_rewrite()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (coalesce(old.phase, '') like 'CCC Dispute —%' or coalesce(new.phase, '') like 'CCC Dispute —%')
    and (old.mailed_date is not null or old.lob_id is not null or new.mailed_date is not null or new.lob_id is not null)
    and old.ccc_letter_identity_snapshot is distinct from new.ccc_letter_identity_snapshot then
    raise exception 'A mailed CCC letter identity snapshot is immutable. Create a new letter revision.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_mailed_ccc_letter_identity on public.letters;
create trigger protect_mailed_ccc_letter_identity
before update on public.letters
for each row execute function public.prevent_mailed_ccc_letter_identity_rewrite();

revoke all on function public.ccc_letter_identity_snapshot(public.ccc_client_letter_identities)
  from public, anon, authenticated;
revoke all on function public.ccc_letter_identity_snapshot_valid(jsonb)
  from public, anon;
revoke all on function public.ccc_letter_identity_snapshot_matches_current(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.save_ccc_client_letter_identity(uuid, integer, text, text, text, text, text, text, text, uuid, uuid, boolean)
  from public, anon;
grant execute on function public.ccc_letter_identity_snapshot_valid(jsonb) to authenticated, service_role;
grant execute on function public.ccc_letter_identity_snapshot_matches_current(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_ccc_client_letter_identity(uuid, integer, text, text, text, text, text, text, text, uuid, uuid, boolean)
  to authenticated;

comment on column public.letters.ccc_letter_identity_snapshot is
  'Exact staff-attested name/address and identity-document revision that populated CCC letter curlys. Frozen after mail.';

commit;
