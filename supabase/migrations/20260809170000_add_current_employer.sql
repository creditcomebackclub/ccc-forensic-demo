-- Persist the staff-verified employer separately from report-derived former
-- employers. This value is protected as keep-on-file evidence in later rounds.
alter table public.clients
  add column if not exists current_employer text;

comment on column public.clients.current_employer is
  'Staff-verified current employer to retain on bureau files and use in dispute letters.';
