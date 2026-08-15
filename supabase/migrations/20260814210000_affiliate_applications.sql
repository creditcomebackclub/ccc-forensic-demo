-- Public affiliate applications are additive. Existing affiliates and the
-- staff-created invitation path remain authoritative and unchanged.

create table if not exists public.affiliate_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  company text,
  website_url text,
  referral_notes text,
  source text not null default 'public_link' check (source in ('public_link', 'staff_entered')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  affiliate_id uuid references public.affiliates(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email = lower(btrim(email))),
  check (length(name) between 1 and 120),
  check (length(email) between 3 and 254),
  check (phone is null or length(phone) <= 40),
  check (company is null or length(company) <= 160),
  check (website_url is null or length(website_url) <= 500),
  check (referral_notes is null or length(referral_notes) <= 1200),
  check (review_notes is null or length(review_notes) <= 1000),
  check (
    (status = 'pending' and reviewed_by is null and reviewed_at is null and affiliate_id is null)
    or (status = 'approved' and reviewed_by is not null and reviewed_at is not null and affiliate_id is not null)
    or (status = 'rejected' and reviewed_by is not null and reviewed_at is not null and affiliate_id is null)
  )
);

create unique index if not exists affiliate_applications_one_pending_email_uidx
  on public.affiliate_applications (lower(email))
  where status = 'pending';
create index if not exists affiliate_applications_status_created_idx
  on public.affiliate_applications (status, created_at desc);
create index if not exists affiliate_applications_owner_status_idx
  on public.affiliate_applications (user_id, status, created_at desc);

alter table public.affiliate_applications enable row level security;

drop policy if exists "admin_manage_affiliate_applications" on public.affiliate_applications;
create policy "admin_manage_affiliate_applications"
on public.affiliate_applications for all to authenticated
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

grant select, insert, update, delete on public.affiliate_applications to authenticated;
grant all on public.affiliate_applications to service_role;

-- Approval is atomic: one application becomes one affiliate record before the
-- browser asks the existing provision-user endpoint to send portal access.
-- A failed email remains recoverable through the existing Resend Invite action.
create or replace function public.approve_affiliate_application(
  p_application_id uuid,
  p_commission_rate numeric default 0.20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_application public.affiliate_applications%rowtype;
  v_affiliate public.affiliates%rowtype;
begin
  if v_caller is null or not exists (
    select 1 from public.profiles where id = v_caller and role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_commission_rate is null or p_commission_rate <= 0 or p_commission_rate > 1 then
    raise exception 'Commission rate must be greater than 0 and no more than 1';
  end if;

  select * into v_application
  from public.affiliate_applications
  where id = p_application_id
  for update;
  if not found then raise exception 'Affiliate application not found'; end if;

  if v_application.status = 'approved' and v_application.affiliate_id is not null then
    select * into v_affiliate from public.affiliates where id = v_application.affiliate_id;
    return jsonb_build_object(
      'application', to_jsonb(v_application),
      'affiliate', to_jsonb(v_affiliate),
      'already_approved', true
    );
  end if;
  if v_application.status <> 'pending' then
    raise exception 'Only pending affiliate applications can be approved';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('affiliate:' || v_application.email, 0));
  select * into v_affiliate
  from public.affiliates
  where lower(btrim(email)) = v_application.email
  order by created_at
  limit 1;

  if not found then
    insert into public.affiliates (
      name, email, company, commission_rate, brand_name, brand_color
    ) values (
      v_application.name,
      v_application.email,
      nullif(v_application.company, ''),
      p_commission_rate,
      coalesce(nullif(v_application.company, ''), v_application.name),
      '#22C55E'
    ) returning * into v_affiliate;
  end if;

  update public.affiliate_applications
  set status = 'approved', affiliate_id = v_affiliate.id,
      reviewed_by = v_caller, reviewed_at = now(), updated_at = now()
  where id = v_application.id
  returning * into v_application;

  return jsonb_build_object(
    'application', to_jsonb(v_application),
    'affiliate', to_jsonb(v_affiliate),
    'already_approved', false
  );
end;
$$;

revoke all on function public.approve_affiliate_application(uuid, numeric) from public;
grant execute on function public.approve_affiliate_application(uuid, numeric) to authenticated;

create or replace function public.reject_affiliate_application(
  p_application_id uuid,
  p_notes text default null
)
returns public.affiliate_applications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_application public.affiliate_applications%rowtype;
begin
  if v_caller is null or not exists (
    select 1 from public.profiles where id = v_caller and role = 'admin'
  ) then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Review notes exceed the allowed length';
  end if;

  select * into v_application
  from public.affiliate_applications
  where id = p_application_id
  for update;
  if not found then raise exception 'Affiliate application not found'; end if;
  if v_application.status = 'rejected' then return v_application; end if;
  if v_application.status <> 'pending' then
    raise exception 'Only pending affiliate applications can be rejected';
  end if;

  update public.affiliate_applications
  set status = 'rejected', reviewed_by = v_caller, reviewed_at = now(),
      review_notes = nullif(btrim(p_notes), ''), updated_at = now()
  where id = v_application.id
  returning * into v_application;
  return v_application;
end;
$$;

revoke all on function public.reject_affiliate_application(uuid, text) from public;
grant execute on function public.reject_affiliate_application(uuid, text) to authenticated;

-- Rollback is intentionally simple and non-destructive to existing affiliates:
-- disable the public route, then drop these two functions and this table. Any
-- affiliates already approved remain ordinary affiliates and keep portal access.
