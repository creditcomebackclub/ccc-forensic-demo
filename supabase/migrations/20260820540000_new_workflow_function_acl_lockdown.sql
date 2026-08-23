begin;

-- Supabase grants EXECUTE on newly-created public functions directly to anon
-- and authenticated through default privileges. Revoking only from PUBLIC is
-- therefore insufficient. Normalize every callable boundary introduced by
-- the 5100-5300 cutover to its exact intended roles.

revoke all on function public.ccc_round_reason_snapshot_valid_or_legacy(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_round_reason_snapshot_valid_or_legacy(jsonb)
  to authenticated, service_role;

revoke all on function public.ccc_storage_object_has_active_mail_claim(text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_storage_object_has_active_mail_claim(text, text)
  to authenticated, service_role;

revoke all on function public.claim_ccc_track_revisions_for_mail(text, uuid, jsonb, jsonb, text, text, jsonb, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_ccc_track_revisions_for_mail(text, uuid, jsonb, jsonb, text, text, jsonb, jsonb)
  to service_role;

revoke all on function public.release_ccc_track_revision_mail_claims(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.release_ccc_track_revision_mail_claims(text, uuid, text)
  to service_role;

revoke all on function public.ccc_operations_deterministic_audit_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_operations_deterministic_audit_valid(jsonb)
  to service_role;

revoke all on function public.ccc_operations_fresh_r1_audit_valid(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_operations_fresh_r1_audit_valid(jsonb)
  to service_role;

revoke all on function public.ccc_operations_lifecycle_audit_valid(text, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_operations_lifecycle_audit_valid(text, uuid, jsonb)
  to service_role;

revoke all on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_create_or_resume_audit_job(uuid, text, jsonb, uuid, jsonb)
  to authenticated, service_role;

revoke all on function public.ccc_claim_audit_job(uuid, uuid, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_claim_audit_job(uuid, uuid, text, integer)
  to service_role;

revoke all on function public.ccc_claim_next_audit_checkpoint(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_claim_next_audit_checkpoint(uuid, uuid)
  to service_role;

revoke all on function public.ccc_complete_audit_checkpoint(uuid, uuid, jsonb, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_complete_audit_checkpoint(uuid, uuid, jsonb, text, jsonb)
  to service_role;

revoke all on function public.ccc_split_audit_checkpoint(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_split_audit_checkpoint(uuid, uuid, text, text)
  to service_role;

revoke all on function public.ccc_release_audit_job(uuid, uuid, text, text, text, text, timestamptz, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_release_audit_job(uuid, uuid, text, text, text, text, timestamptz, uuid)
  to service_role;

revoke all on function public.ccc_finish_audit_job(uuid, uuid, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_finish_audit_job(uuid, uuid, jsonb, jsonb, text)
  to service_role;

revoke all on function public.ccc_reclaim_stale_audit_jobs(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_reclaim_stale_audit_jobs(integer)
  to service_role;

revoke all on function public.ccc_claim_orphan_audit_upload_cleanup(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.ccc_claim_orphan_audit_upload_cleanup(integer)
  to service_role;

do $acl_assertions$
declare
  v_function regprocedure;
  v_service_only regprocedure[] := array[
    'public.claim_ccc_track_revisions_for_mail(text,uuid,jsonb,jsonb,text,text,jsonb,jsonb)'::regprocedure,
    'public.release_ccc_track_revision_mail_claims(text,uuid,text)'::regprocedure,
    'public.ccc_operations_deterministic_audit_valid(jsonb)'::regprocedure,
    'public.ccc_operations_fresh_r1_audit_valid(jsonb)'::regprocedure,
    'public.ccc_operations_lifecycle_audit_valid(text,uuid,jsonb)'::regprocedure,
    'public.ccc_claim_audit_job(uuid,uuid,text,integer)'::regprocedure,
    'public.ccc_claim_next_audit_checkpoint(uuid,uuid)'::regprocedure,
    'public.ccc_complete_audit_checkpoint(uuid,uuid,jsonb,text,jsonb)'::regprocedure,
    'public.ccc_split_audit_checkpoint(uuid,uuid,text,text)'::regprocedure,
    'public.ccc_release_audit_job(uuid,uuid,text,text,text,text,timestamptz,uuid)'::regprocedure,
    'public.ccc_finish_audit_job(uuid,uuid,jsonb,jsonb,text)'::regprocedure,
    'public.ccc_reclaim_stale_audit_jobs(integer)'::regprocedure,
    'public.ccc_claim_orphan_audit_upload_cleanup(integer)'::regprocedure
  ];
begin
  foreach v_function in array v_service_only loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Service-only function ACL mismatch: %', v_function;
    end if;
  end loop;

  if pg_catalog.has_function_privilege(
       'anon',
       'public.ccc_create_or_resume_audit_job(uuid,text,jsonb,uuid,jsonb)'::regprocedure,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'authenticated',
       'public.ccc_create_or_resume_audit_job(uuid,text,jsonb,uuid,jsonb)'::regprocedure,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'service_role',
       'public.ccc_create_or_resume_audit_job(uuid,text,jsonb,uuid,jsonb)'::regprocedure,
       'EXECUTE'
     ) then
    raise exception 'Audit job creation ACL mismatch';
  end if;

  foreach v_function in array array[
    'public.ccc_round_reason_snapshot_valid_or_legacy(jsonb)'::regprocedure,
    'public.ccc_storage_object_has_active_mail_claim(text,text)'::regprocedure
  ] loop
    if pg_catalog.has_function_privilege('anon', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not pg_catalog.has_function_privilege('service_role', v_function, 'EXECUTE') then
      raise exception 'Authenticated helper ACL mismatch: %', v_function;
    end if;
  end loop;
end;
$acl_assertions$;

commit;
