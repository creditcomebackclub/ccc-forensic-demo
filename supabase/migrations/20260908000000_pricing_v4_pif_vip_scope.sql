-- Accept the active V4 six-month VIP snapshot while preserving immutable
-- historical Paid In Full snapshots that froze the former Standard scope.
-- This changes validation only; existing agreements, commands, invoices, and
-- ledger entries are never rewritten.

begin;

do $migration$
declare
  v_signature regprocedure := to_regprocedure(
    'public.ccc_create_manual_agreement_invoice(uuid,uuid,uuid,date)'
  );
  v_definition text;
  v_old_scope_check text :=
    'v_plan #>> ''{serviceScope,scopeBasis}'' is distinct from ''Standard''';
begin
  if v_signature is null then
    raise exception 'ccc_create_manual_agreement_invoice is required before the V4 pricing migration';
  end if;

  select pg_get_functiondef(v_signature) into v_definition;
  if position(v_old_scope_check in v_definition) = 0 then
    raise exception 'Expected V3 Paid In Full scope guard was not found; refusing an unsafe rewrite';
  end if;

  v_definition := replace(
    v_definition,
    v_old_scope_check,
    'coalesce(v_plan #>> ''{serviceScope,scopeBasis}'', '''') not in (''Standard'', ''VIP'')'
  );
  v_definition := replace(
    v_definition,
    'Paid In Full must cover exactly 6 months of Standard service',
    'Paid In Full must cover exactly 6 months of service'
  );
  v_definition := replace(
    v_definition,
    'Paid In Full must freeze the Standard service scope',
    'Paid In Full must freeze an approved six-month service scope'
  );

  execute v_definition;
end;
$migration$;

comment on function public.ccc_create_manual_agreement_invoice(uuid, uuid, uuid, date) is
  'Owner-only, idempotent opening invoice from an immutable agreement snapshot. V4 Paid In Full freezes VIP scope; historical V3 Standard-scope snapshots remain invoice-compatible. Never charges, emails, activates, pauses, or authorizes service.';

commit;

-- Rollback: restore the function definition from
-- 20260820480000_custom_billing_invoice_integrity.sql. Existing snapshots and
-- ledger entries remain immutable.
