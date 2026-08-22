#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const provision = readFileSync(
  new URL('../netlify/functions/provision-user.cjs', import.meta.url),
  'utf8',
);
const agreementMigration = readFileSync(
  new URL('../supabase/migrations/20260820260000_service_agreement_only.sql', import.meta.url),
  'utf8',
);

assert.match(
  provision,
  /client_profiles\?client_id=eq\.\$\{encodeURIComponent\(client\.id\)\}[\s\S]*?limit=2/,
  'the legacy invite path checks every profile already linked to the exact client',
);
assert.match(
  provision,
  /client_profiles\?email=eq\.\$\{encodeURIComponent\(normEmail\)\}[\s\S]*?limit=2/,
  'the legacy invite path independently checks the normalized email identity',
);
assert.match(provision, /clientProfiles\.length > 1 \|\| emailProfiles\.length > 1/);
assert.match(provision, /profileForClient\.id !== profileForEmail\.id/);
assert.match(provision, /profileForEmail\?\.client_id && profileForEmail\.client_id !== client\.id/);
assert.match(provision, /getUserById\(existingPortalUserId\)/);
assert.match(provision, /existingPortalUserId && existingPortalUserId !== userId/);
assert.match(
  provision,
  /rest\/v1\/rpc\/ccc_link_portal_profile_for_onboarding/,
  'linking is delegated to the transaction-locked canonical database function',
);
assert.doesNotMatch(
  provision,
  /rest\/v1\/client_profiles`, \{ method: 'POST'/,
  'the invitation function must never insert a client profile directly',
);
assert.doesNotMatch(
  provision,
  /rest\/v1\/client_profiles\?id=eq\.[\s\S]{0,180}method: 'PATCH'/,
  'the invitation function must never reassign an existing profile directly',
);
assert.match(provision, /portal identity\|auth identity\|staff or affiliate identity/);
assert.match(provision, /if \(detail !== safeDefault\) throw profileConflict\(detail\)/);
assert.match(provision, /error\?\.statusCode === 409 \? 409 : 500/);

const linkerBody = agreementMigration.match(
  /create or replace function public\.ccc_link_portal_profile_for_onboarding\([\s\S]*?\nas \$\$([\s\S]*?)\n\$\$;/,
)?.[1] || '';
assert.match(linkerBody, /ccc-portal-user:/);
assert.match(linkerBody, /ccc-portal-client:/);
assert.match(linkerBody, /ccc-portal-email:/);
assert.match(linkerBody, /or cp\.client_id = p_client_id/);
assert.match(linkerBody, /Conflicting client portal profile records require staff resolution/);
assert.match(linkerBody, /already linked to another Auth identity/);
assert.match(linkerBody, /already linked to another client/);

console.log('Conflict-safe legacy portal provisioning assertions passed.');
