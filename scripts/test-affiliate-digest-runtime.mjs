import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const onboarding = readFileSync(new URL('../supabase/migrations/20260820380000_affiliate_agreement_onboarding.sql', import.meta.url), 'utf8');
const signingClaim = readFileSync(new URL('../supabase/migrations/20260820440000_affiliate_signing_evidence_claim.sql', import.meta.url), 'utf8');
const runtimeFix = readFileSync(new URL('../supabase/migrations/20260820490000_affiliate_digest_runtime_fix.sql', import.meta.url), 'utf8');

function functionDefinition(source, name, fromIndex = 0) {
  const marker = `create or replace function public.${name}(`;
  const start = source.indexOf(marker, fromIndex);
  assert.notEqual(start, -1, `${name} definition must exist`);
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} definition must terminate`);
  return source.slice(start, end + 4);
}

function patchDigest(definition) {
  return definition
    .replace(
      "encode(digest(coalesce(v_template.body_html, ''), 'sha256'), 'hex')",
      "pg_catalog.encode(extensions.digest(pg_catalog.convert_to(coalesce(v_template.body_html, ''), 'UTF8'), 'sha256'), 'hex')",
    )
    .replaceAll(
      "encode(digest(v_agreement.document_snapshot ->> 'bodyHtml', 'sha256'), 'hex')",
      "pg_catalog.encode(extensions.digest(pg_catalog.convert_to(v_agreement.document_snapshot ->> 'bodyHtml', 'UTF8'), 'sha256'), 'hex')",
    );
}

const currentDefinitions = [
  functionDefinition(onboarding, 'ccc_prepare_affiliate_agreement'),
  functionDefinition(onboarding, 'ccc_mark_affiliate_agreement_sent'),
  functionDefinition(onboarding, 'ccc_activate_affiliate'),
  functionDefinition(signingClaim, 'ccc_claim_affiliate_agreement_signing'),
  functionDefinition(signingClaim, 'ccc_complete_affiliate_agreement'),
];

for (const definition of currentDefinitions) {
  const patched = patchDigest(definition);
  assert.notEqual(patched, definition, 'each current function must contain one broken digest expression');
  assert.match(patched, /security definer/i);
  assert.doesNotMatch(patched, /encode\(digest\(/);
  assert.match(patched, /pg_catalog\.encode\(extensions\.digest\(pg_catalog\.convert_to\(/);
  assert.equal(
    patched.match(/set search_path\s*=\s*(?:public|'')/i)?.[0],
    definition.match(/set search_path\s*=\s*(?:public|'')/i)?.[0],
    'digest repair must preserve each SECURITY DEFINER search_path',
  );
}

for (const signature of [
  'ccc_prepare_affiliate_agreement(uuid,numeric,text,text)',
  'ccc_mark_affiliate_agreement_sent(uuid,uuid,timestamptz)',
  'ccc_activate_affiliate(uuid)',
  'ccc_claim_affiliate_agreement_signing(uuid,uuid,text)',
  'ccc_complete_affiliate_agreement(uuid,uuid,timestamptz,text,inet,text,text,text,text,text,jsonb)',
]) {
  assert.match(runtimeFix, new RegExp(signature.replace(/[()]/g, '\\$&')));
}

assert.match(runtimeFix, /pg_catalog\.pg_get_functiondef/);
assert.match(runtimeFix, /Expected digest expression was not found/);
assert.match(runtimeFix, /extensions\.digest\(pg_catalog\.convert_to/);
assert.match(runtimeFix, /strpos\(v_definition, 'encode\(digest\('/,
  'the forward repair must be safe to retry after definitions are already qualified');
assert.doesNotMatch(runtimeFix, /alter function[\s\S]*set search_path/i);
assert.doesNotMatch(runtimeFix, /\b(?:insert into|update public\.|delete from)\b/i);

assert.match(runtimeFix, /ccc_prepare_affiliate_agreement[\s\S]*grant execute[\s\S]*to authenticated/);
assert.match(runtimeFix, /ccc_activate_affiliate[\s\S]*grant execute[\s\S]*to authenticated/);
for (const serviceOnly of [
  'ccc_mark_affiliate_agreement_sent',
  'ccc_claim_affiliate_agreement_signing',
  'ccc_complete_affiliate_agreement',
]) {
  const grant = new RegExp(`grant execute on function public\\.${serviceOnly}[\\s\\S]*?to service_role`);
  assert.match(runtimeFix, grant);
}

console.log('Affiliate agreement digest runtime repair preserves function behavior, search paths, and execution boundaries.');
