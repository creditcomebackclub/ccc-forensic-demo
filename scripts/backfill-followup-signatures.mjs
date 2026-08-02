#!/usr/bin/env node
// Injects a client's stored signature into unsigned, unmailed Phase 3
// follow-up letters. Dry-run by default.
//
// Examples:
//   node --env-file=.env.local scripts/backfill-followup-signatures.mjs \
//     --client-name "Thomas Andrew Kilpatrick"
//   node --env-file=.env.local scripts/backfill-followup-signatures.mjs \
//     --client-name "Thomas Andrew Kilpatrick" --apply

import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { collectBureauFollowUpProblems } from '../src/constants/metro2Fields.js';
import {
  hasInjectedSignature,
  injectSignatureImage,
} from '../src/utils/signatureInjection.js';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const clientId = argument('--client-id');
  const clientName = argument('--client-name');
  const letterId = argument('--letter-id');
  const apply = process.argv.includes('--apply');
  if (!clientId && !clientName) {
    throw new Error('Provide --client-id or an exact --client-name.');
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  let clientQuery = db
    .from('clients')
    .select('id,user_id,name,lpoa_signature_data');
  clientQuery = clientId
    ? clientQuery.eq('id', clientId)
    : clientQuery.eq('name', clientName);
  const { data: clients, error: clientError } = await clientQuery;
  if (clientError) throw clientError;
  if (!clients?.length) throw new Error('No matching client found.');
  if (clients.length !== 1) {
    throw new Error('Client name is not unique. Re-run with --client-id.');
  }
  const client = clients[0];

  const { data: profiles, error: profileError } = await db
    .from('client_profiles')
    .select('signature_data')
    .eq('client_id', client.id)
    .limit(1);
  if (profileError) throw profileError;
  const signatureUrl = profiles?.[0]?.signature_data
    || client.lpoa_signature_data?.signatureUrl;
  if (!signatureUrl) throw new Error('The client has no stored signature.');

  let letterQuery = db
    .from('letters')
    .select('id,user_id,client_id,client_name,phase,html,lob_id,mailed_date,tracking_number')
    .eq('user_id', client.user_id)
    .eq('client_id', client.id)
    .ilike('phase', 'Phase 3%Follow-up%')
    .is('lob_id', null)
    .is('mailed_date', null)
    .is('tracking_number', null);
  if (letterId) letterQuery = letterQuery.eq('id', letterId);
  const { data: letters, error: letterError } = await letterQuery;
  if (letterError) throw letterError;
  if (!letters?.length) throw new Error('No matching unmailed follow-up letters found.');

  const letterIds = letters.map((letter) => letter.id);
  const { data: submissions, error: submissionError } = await db
    .from('mail_submissions')
    .select('letter_id,status')
    .in('letter_id', letterIds);
  if (submissionError) throw submissionError;
  const submittedIds = new Set((submissions || []).map((row) => row.letter_id));

  let changed = 0;
  for (const letter of letters) {
    if (submittedIds.has(letter.id)) {
      console.log(`SKIP ${letter.id}: durable mail submission exists`);
      continue;
    }
    if (hasInjectedSignature(letter.html, signatureUrl)) {
      console.log(`SKIP ${letter.id}: signature already present`);
      continue;
    }
    const contentProblems = collectBureauFollowUpProblems(letter.html);
    if (contentProblems.length) {
      console.log(`SKIP ${letter.id}: ${contentProblems.length} production-safety issue(s)`);
      continue;
    }
    const signedHtml = injectSignatureImage(letter.html, signatureUrl, client.name);
    if (!signedHtml || signedHtml === letter.html) {
      console.log(`SKIP ${letter.id}: signature block not found`);
      continue;
    }

    if (!apply) {
      console.log(`WOULD UPDATE ${letter.id}`);
      changed += 1;
      continue;
    }
    const { data: updated, error: updateError } = await db
      .from('letters')
      .update({ html: signedHtml })
      .eq('id', letter.id)
      .eq('user_id', client.user_id)
      .eq('client_id', client.id)
      .is('lob_id', null)
      .is('mailed_date', null)
      .is('tracking_number', null)
      .select('id');
    if (updateError) throw updateError;
    if (updated?.length !== 1) {
      throw new Error(`Letter ${letter.id} changed before the signature update; nothing was overwritten.`);
    }
    console.log(`UPDATED ${letter.id}`);
    changed += 1;
  }

  console.log(`${apply ? 'Updated' : 'Would update'} ${changed} letter(s).`);
  if (!apply) console.log('Dry run only. Re-run with --apply to persist.');
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
