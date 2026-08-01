-- Drop dashboard-era storage.objects policies that OR-widen the
-- path-scoped documents/responses policies from 20260731000000 /
-- 20260731010000. Permissive policies combine with OR, so leaving these
-- in place undoes path ownership for auditors (responses) and lets any
-- authenticated user manage a documents/responses folder matching their
-- own auth.uid() (wrong shape for firm-owned client docs).
--
-- Intentionally kept:
--   - client-docs policies (LPOA / signature / settings)
--   - "Authenticated upload lpoa files" (lpoa bucket)

drop policy if exists "Admins can manage all responses" on storage.objects;
drop policy if exists "Users manage own document files" on storage.objects;
drop policy if exists "Users manage own responses" on storage.objects;
