-- A Lob cancellation is a terminal submission result distinct from a render
-- failure. It remains retryable only through a fresh, explicit mail attempt.
alter table public.mail_submissions
  drop constraint if exists mail_submissions_status_check;

alter table public.mail_submissions
  add constraint mail_submissions_status_check
  check (status in ('pending', 'submitted', 'failed', 'accepted_unreconciled', 'cancelled'));
