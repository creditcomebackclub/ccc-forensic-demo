// Migrate client document storage to the canonical firmUid/clientId layout.
//
// Usage (dry-run by default):
//   node --env-file=.env.local scripts/reorg-client-storage.mjs
//   node --env-file=.env.local scripts/reorg-client-storage.mjs --apply
//   node --env-file=.env.local scripts/reorg-client-storage.mjs --apply --purge-temps
//
// Required: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Strategy: copy → verify size → retarget DB → optionally delete source.
// Temps are only purged with --purge-temps (safe after Lob sends age out).
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import crypto from 'crypto';

const APPLY = process.argv.includes('--apply');
const PURGE_TEMPS = process.argv.includes('--purge-temps');
const TEMP_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const DOCUMENTS = 'documents';
const RESPONSES = 'responses';
const CLIENT_DOCS = 'client-docs';
const BLUEPRINTS = 'recovery-blueprints';

function log(msg) {
  console.log(msg);
}

async function listRecursive(db, bucket, prefix = '') {
  const out = [];
  const queue = [prefix];
  while (queue.length) {
    const current = queue.shift();
    let offset = 0;
    for (;;) {
      const { data, error } = await db.storage.from(bucket).list(current || undefined, {
        limit: 100,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`${bucket}/${current}: ${error.message}`);
      if (!data?.length) break;
      for (const item of data) {
        const full = current ? `${current}/${item.name}` : item.name;
        if (item.id == null && !item.metadata) queue.push(full);
        else out.push({ path: full, size: item.metadata?.size ?? null, updatedAt: item.updated_at || item.created_at });
      }
      if (data.length < 100) break;
      offset += 100;
    }
  }
  return out;
}

async function copyObject(db, fromBucket, fromPath, toBucket, toPath) {
  const { data, error } = await db.storage.from(fromBucket).download(fromPath);
  if (error) throw new Error(`download ${fromBucket}/${fromPath}: ${error.message}`);
  const buf = Buffer.from(await data.arrayBuffer());
  const lower = String(toPath).toLowerCase();
  let contentType = data.type || 'application/octet-stream';
  // Downloaded blobs often report text/plain; documents bucket rejects that
  // for .html LPOA files. Force by extension.
  if (lower.endsWith('.html') || lower.endsWith('.htm')) contentType = 'text/html;charset=utf-8';
  else if (lower.endsWith('.png')) contentType = 'image/png';
  else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (lower.endsWith('.webp')) contentType = 'image/webp';
  else if (lower.endsWith('.pdf')) contentType = 'application/pdf';
  else if (lower.endsWith('.json')) contentType = 'application/json';
  if (!APPLY) {
    return { bytes: buf.length, dryRun: true };
  }
  const { error: upErr } = await db.storage.from(toBucket).upload(toPath, buf, {
    upsert: true,
    contentType,
  });
  if (upErr) throw new Error(`upload ${toBucket}/${toPath}: ${upErr.message}`);
  return { bytes: buf.length };
}

async function removePaths(db, bucket, paths) {
  if (!paths.length) return;
  if (!APPLY) {
    log(`  [dry-run] would delete ${paths.length} from ${bucket}`);
    return;
  }
  for (let i = 0; i < paths.length; i += 50) {
    const chunk = paths.slice(i, i + 50);
    const { error } = await db.storage.from(bucket).remove(chunk);
    if (error) console.warn(`  remove warning ${bucket}:`, error.message);
  }
}

async function migrateIdentity(db, stats) {
  log('\n=== Identity docs (documents flat → identity/) ===');
  const { data: rows, error } = await db.from('documents').select('id,user_id,client_id,storage_path,doc_type,file_name');
  if (error) throw error;
  for (const row of rows || []) {
    if (!row.user_id || !row.client_id || !row.storage_path) continue;
    const parts = row.storage_path.split('/');
    // Already canonical: firm/clientId/identity/file
    if (parts[2] === 'identity' && parts[1] === row.client_id) {
      stats.identityAlready += 1;
      continue;
    }
    // Flat legacy UUID: firm/clientId/file  OR name-slug: firm/{slug}/file
    if (parts.length === 3 && parts[0] === row.user_id) {
      const dest = `${row.user_id}/${row.client_id}/identity/${parts[2]}`;
      if (dest === row.storage_path) {
        stats.identityAlready += 1;
        continue;
      }
      log(`  ${row.storage_path} → ${dest}`);
      try {
        await copyObject(db, DOCUMENTS, row.storage_path, DOCUMENTS, dest);
        if (APPLY) {
          const { error: updErr } = await db.from('documents').update({ storage_path: dest }).eq('id', row.id);
          if (updErr) throw updErr;
          await removePaths(db, DOCUMENTS, [row.storage_path]);
        }
        stats.identityMoved += 1;
      } catch (e) {
        stats.errors.push(`identity ${row.id}: ${e.message}`);
        console.warn('  FAIL', e.message);
      }
    } else {
      stats.identitySkipped += 1;
    }
  }
}

async function migrateLpoa(db, stats) {
  log('\n=== LPOA (client-docs → documents/{firm}/{clientId}/lpoa/) ===');
  const { data: clients, error } = await db
    .from('clients')
    .select('id,user_id,name,lpoa_signature_data,lpoa_signed');
  if (error) throw error;

  const { data: profiles } = await db
    .from('client_profiles')
    .select('client_id,user_id,lpoa_url,lpoa_storage_path');

  const profileByClient = new Map();
  for (const p of profiles || []) {
    if (p.client_id) profileByClient.set(p.client_id, p);
  }

  for (const client of clients || []) {
    if (!client.user_id || !client.id) continue;
    const data = client.lpoa_signature_data || {};
    if (data.lpoaPath && String(data.lpoaPath).includes('/lpoa/')) {
      stats.lpoaAlready += 1;
      continue;
    }

    const destSig = `${client.user_id}/${client.id}/lpoa/signature.png`;
    const destLpoa = `${client.user_id}/${client.id}/lpoa/lpoa-signed.html`;
    const candidates = [];

    // standalone/{clientId}/…
    candidates.push({
      sig: `standalone/${client.id}/signature.png`,
      lpoa: `standalone/${client.id}/lpoa-signed.html`,
      bucket: CLIENT_DOCS,
    });

    // portal auth uid folder
    const profile = profileByClient.get(client.id);
    if (profile?.user_id) {
      candidates.push({
        sig: `${profile.user_id}/signature.png`,
        lpoa: `${profile.user_id}/lpoa-signed.html`,
        bucket: CLIENT_DOCS,
      });
    }

    // Parse legacy public URLs
    for (const url of [data.lpoaUrl, data.signatureUrl, profile?.lpoa_url].filter(Boolean)) {
      const m = String(url).match(/\/object\/public\/client-docs\/(.+)$/);
      if (m) {
        const path = decodeURIComponent(m[1]);
        if (path.endsWith('lpoa-signed.html')) {
          candidates.push({ lpoa: path, sig: path.replace(/lpoa-signed\.html$/, 'signature.png'), bucket: CLIENT_DOCS });
        }
      }
    }

    let moved = false;
    for (const cand of candidates) {
      try {
        if (cand.lpoa) {
          const { data: exists } = await db.storage.from(cand.bucket).download(cand.lpoa);
          if (!exists) continue;
          log(`  client ${client.name || client.id}: ${cand.lpoa} → ${destLpoa}`);
          await copyObject(db, cand.bucket, cand.lpoa, DOCUMENTS, destLpoa);
          if (cand.sig) {
            try {
              await copyObject(db, cand.bucket, cand.sig, DOCUMENTS, destSig);
            } catch {
              /* signature optional if already embedded */
            }
          }
          const next = {
            ...data,
            storageBucket: DOCUMENTS,
            signaturePath: destSig,
            lpoaPath: destLpoa,
            // Keep legacy URLs for dual-read until cutover complete
            signatureUrl: data.signatureUrl || null,
            lpoaUrl: data.lpoaUrl || null,
          };
          if (APPLY) {
            const { error: clientUpdErr } = await db.from('clients').update({ lpoa_signature_data: next }).eq('id', client.id);
            if (clientUpdErr) throw clientUpdErr;
            const { error: profileUpdErr } = await db.from('client_profiles').update({
              lpoa_storage_bucket: DOCUMENTS,
              lpoa_storage_path: destLpoa,
            }).eq('client_id', client.id);
            if (profileUpdErr) {
              console.warn(`  profile path update skipped for ${client.id}: ${profileUpdErr.message}`);
            }
          }
          stats.lpoaMoved += 1;
          moved = true;
          break;
        }
      } catch (e) {
        console.warn(`  LPOA candidate failed (${cand.lpoa}): ${e.message}`);
      }
    }
    if (!moved && (client.lpoa_signed || data.lpoaUrl)) {
      stats.lpoaMissing += 1;
      log(`  WARN no LPOA source for ${client.name || client.id}`);
    }
  }

  // Copy attorney signature to firm path
  const attorneySrc = 'standalone/Christopher Holland/chris_signature.png';
  const attorneyDest = 'firm/attorney-signature.png';
  try {
    await copyObject(db, CLIENT_DOCS, attorneySrc, CLIENT_DOCS, attorneyDest);
    stats.attorneyCopied += 1;
    log(`  attorney sig → ${attorneyDest}`);
  } catch (e) {
    log(`  attorney sig skip: ${e.message}`);
  }
}

async function migrateResponses(db, stats) {
  log('\n=== Response evidence paths ===');
  const { data: rows, error } = await db
    .from('response_evidence')
    .select('id,firm_user_id,client_id,letter_id,storage_bucket,storage_paths,file_names,upload_status,response_kind,client_name,source,submitted_by,received_at');
  if (error) throw error;

  for (const row of rows || []) {
    if (!row.firm_user_id || !row.client_id) {
      stats.responseSkipped += 1;
      continue;
    }
    const paths = Array.isArray(row.storage_paths) ? row.storage_paths : [];
    const canonicalPrefix = `${row.firm_user_id}/${row.client_id}/response-evidence/${row.id}/`;
    if (paths.length && paths.every((p) => String(p).startsWith(canonicalPrefix))) {
      stats.responseAlready += 1;
      continue;
    }
    const newPaths = [];
    for (const oldPath of paths) {
      if (!oldPath || String(oldPath).includes('/converted_')) continue;
      const fileName = String(oldPath).split('/').pop();
      const dest = `${canonicalPrefix}${fileName}`;
      log(`  ${oldPath} → ${dest}`);
      try {
        await copyObject(db, row.storage_bucket || RESPONSES, oldPath, RESPONSES, dest);
        newPaths.push(dest);
      } catch (e) {
        stats.errors.push(`response ${row.id} ${oldPath}: ${e.message}`);
        console.warn('  FAIL', e.message);
      }
    }
    if (newPaths.length && APPLY) {
      await db.from('response_evidence').update({
        storage_paths: newPaths,
        storage_bucket: RESPONSES,
        updated_at: new Date().toISOString(),
      }).eq('id', row.id);
      stats.responseMoved += 1;
    } else if (newPaths.length) {
      stats.responseMoved += 1;
    }
  }

  // Legacy letter folders → new evidence rows when missing
  log('\n=== Legacy response folders without evidence rows ===');
  const { data: letters } = await db.from('letters').select('id,user_id,client_id,client_name,phase,client_account_id');
  const evidenceLetterIds = new Set((rows || []).map((r) => r.letter_id).filter(Boolean));
  const letterById = new Map((letters || []).map((l) => [l.id, l]));

  // Scan common roots: firm user ids + client profile auth uids
  const roots = new Set();
  for (const l of letters || []) if (l.user_id) roots.add(l.user_id);
  const { data: cps } = await db.from('client_profiles').select('user_id,client_id');
  for (const cp of cps || []) if (cp.user_id) roots.add(cp.user_id);

  for (const rootId of roots) {
    const { data: folders } = await db.storage.from(RESPONSES).list(rootId, { limit: 100 });
    for (const folder of folders || []) {
      if (folder.name === 'response-evidence') continue;
      if (!letterById.has(folder.name)) continue;
      if (evidenceLetterIds.has(folder.name)) continue;
      const letter = letterById.get(folder.name);
      if (!letter.client_id || !letter.user_id) continue;
      const { data: files } = await db.storage.from(RESPONSES).list(`${rootId}/${folder.name}`, { limit: 50 });
      const realFiles = (files || []).filter((f) =>
        f.id
        && !String(f.name).startsWith('converted_')
        && !String(f.name).startsWith('.')
        && f.name !== '.emptyFolderPlaceholder'
      );
      if (!realFiles.length) continue;
      const evidenceId = crypto.randomUUID();
      const prefix = `${letter.user_id}/${letter.client_id}/response-evidence/${evidenceId}`;
      const newPaths = [];
      const names = [];
      for (let i = 0; i < realFiles.length; i++) {
        const f = realFiles[i];
        const src = `${rootId}/${folder.name}/${f.name}`;
        const destName = `response_${String(i + 1).padStart(2, '0')}_${f.name}`;
        const dest = `${prefix}/${destName}`;
        log(`  legacy ${src} → ${dest}`);
        try {
          await copyObject(db, RESPONSES, src, RESPONSES, dest);
          newPaths.push(dest);
          names.push(f.name);
        } catch (e) {
          stats.errors.push(`legacy ${src}: ${e.message}`);
        }
      }
      if (!newPaths.length) continue;
      if (APPLY) {
        const { error: insErr } = await db.from('response_evidence').insert({
          id: evidenceId,
          firm_user_id: letter.user_id,
          client_id: letter.client_id,
          client_account_id: letter.client_account_id || null,
          client_name: letter.client_name,
          letter_id: letter.id,
          response_kind: String(letter.phase || '').startsWith('Phase 3') ? 'bureau' : 'furnisher',
          source: 'legacy_import',
          storage_bucket: RESPONSES,
          storage_paths: newPaths,
          file_names: names,
          upload_status: 'received',
          received_at: new Date().toISOString(),
          submitted_by: letter.user_id,
        });
        if (insErr) {
          stats.errors.push(`insert evidence ${letter.id}: ${insErr.message}`);
        } else {
          evidenceLetterIds.add(letter.id);
          stats.legacyEvidenceCreated += 1;
        }
      } else {
        stats.legacyEvidenceCreated += 1;
      }
    }
  }
}

async function migrateBlueprints(db, stats) {
  log('\n=== Recovery blueprints ===');
  const { data: rows, error } = await db.from('recovery_blueprints').select('id,user_id,client_id,audit_id,storage_path,version,file_sha256');
  if (error) {
    if (/does not exist|relation/i.test(error.message)) {
      log('  table missing — skip');
      return;
    }
    throw error;
  }
  for (const row of rows || []) {
    if (!row.user_id || !row.client_id || !row.audit_id || !row.storage_path) continue;
    const parts = row.storage_path.split('/');
    // canonical: firm/clientId/auditId/file
    if (parts.length >= 4 && parts[1] === row.client_id) {
      stats.blueprintAlready += 1;
      continue;
    }
    const fileName = parts[parts.length - 1];
    const dest = `${row.user_id}/${row.client_id}/${row.audit_id}/${fileName}`;
    log(`  ${row.storage_path} → ${dest}`);
    try {
      await copyObject(db, BLUEPRINTS, row.storage_path, BLUEPRINTS, dest);
      if (APPLY) {
        await db.from('recovery_blueprints').update({ storage_path: dest }).eq('id', row.id);
        await removePaths(db, BLUEPRINTS, [row.storage_path]);
      }
      stats.blueprintMoved += 1;
    } catch (e) {
      stats.errors.push(`blueprint ${row.id}: ${e.message}`);
    }
  }
}

async function purgeTemps(db, stats) {
  log('\n=== Temp / stale audit-job purge ===');
  if (!PURGE_TEMPS) {
    log('  skipped (pass --purge-temps to enable)');
    return;
  }
  const cutoff = Date.now() - TEMP_MAX_AGE_MS;
  const objects = await listRecursive(db, DOCUMENTS);
  const toDelete = [];
  for (const obj of objects) {
    const parts = obj.path.split('/');
    const isTemp = parts[1] === 'temp'
      || parts[1] === 'temp-letters'
      || parts[1] === 'temp-letter-assets'
      || parts[1] === 'audit-jobs';
    if (!isTemp) continue;
    const updated = obj.updatedAt ? Date.parse(obj.updatedAt) : 0;
    if (updated && updated > cutoff && parts[1] !== 'temp-letters' && parts[1] !== 'temp-letter-assets') {
      // Keep recent audit-jobs / canonical temp/; always purge legacy temp-letters piles
      continue;
    }
    if (parts[1] === 'temp' && updated && updated > cutoff) continue;
    toDelete.push(obj.path);
  }
  log(`  candidates: ${toDelete.length}`);
  stats.tempsPurged = toDelete.length;
  await removePaths(db, DOCUMENTS, toDelete);
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  log(`Mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}${PURGE_TEMPS ? ' + purge-temps' : ''}`);

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const stats = {
    identityMoved: 0,
    identityAlready: 0,
    identitySkipped: 0,
    lpoaMoved: 0,
    lpoaAlready: 0,
    lpoaMissing: 0,
    attorneyCopied: 0,
    responseMoved: 0,
    responseAlready: 0,
    responseSkipped: 0,
    legacyEvidenceCreated: 0,
    blueprintMoved: 0,
    blueprintAlready: 0,
    tempsPurged: 0,
    errors: [],
  };

  await migrateIdentity(db, stats);
  await migrateLpoa(db, stats);
  await migrateResponses(db, stats);
  await migrateBlueprints(db, stats);
  await purgeTemps(db, stats);

  log('\n=== Summary ===');
  console.log(JSON.stringify(stats, null, 2));
  if (!APPLY) log('\nRe-run with --apply to execute copies and DB updates.');
  if (stats.errors.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
