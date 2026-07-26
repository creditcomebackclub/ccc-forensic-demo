-- Phase 6 of the client_id migration. Same pattern as documents/audits/
-- client_accounts/letters: additive nullable column, backfill only where
-- exactly one clients row matches (ambiguous rows left null rather than
-- guessed), supporting index, transitional RLS.

alter table public.progress_updates
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

update public.progress_updates p
set client_id = c.id
from public.clients c
where p.client_id is null
  and p.user_id = c.user_id
  and p.client_name = c.name
  and (select count(*) from public.clients c2 where c2.user_id = p.user_id and c2.name = p.client_name) = 1;

create index if not exists progress_updates_user_client_idx
  on public.progress_updates (user_id, client_id);

drop policy if exists "client_read_own_progress" on public.progress_updates;
create policy "client_read_own_progress" on public.progress_updates for select using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = progress_updates.client_id)
        or cp.full_name = progress_updates.client_name
      )
  )
);
