-- Bind every newly archived Lob artifact to the exact durable mail attempt
-- (submission row + rotating idempotency key), not only the reusable letter
-- row or provider Lob ID. This prevents a delayed artifact from attempt A
-- being attached after the same letter has been reset for attempt B.
--
-- Compatibility: historical artifacts that cannot be matched to the current
-- durable submission are retained and explicitly marked legacy_unbound.
-- Rollback: drop the trigger/function, indexes/constraints/FK, then the three
-- additive columns. Historical evidence rows and stored objects are preserved.

begin;

alter table public.mail_artifacts
  add column if not exists mail_submission_id uuid,
  add column if not exists idempotency_key text,
  add column if not exists legacy_unbound boolean not null default false;

-- A partially deployed predecessor may already have installed the immutable
-- evidence trigger before this migration is recorded in the migration ledger.
-- Suspend it only inside this transaction so the one-time attempt-binding
-- backfill can complete; the hardened trigger is recreated below.
drop trigger if exists protect_archived_mail_artifact_trigger on public.mail_artifacts;

update public.mail_artifacts artifact
set mail_submission_id = submission.id,
    idempotency_key = submission.idempotency_key,
    legacy_unbound = false
from public.mail_submissions submission
where artifact.mail_submission_id is null
  and artifact.lob_id = submission.lob_id;

update public.mail_artifacts
set legacy_unbound = true
where mail_submission_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'mail_artifacts_submission_fkey'
      and conrelid = 'public.mail_artifacts'::regclass
  ) then
    alter table public.mail_artifacts
      add constraint mail_artifacts_submission_fkey
      foreign key (mail_submission_id)
      references public.mail_submissions(id)
      on delete restrict;
  end if;
end;
$$;

alter table public.mail_artifacts
  drop constraint if exists mail_artifacts_attempt_binding_complete,
  add constraint mail_artifacts_attempt_binding_complete check (
    (legacy_unbound = true and mail_submission_id is null and idempotency_key is null)
    or
    (legacy_unbound = false and mail_submission_id is not null and length(btrim(idempotency_key)) between 1 and 200)
  );

create unique index if not exists mail_artifacts_attempt_type_key
  on public.mail_artifacts(mail_submission_id, idempotency_key, artifact_type)
  where legacy_unbound = false;

create or replace function public.protect_archived_mail_artifact()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Archived mail evidence cannot be deleted.';
  end if;
  if old.status = 'archived' then
    raise exception 'Archived mail evidence is immutable.';
  end if;
  if new.mail_submission_id is distinct from old.mail_submission_id
     or new.idempotency_key is distinct from old.idempotency_key
     or new.legacy_unbound is distinct from old.legacy_unbound
     or new.letter_id is distinct from old.letter_id
     or new.lob_id is distinct from old.lob_id
     or new.user_id is distinct from old.user_id
     or new.client_id is distinct from old.client_id then
    raise exception 'Mail artifact attempt identity is immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_archived_mail_artifact_trigger on public.mail_artifacts;
create trigger protect_archived_mail_artifact_trigger
before update or delete on public.mail_artifacts
for each row execute function public.protect_archived_mail_artifact();

drop policy if exists "staff_update_mail_artifacts" on public.mail_artifacts;
revoke all on public.mail_artifacts from anon, authenticated;
grant select on public.mail_artifacts to authenticated;
grant all on public.mail_artifacts to service_role;

drop policy if exists "staff_read_mail_artifacts" on public.mail_artifacts;
create policy "staff_read_mail_artifacts"
on public.mail_artifacts for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or public.mail_artifacts.user_id = auth.uid())
  )
);

-- The baseline granted every table privilege even where RLS happened to
-- suppress browser writes. Keep both the durable attempt and its archived
-- artifact service-owned at the privilege boundary as well.
revoke all on public.mail_submissions from anon, authenticated;
grant select on public.mail_submissions to authenticated;
grant all on public.mail_submissions to service_role;

drop policy if exists "staff_read_mail_submissions" on public.mail_submissions;
create policy "staff_read_mail_submissions"
on public.mail_submissions for select to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or public.mail_submissions.user_id = auth.uid())
  )
);

-- Archived bytes are evidence too. Staff retain read access through the
-- existing documents-bucket SELECT policy, but only the service role may
-- create, replace, or delete objects below {firm}/mail-artifacts/....
drop policy if exists "staff_insert_documents_storage" on storage.objects;
create policy "staff_insert_documents_storage"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'documents'
  and coalesce((storage.foldername(name))[2], '') <> 'mail-artifacts'
  and (storage.foldername(name))[3] is distinct from 'agreements'
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

drop policy if exists "staff_update_documents_storage" on storage.objects;
create policy "staff_update_documents_storage"
on storage.objects for update to authenticated
using (
  bucket_id = 'documents'
  and coalesce((storage.foldername(name))[2], '') <> 'mail-artifacts'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
)
with check (
  bucket_id = 'documents'
  and coalesce((storage.foldername(name))[2], '') <> 'mail-artifacts'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

drop policy if exists "staff_delete_documents_storage" on storage.objects;
create policy "staff_delete_documents_storage"
on storage.objects for delete to authenticated
using (
  bucket_id = 'documents'
  and coalesce((storage.foldername(name))[2], '') <> 'mail-artifacts'
  and not public.ccc_is_immutable_portal_artifact_path(name)
  and exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'auditor')
      and (p.role = 'admin' or (storage.foldername(name))[1] = auth.uid()::text)
  )
);

comment on column public.mail_artifacts.mail_submission_id is
  'Exact durable submission row that produced this artifact; null only for preserved legacy evidence.';
comment on column public.mail_artifacts.idempotency_key is
  'Frozen attempt key captured before archival. The submission row may later rotate its current key for an explicit retry.';
comment on column public.mail_artifacts.legacy_unbound is
  'True only for preserved historical evidence that could not be matched to the current durable mail attempt at migration time.';

commit;
