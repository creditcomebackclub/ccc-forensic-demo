#!/usr/bin/env node
// Finds LPOAs whose signature images are still remote links and embeds them.
//
// Pre-reorg enrollments baked absolute `client-docs` public URLs into
// lpoa-signed.html for both the client's drawn signature and the firm's
// attorney-in-fact signature. The 2026-08-06 storage reorg made that bucket
// private, so those links 404 — and Lob fails an entire mailpiece when an
// enclosed LPOA cannot fetch them.
//
// The service role can still read the legacy objects at their old paths, so
// the repair uses the exact images that were executed on each document.
//
// Dry-run by default; pass --apply to write. Scope with --client=<uuid>.
//
// NOTE: --apply rewrites stored bytes, so `lpoa_document_hash` no longer
// matches the repaired file. The original bytes are archived next to it as
// `lpoa-signed.original.html` and provenance is recorded on
// `lpoa_signature_data.imageRepair`.

import { createClient } from '@supabase/supabase-js';
import {
  classifyRemoteSignatureUrl,
  embedRemoteSignatureImages,
  remoteImageSources,
} from '../src/utils/signatureInjection.js';
import { DOCUMENTS_BUCKET, FIRM_ASSETS_BUCKET, FIRM_ATTORNEY_SIG_PATH } from '../src/utils/storagePaths.js';

const LEGACY_ATTORNEY_PATH = 'standalone/Christopher Holland/chris_signature.png';

function parseArgs(argv) {
  const clientArg = argv.find((value) => value.startsWith('--client='));
  return {
    apply: argv.includes('--apply'),
    clientId: clientArg ? clientArg.slice('--client='.length) : null,
  };
}

async function downloadDataUrl(db, bucket, path) {
  if (!bucket || !path) return null;
  const { data, error } = await db.storage.from(bucket).download(path);
  if (error || !data) return null;
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length === 0) return null;
  const type = data.type && data.type.startsWith('image/') ? data.type : 'image/png';
  return `data:${type};base64,${bytes.toString('base64')}`;
}

/** Recover the storage location a dead public URL used to point at. */
function legacyObjectFromUrl(url) {
  const match = String(url).match(/\/storage\/v1\/object\/(?:public|sign)\/([^/]+)\/(.+?)(?:\?|$)/);
  if (!match) return null;
  return { bucket: decodeURIComponent(match[1]), path: decodeURIComponent(match[2]) };
}

async function loadLpoaHtml(db, lpoaData) {
  const bucket = lpoaData?.storageBucket || DOCUMENTS_BUCKET;
  if (lpoaData?.lpoaPath) {
    const { data } = await db.storage.from(bucket).download(lpoaData.lpoaPath);
    if (data) return { html: await data.text(), bucket, path: lpoaData.lpoaPath };
  }
  const legacy = lpoaData?.lpoaUrl ? legacyObjectFromUrl(lpoaData.lpoaUrl) : null;
  if (legacy) {
    const { data } = await db.storage.from(legacy.bucket).download(legacy.path);
    if (data) return { html: await data.text(), bucket: legacy.bucket, path: legacy.path };
  }
  return null;
}

async function main() {
  const { apply, clientId } = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  }

  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  let query = db.from('clients').select('id,user_id,name,lpoa_signature_data').not('lpoa_signature_data', 'is', null);
  if (clientId) query = query.eq('id', clientId);
  const { data: clients, error } = await query;
  if (error) throw error;

  // One firm signature serves every client; resolve it once.
  const attorneySignatureDataUrl =
    (await downloadDataUrl(db, FIRM_ASSETS_BUCKET, FIRM_ATTORNEY_SIG_PATH))
    || (await downloadDataUrl(db, FIRM_ASSETS_BUCKET, LEGACY_ATTORNEY_PATH));
  if (!attorneySignatureDataUrl) {
    console.warn('WARN: no attorney signature found at firm/attorney-signature.png or the legacy path.');
  }

  const stats = { scanned: 0, clean: 0, repaired: 0, unreadable: 0, unresolved: 0 };

  for (const client of clients || []) {
    const label = client.name || client.id;
    const lpoaData = client.lpoa_signature_data || {};
    stats.scanned += 1;

    const loaded = await loadLpoaHtml(db, lpoaData);
    if (!loaded) {
      stats.unreadable += 1;
      console.log(`UNREADABLE  ${label} — no LPOA document could be downloaded`);
      continue;
    }

    const remotes = remoteImageSources(loaded.html);
    if (remotes.length === 0) {
      stats.clean += 1;
      continue;
    }

    // Prefer the reorg's copy of this client's own signature, then the exact
    // legacy object the dead link named.
    let clientSignatureDataUrl = await downloadDataUrl(
      db,
      lpoaData.storageBucket || DOCUMENTS_BUCKET,
      lpoaData.signaturePath
    );
    if (!clientSignatureDataUrl) {
      for (const url of remotes) {
        if (classifyRemoteSignatureUrl(url) !== 'client') continue;
        const legacy = legacyObjectFromUrl(url);
        clientSignatureDataUrl = legacy && (await downloadDataUrl(db, legacy.bucket, legacy.path));
        if (clientSignatureDataUrl) break;
      }
    }

    let repaired;
    try {
      repaired = embedRemoteSignatureImages(loaded.html, {
        clientSignatureDataUrl,
        attorneySignatureDataUrl,
        context: `LPOA for ${label}`,
      });
    } catch (repairError) {
      stats.unresolved += 1;
      console.log(`UNRESOLVED  ${label} — ${repairError.message}`);
      console.log(`            links: ${remotes.join(', ')}`);
      continue;
    }

    stats.repaired += 1;
    console.log(`${apply ? 'REPAIRED  ' : 'WOULD FIX '}  ${label} — ${remotes.length} remote image(s) embedded`);
    if (!apply) continue;

    const originalPath = loaded.path.replace(/\.html?$/i, '.original.html');
    const { error: archiveError } = await db.storage.from(loaded.bucket).upload(
      originalPath,
      Buffer.from(loaded.html, 'utf8'),
      { upsert: false, contentType: 'text/html;charset=utf-8' }
    );
    // A pre-existing archive means an earlier run already preserved the
    // originals; that is not a reason to abandon the repair.
    if (archiveError && !/exists/i.test(archiveError.message)) {
      throw new Error(`Could not archive original LPOA for ${label}: ${archiveError.message}`);
    }

    const { error: writeError } = await db.storage.from(loaded.bucket).upload(
      loaded.path,
      Buffer.from(repaired, 'utf8'),
      { upsert: true, contentType: 'text/html;charset=utf-8' }
    );
    if (writeError) throw new Error(`Could not write repaired LPOA for ${label}: ${writeError.message}`);

    const { error: metaError } = await db.from('clients').update({
      lpoa_signature_data: {
        ...lpoaData,
        imageRepair: {
          repairedAt: new Date().toISOString(),
          originalPath,
          originalDocumentHash: lpoaData.documentHash || null,
          embeddedImages: remotes,
        },
      },
    }).eq('id', client.id);
    if (metaError) throw new Error(`Could not record LPOA repair for ${label}: ${metaError.message}`);
  }

  console.log('\n' + JSON.stringify(stats, null, 2));
  if (!apply && stats.repaired > 0) console.log('\nDry run. Re-run with --apply to write.');
  if (apply && stats.repaired > 0) {
    console.log('\nlpoa_document_hash still describes the pre-repair bytes; originals kept as *.original.html.');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
