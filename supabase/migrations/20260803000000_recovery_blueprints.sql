-- Recovery Blueprint artifacts are a presentation layer over an existing,
-- reviewed audit. The audit JSON remains the forensic source of truth.

create table if not exists public.recovery_blueprints (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  client_name text not null,
  report_date text not null,
  version integer not null check (version > 0),
  status text not null default 'approved' check (status in ('approved', 'sent')),
  template_version text not null,
  storage_path text not null unique,
  file_name text not null,
  file_sha256 text not null,
  audit_sha256 text not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz not null default now(),
  sent_to text,
  sent_at timestamptz,
  sendgrid_message_id text,
  delivery_status text,
  delivery_event_at timestamptz,
  delivery_error text,
  delivered_at timestamptz,
  viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (audit_id, version)
);

create index if not exists recovery_blueprints_client_idx
  on public.recovery_blueprints (client_id, approved_at desc);
create index if not exists recovery_blueprints_audit_idx
  on public.recovery_blueprints (audit_id, version desc);

alter table public.recovery_blueprints enable row level security;

drop policy if exists "staff_manage_recovery_blueprints" on public.recovery_blueprints;
create policy "staff_manage_recovery_blueprints"
on public.recovery_blueprints for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or (p.role = 'auditor' and recovery_blueprints.user_id = p.id))
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or (p.role = 'auditor' and recovery_blueprints.user_id = p.id))
  )
);

drop policy if exists "client_read_own_recovery_blueprints" on public.recovery_blueprints;
create policy "client_read_own_recovery_blueprints"
on public.recovery_blueprints for select to authenticated
using (
  status in ('approved', 'sent')
  and exists (
    select 1 from public.client_profiles cp
    where cp.user_id = auth.uid()
      and (
        (cp.client_id is not null and cp.client_id = recovery_blueprints.client_id)
        or (cp.client_id is null and cp.full_name = recovery_blueprints.client_name)
      )
  )
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recovery-blueprints', 'recovery-blueprints', false, 10485760, array['application/pdf'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Files are written only by the server's service role. Authenticated users
-- may create short-lived signed URLs only when the artifact row belongs to
-- their staff scope or portal identity.
drop policy if exists "authorized_read_recovery_blueprint_files" on storage.objects;
create policy "authorized_read_recovery_blueprint_files"
on storage.objects for select to authenticated
using (
  bucket_id = 'recovery-blueprints'
  and exists (
    select 1 from public.recovery_blueprints rb
    where rb.storage_path = storage.objects.name
      and (
        exists (
          select 1 from public.profiles p
          where p.id = auth.uid()
            and (p.role = 'admin' or (p.role = 'auditor' and rb.user_id = p.id))
        )
        or (
          rb.status in ('approved', 'sent')
          and exists (
            select 1 from public.client_profiles cp
            where cp.user_id = auth.uid()
              and (
                (cp.client_id is not null and cp.client_id = rb.client_id)
                or (cp.client_id is null and cp.full_name = rb.client_name)
              )
          )
        )
      )
  )
);

grant select, insert, update, delete on public.recovery_blueprints to authenticated;
grant all on public.recovery_blueprints to service_role;

create or replace function public.mark_recovery_blueprint_viewed(p_blueprint_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.recovery_blueprints rb
  set viewed_at = coalesce(rb.viewed_at, now()), updated_at = now()
  where rb.id = p_blueprint_id
    and rb.status in ('approved', 'sent')
    and exists (
      select 1 from public.client_profiles cp
      where cp.user_id = auth.uid()
        and (
          (cp.client_id is not null and cp.client_id = rb.client_id)
          or (cp.client_id is null and cp.full_name = rb.client_name)
        )
    );
end;
$$;

revoke all on function public.mark_recovery_blueprint_viewed(uuid) from public;
grant execute on function public.mark_recovery_blueprint_viewed(uuid) to authenticated;
