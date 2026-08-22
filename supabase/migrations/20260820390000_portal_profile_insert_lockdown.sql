-- client_profiles is an identity-link table, not a portal-authored profile.
-- The former self-INSERT policy let any authenticated caller bind their own
-- Auth UUID to an arbitrary CRM client_id.  Canonical profile creation and
-- linking now stays behind ccc_link_portal_profile_for_onboarding(), whose
-- EXECUTE grant is service_role-only.

-- Remove every INSERT policy reachable by browser roles.  The named drop
-- documents the production-baseline policy; the catalog sweep also closes any
-- compatibility policy that may exist in an older environment.
drop policy if exists "client_profiles_insert_own_or_staff"
  on public.client_profiles;

do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'client_profiles'
      and cmd = 'INSERT'
      and roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  loop
    execute format(
      'drop policy %I on public.client_profiles',
      v_policy.policyname
    );
  end loop;
end;
$$;

revoke insert on table public.client_profiles from public, anon, authenticated;

-- Preserve the server-only writer used by the transaction-locked onboarding
-- linker.  SECURITY DEFINER execution also remains independently restricted
-- to service_role in 20260820260000_service_agreement_only.sql.
grant insert on table public.client_profiles to service_role;

-- Release audit: return identifiers plus machine-readable integrity findings,
-- never PII.  The function is deliberately read-only and does not choose or
-- repair a mapping; every reported row requires explicit staff resolution.
create or replace function public.ccc_audit_portal_profile_link_integrity()
returns table (
  profile_id uuid,
  portal_user_id uuid,
  client_id uuid,
  issue_codes text[]
)
language sql
stable
security definer
set search_path = ''
as $$
  with client_link_counts as (
    select cp.client_id, count(*)::integer as profile_count
    from public.client_profiles cp
    where cp.client_id is not null
    group by cp.client_id
  ),
  normalized_email_counts as (
    select lower(btrim(cp.email)) as normalized_email,
           count(*)::integer as profile_count
    from public.client_profiles cp
    group by lower(btrim(cp.email))
  )
  select cp.id as profile_id,
         cp.user_id as portal_user_id,
         cp.client_id,
         findings.issue_codes
  from public.client_profiles cp
  left join auth.users portal_user on portal_user.id = cp.user_id
  left join public.clients client on client.id = cp.client_id
  left join public.profiles identity_profile on identity_profile.id = cp.user_id
  left join client_link_counts client_links on client_links.client_id = cp.client_id
  left join normalized_email_counts email_links
    on email_links.normalized_email = lower(btrim(cp.email))
  cross join lateral (
    select array_remove(array[
      case when cp.user_id is null then 'missing_portal_user_id' end,
      case when cp.user_id is not null and portal_user.id is null
        then 'auth_user_missing' end,
      case when cp.client_id is null then 'missing_client_id' end,
      case when cp.client_id is not null and client.id is null
        then 'client_missing' end,
      case when portal_user.id is not null
             and lower(btrim(cp.email))
               is distinct from lower(btrim(coalesce(portal_user.email, '')))
        then 'portal_auth_email_mismatch' end,
      case when client.id is not null
             and lower(btrim(cp.email))
               is distinct from lower(btrim(coalesce(client.email, '')))
        then 'portal_client_email_mismatch' end,
      case when coalesce(client_links.profile_count, 0) > 1
        then 'duplicate_client_link' end,
      case when coalesce(email_links.profile_count, 0) > 1
        then 'duplicate_normalized_email' end,
      case when portal_user.id is not null and identity_profile.id is null
        then 'portal_role_missing' end,
      case when identity_profile.id is not null
             and identity_profile.role <> 'client'
        then 'non_client_profile_identity' end,
      case when exists (
        select 1
        from public.affiliates affiliate
        where affiliate.user_id = cp.user_id
      ) then 'affiliate_identity_linked' end
    ]::text[], null) as issue_codes
  ) findings
  where cardinality(findings.issue_codes) > 0
  order by cp.id;
$$;

revoke all on function public.ccc_audit_portal_profile_link_integrity()
  from public, anon, authenticated;
grant execute on function public.ccc_audit_portal_profile_link_integrity()
  to service_role;

comment on function public.ccc_audit_portal_profile_link_integrity() is
  'Service-role-only, read-only release audit for ambiguous or cross-client portal profile mappings; returns identifiers and issue codes only.';

-- Fail the migration rather than silently shipping an incomplete lockdown.
do $$
begin
  if pg_catalog.has_table_privilege('anon', 'public.client_profiles', 'INSERT')
     or pg_catalog.has_table_privilege('authenticated', 'public.client_profiles', 'INSERT') then
    raise exception 'Browser roles still have direct INSERT on public.client_profiles.';
  end if;

  if not pg_catalog.has_table_privilege('service_role', 'public.client_profiles', 'INSERT') then
    raise exception 'service_role must retain INSERT on public.client_profiles.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'client_profiles'
      and cmd = 'INSERT'
      and roles && array['public'::name, 'anon'::name, 'authenticated'::name]
  ) then
    raise exception 'A browser-reachable client_profiles INSERT policy remains.';
  end if;
end;
$$;
