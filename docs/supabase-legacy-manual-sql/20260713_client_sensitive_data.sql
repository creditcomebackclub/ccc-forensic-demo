-- SSN last-4 and monitoring-service password currently live in plaintext on
-- clients.ssn_last4 / clients.monitoring_password and are fetched into the
-- browser by every bulk client-list query (adminListClients selects both
-- columns for every client on every dashboard load). Moves both values to a
-- dedicated table with no browser-facing RLS policies at all -- only the
-- service role can read or write it, exclusively via
-- netlify/functions/client-sensitive-data.mjs, which encrypts/decrypts with
-- AES-256-GCM (CLIENT_DATA_ENCRYPTION_KEY) and enforces staff-or-self
-- authorization server-side against a verified caller JWT.
--
-- This migration only creates the table. Backfilling encrypted values from
-- clients.ssn_last4/monitoring_password and dropping those plaintext columns
-- happens in a separate one-off script (scripts/migrate-sensitive-data.mjs)
-- that verifies every value decrypts back correctly before anything is
-- dropped -- do not run that script until CLIENT_DATA_ENCRYPTION_KEY is
-- confirmed live in Netlify.
create table if not exists public.client_sensitive_data (
  id                  uuid primary key default gen_random_uuid(),
  client_id           uuid not null references public.clients(id) on delete cascade,
  ssn_last4           text,
  monitoring_password text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists client_sensitive_data_client_id_idx
  on public.client_sensitive_data (client_id);

alter table public.client_sensitive_data enable row level security;
-- Deliberately zero policies. With RLS on and no policies, anon and
-- authenticated roles get no access at all -- only the service role (which
-- bypasses RLS) can touch this table, and only the Netlify function above
-- holds that key.
