#!/usr/bin/env node
// Archives exact Lob PDFs for already-mailed letters whose stored HTML preview
// references a retired signature image. Letter evidence rows are never edited.
// Dry-run by default; pass --apply to download and archive eligible PDFs.

import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import { hasMailedDeliveryEvidence, letterSignatureState } from '../src/utils/letterGeneration.js';

const require = createRequire(import.meta.url);
const { archiveLobArtifact } = require('../netlify/functions/_lobArtifacts.cjs');

async function main() {
  const apply = process.argv.includes('--apply');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const lobMode = process.env.LOB_MODE || 'test';
  const apiKey = process.env.LOB_API_KEY
    || (lobMode === 'live' ? process.env.LOB_LIVE_KEY : process.env.LOB_TEST_KEY);
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }
  if (apply && !apiKey) throw new Error(`Missing Lob ${lobMode} API key for --apply.`);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });
  const [{ data: letters, error: letterError }, { data: artifacts, error: artifactError }] = await Promise.all([
    db.from('letters').select('id,html,lob_id,mailed_date,tracking_number,tracking_status'),
    db.from('mail_artifacts').select('letter_id,lob_id,artifact_type,status'),
  ]);
  if (letterError) throw letterError;
  if (artifactError) throw artifactError;

  const archived = new Set((artifacts || [])
    .filter((row) => row.artifact_type === 'mailpiece_pdf' && row.status === 'archived')
    .flatMap((row) => [row.letter_id, row.lob_id].filter(Boolean)));
  const eligible = (letters || []).filter((letter) => {
    const mapped = {
      ...letter,
      lobId: letter.lob_id,
      mailedDate: letter.mailed_date,
      trackingNumber: letter.tracking_number,
      trackingStatus: letter.tracking_status,
    };
    return letter.lob_id
      && hasMailedDeliveryEvidence(mapped)
      && letterSignatureState(letter.html) === 'remote'
      && !archived.has(letter.id)
      && !archived.has(letter.lob_id);
  });

  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, eligible: eligible.length }, null, 2));
    return;
  }

  const results = { eligible: eligible.length, archived: 0, reused: 0, unavailable: 0, failed: 0 };
  for (const letter of eligible) {
    try {
      const result = await archiveLobArtifact({
        lobId: letter.lob_id,
        letterId: letter.id,
        artifactType: 'mailpiece_pdf',
        apiKey,
        supabaseUrl,
        serviceKey,
      });
      if (result?.archived) {
        results.archived += 1;
        if (result.reused) results.reused += 1;
      } else {
        results.unavailable += 1;
      }
    } catch (error) {
      results.failed += 1;
      console.error(`Archive failed for letter ${letter.id}: ${error.message || error}`);
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
