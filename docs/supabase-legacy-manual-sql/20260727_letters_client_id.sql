-- Phase 5 of the client_id migration. Same pattern as documents/audits/
-- client_accounts: additive nullable column, backfill only where exactly
-- one clients row matches (ambiguous rows left null rather than guessed),
-- supporting index, transitional RLS.
--
-- letters already has an unrelated client_account_id FK (-> client_accounts,
-- the persistent tradeline identity) — untouched here, different purpose.

alter table public.letters
  add column if not exists client_id uuid references public.clients(id) on delete cascade;

update public.letters l
set client_id = c.id
from public.clients c
where l.client_id is null
  and l.user_id = c.user_id
  and l.client_name = c.name
  and (select count(*) from public.clients c2 where c2.user_id = l.user_id and c2.name = l.client_name) = 1;

create index if not exists letters_user_client_idx
  on public.letters (user_id, client_id);

drop policy if exists "client_read_own_letters" on public.letters;
create policy "client_read_own_letters" on public.letters for select using (
  exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = letters.client_id)
        or cp.full_name = letters.client_name
      )
  )
);
