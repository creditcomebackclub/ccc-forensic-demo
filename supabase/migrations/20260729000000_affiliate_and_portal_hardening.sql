-- Keep affiliate records private to their owner/admin while preserving the
-- first-login email lookup used to wire a newly invited partner.
drop policy if exists "Affiliate select for auth lookup" on public.affiliates;
drop policy if exists "affiliate_select_own_or_matching_email" on public.affiliates;
create policy "affiliate_select_own_or_matching_email"
on public.affiliates for select to authenticated
using (
  auth.uid() = user_id
  or lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
);

-- Client IDs are the canonical portal association. Name matching remains only
-- for historical profiles that have not yet been linked to a client record.
drop policy if exists "client_read_own_meta" on public.clients;
create policy "client_read_own_meta"
on public.clients for select to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = clients.id)
        or (cp.client_id is null and cp.full_name = clients.name)
      )
  )
);

drop policy if exists "client_update_own_meta" on public.clients;
create policy "client_update_own_meta"
on public.clients for update to authenticated
using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = clients.id)
        or (cp.client_id is null and cp.full_name = clients.name)
      )
  )
)
with check (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = clients.id)
        or (cp.client_id is null and cp.full_name = clients.name)
      )
  )
);
