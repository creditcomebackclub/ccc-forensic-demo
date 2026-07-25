-- Standalone signature-capture link (public/sign-lpoa.html) currently
-- authorizes purely on knowing a client's exact name in the URL — the
-- `token` param it already sends is never actually checked server-side.
-- Needed for clients with no portal account/email (e.g. Swiftedly
-- referrals), where this link is the ONLY way to capture a signature, so
-- it needs real per-client authorization rather than security-by-obscurity
-- on a guessable name. gen_random_uuid() as the default backfills a real,
-- unique token onto every existing row as part of this ALTER, so no
-- separate backfill step is needed.
alter table public.clients
  add column if not exists sign_token uuid not null default gen_random_uuid() unique;
