-- Progress Update Studio: staff review/edit before portal publish + email.
-- Rows stay draft until staff explicitly sends; previously emailed rows are
-- backfilled to status = 'sent' so the portal gate stays correct.

alter table public.progress_updates
  add column if not exists status text,
  add column if not exists sent_to text,
  add column if not exists sent_by uuid references auth.users(id),
  add column if not exists email_subject text,
  add column if not exists email_body text;

update public.progress_updates
set status = 'sent'
where emailed_at is not null
  and (status is null or status = '');

update public.progress_updates
set status = 'draft'
where status is null or status = '';

alter table public.progress_updates
  alter column status set default 'draft',
  alter column status set not null;

alter table public.progress_updates
  drop constraint if exists progress_updates_status_check;

alter table public.progress_updates
  add constraint progress_updates_status_check
  check (status in ('draft', 'sent'));

comment on column public.progress_updates.status is
  'draft until staff sends via Progress Update Studio; sent publishes to portal + email';
comment on column public.progress_updates.email_subject is
  'Staff-edited teaser subject; used on send';
comment on column public.progress_updates.email_body is
  'Staff-edited teaser body; used on send (portal still shows full narrative)';
