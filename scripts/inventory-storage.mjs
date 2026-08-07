// Read-only inventory of Supabase Storage client-document layout.
//
// Usage:
//   node --env-file=.env.local scripts/inventory-storage.mjs
//   node --env-file=.env.local scripts/inventory-storage.mjs --csv=storage-inventory.csv
//
// Required: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import fs from 'fs';

const BUCKETS = ['documents', 'responses', 'client-docs', 'recovery-blueprints', 'lpoa'];

function classify(bucket, path) {
  const parts = String(path || '').split('/').filter(Boolean);
  if (bucket === 'documents') {
    if (parts[1] === 'temp' || parts[1] === 'temp-letters' || parts[1] === 'temp-letter-assets') return 'temp';
    if (parts[1] === 'audit-jobs') return 'audit-jobs';
    if (parts[1] === 'mail-artifacts') return 'mail-artifacts';
    if (parts[2] === 'identity') return 'canonical-identity';
    if (parts[2] === 'lpoa') return 'canonical-lpoa';
    if (parts.length === 3 && parts[0] && parts[1] && parts[2]) return 'legacy-identity-flat';
    return 'documents-other';
  }
  if (bucket === 'responses') {
    if (parts[1] === 'response-evidence') return 'legacy-response-evidence';
    if (parts[2] === 'response-evidence') return 'canonical-response-evidence';
    if (parts.length >= 2) return 'legacy-response-letter-folder';
    return 'responses-other';
  }
  if (bucket === 'client-docs') {
    if (parts[0] === 'admin') return 'firm-settings';
    if (parts[0] === 'firm') return 'firm-assets';
    if (parts[0] === 'standalone' && parts[1] === 'Christopher Holland') return 'attorney-sig-legacy';
    if (parts[0] === 'standalone') return 'standalone-lpoa';
    if (parts.length >= 2 && (parts[1] === 'lpoa-signed.html' || parts[1] === 'signature.png')) return 'portal-lpoa';
    return 'client-docs-other';
  }
  if (bucket === 'recovery-blueprints') {
    if (parts.length >= 4) return 'canonical-blueprint';
    if (parts.length === 3) return 'legacy-blueprint';
    return 'blueprint-other';
  }
  if (bucket === 'lpoa') return 'legacy-lpoa-bucket';
  return 'unknown';
}

async function listAll(db, bucket, prefix = '') {
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
      if (error) {
        if (/not found|Bucket not found/i.test(error.message || '')) return out;
        throw new Error(`${bucket}/${current || ''}: ${error.message}`);
      }
      if (!data || data.length === 0) break;
      for (const item of data) {
        const full = current ? `${current}/${item.name}` : item.name;
        // Folders have id null / no metadata in list API
        if (item.id == null && !item.metadata) {
          queue.push(full);
        } else {
          out.push({
            bucket,
            path: full,
            size: item.metadata?.size ?? null,
            updatedAt: item.updated_at || item.created_at || null,
            class: classify(bucket, full),
          });
        }
      }
      if (data.length < 100) break;
      offset += 100;
    }
  }
  return out;
}

async function main() {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvArg ? csvArg.slice('--csv='.length) : null;

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  const all = [];
  for (const bucket of BUCKETS) {
    process.stderr.write(`Listing ${bucket}…\n`);
    try {
      const rows = await listAll(db, bucket);
      all.push(...rows);
      process.stderr.write(`  ${rows.length} object(s)\n`);
    } catch (e) {
      process.stderr.write(`  SKIP: ${e.message}\n`);
    }
  }

  const byClass = {};
  for (const row of all) {
    byClass[row.class] = (byClass[row.class] || 0) + 1;
  }

  console.log('\n=== Storage inventory summary ===');
  console.log(`Total objects: ${all.length}`);
  for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`);
  }

  if (csvPath) {
    const header = 'bucket,path,class,size,updatedAt\n';
    const body = all.map((r) =>
      [r.bucket, r.path, r.class, r.size ?? '', r.updatedAt ?? '']
        .map((c) => `"${String(c).replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');
    fs.writeFileSync(csvPath, header + body + (body ? '\n' : ''));
    console.log(`\nWrote ${csvPath}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
