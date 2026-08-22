-- Fix affiliate agreement SHA-256 calls when pgcrypto is installed in the
-- extensions schema. Preserve each current function definition (including its
-- SECURITY DEFINER search_path) and replace only the broken digest expression.
-- No affiliate row, agreement artifact, status, or permission is changed.

begin;

do $digest_fix$
declare
  v_signature regprocedure;
  v_definition text;
  v_patched text;
begin
  for v_signature in
    select unnest(array[
      'public.ccc_prepare_affiliate_agreement(uuid,numeric,text,text)'::regprocedure,
      'public.ccc_mark_affiliate_agreement_sent(uuid,uuid,timestamptz)'::regprocedure,
      'public.ccc_activate_affiliate(uuid)'::regprocedure,
      'public.ccc_claim_affiliate_agreement_signing(uuid,uuid,text)'::regprocedure,
      'public.ccc_complete_affiliate_agreement(uuid,uuid,timestamptz,text,inet,text,text,text,text,text,jsonb)'::regprocedure
    ])
  loop
    v_definition := pg_catalog.pg_get_functiondef(v_signature);
    if pg_catalog.strpos(v_definition, 'encode(digest(') = 0
       and pg_catalog.strpos(v_definition, 'extensions.digest') > 0
       and pg_catalog.strpos(v_definition, 'pg_catalog.convert_to') > 0 then
      continue;
    end if;
    v_patched := pg_catalog.replace(
      v_definition,
      $needle$encode(digest(coalesce(v_template.body_html, ''), 'sha256'), 'hex')$needle$,
      $replacement$pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(v_template.body_html, ''), 'UTF8'), 'sha256'), 'hex')$replacement$
    );
    v_patched := pg_catalog.replace(
      v_patched,
      $needle$encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex')$needle$,
      $replacement$pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_agreement.document_snapshot ->> 'bodyHtml', 'UTF8'), 'sha256'), 'hex')$replacement$
    );

    if v_patched is not distinct from v_definition then
      raise exception 'Expected digest expression was not found in %', v_signature;
    end if;
    if pg_catalog.strpos(v_patched, 'encode(digest(') > 0
       or pg_catalog.strpos(v_patched, 'extensions.digest') = 0
       or pg_catalog.strpos(v_patched, 'pg_catalog.convert_to') = 0 then
      raise exception 'Digest qualification failed for %', v_signature;
    end if;

    execute v_patched;
  end loop;
end;
$digest_fix$;

-- Reassert the exact prior execution boundary after CREATE OR REPLACE.
revoke all on function public.ccc_prepare_affiliate_agreement(uuid, numeric, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_prepare_affiliate_agreement(uuid, numeric, text, text)
  to authenticated;

revoke all on function public.ccc_activate_affiliate(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_activate_affiliate(uuid)
  to authenticated;

revoke all on function public.ccc_mark_affiliate_agreement_sent(uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_mark_affiliate_agreement_sent(uuid, uuid, timestamptz)
  to service_role;

revoke all on function public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_claim_affiliate_agreement_signing(uuid, uuid, text)
  to service_role;

revoke all on function public.ccc_complete_affiliate_agreement(
  uuid, uuid, timestamptz, text, inet, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.ccc_complete_affiliate_agreement(
  uuid, uuid, timestamptz, text, inet, text, text, text, text, text, jsonb
) to service_role;

commit;

-- Rollback: restore the exact prior function definitions from migrations
-- 20260820380000 and 20260820440000. No data rollback is necessary.
