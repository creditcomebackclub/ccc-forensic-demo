/**
 * Fieldwork evidence vault — real files in fieldwork-docs bucket.
 * Uses VITE_FIELDWORK_SUPABASE_* only (never CCC documents bucket).
 */
import { fieldworkCloudEnabled, fieldworkSupabase } from './supabase';

const BUCKET = 'fieldwork-docs';
const MAX_BYTES = 15 * 1024 * 1024; // matches bucket file_size_limit
const DEMO_MAX_BYTES = 1.5 * 1024 * 1024; // localStorage-safe demo fallback

/** One slot each — re-upload replaces the previous file. */
export const SINGLETON_KINDS = new Set(['Photo ID', 'Proof of address']);

const ALLOWED = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

function extOf(file) {
  const fromName = String(file.name || '').split('.').pop()?.toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  if (file.type === 'application/pdf') return 'pdf';
  if (file.type === 'image/png') return 'png';
  if (file.type === 'image/webp') return 'webp';
  return 'jpg';
}

function kindSlug(kind) {
  return String(kind || 'other')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'other';
}

function assertFile(file) {
  if (!file) throw new Error('No file selected');
  if (file.size > MAX_BYTES) {
    throw new Error('File is too large (max 15 MB).');
  }
  const type = file.type || '';
  if (type && !ALLOWED.has(type) && !type.startsWith('image/')) {
    throw new Error('Use PDF, JPG, or PNG.');
  }
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function requireUser() {
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const { data, error } = await fieldworkSupabase.auth.getUser();
  if (error || !data?.user) throw error || new Error('Sign in to upload documents');
  return data.user;
}

async function resolveSubscriberId(explicitId) {
  if (explicitId) return explicitId;
  const user = await requireUser();
  const { data, error } = await fieldworkSupabase
    .from('fieldwork_subscribers')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('No Fieldwork subscriber — finish signup first.');
  return data.id;
}

/**
 * Upload a document. Cloud → fieldwork-docs + fieldwork_documents.
 * Demo (no keys) → localDataUrl on the returned record (small files only).
 */
export async function uploadFieldworkDocument({
  kind,
  file,
  subscriberId,
  existingDocs = [],
  forceLocal = false,
}) {
  assertFile(file);
  const now = new Date().toISOString();

  // Guest product tour (or no Fieldwork keys) — never write to a real subscriber vault.
  if (forceLocal || !fieldworkCloudEnabled || !fieldworkSupabase) {
    if (file.size > DEMO_MAX_BYTES) {
      throw new Error(
        'Demo mode can only keep files under ~1.5 MB in the browser. Connect Fieldwork Supabase for full uploads.',
      );
    }
    const localDataUrl = await readAsDataUrl(file);
    const doc = {
      id: `doc_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: file.name,
      kind,
      uploadedAt: now,
      size: file.size,
      contentType: file.type || null,
      storagePath: null,
      localDataUrl,
      cloud: false,
    };
    if (SINGLETON_KINDS.has(kind)) {
      return {
        doc,
        removeIds: existingDocs.filter((d) => d.kind === kind).map((d) => d.id),
      };
    }
    return { doc, removeIds: [] };
  }

  const user = await requireUser();
  const subId = await resolveSubscriberId(subscriberId);
  const ext = extOf(file);
  const id = crypto.randomUUID();
  const storagePath = `${user.id}/${kindSlug(kind)}/${id}.${ext}`;

  // Replace singleton kinds (Photo ID / Proof of address)
  if (SINGLETON_KINDS.has(kind)) {
    const prior = existingDocs.filter((d) => d.kind === kind && d.storagePath);
    for (const old of prior) {
      try {
        await deleteFieldworkDocument({ id: old.id, storagePath: old.storagePath });
      } catch {
        /* continue — still upload the new file */
      }
    }
  }

  const { error: upErr } = await fieldworkSupabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      upsert: true,
      contentType: file.type || undefined,
      cacheControl: '3600',
    });
  if (upErr) throw upErr;

  const baseRow = {
    id,
    subscriber_id: subId,
    name: file.name,
    kind,
    storage_path: storagePath,
  };
  let { data: row, error: dbErr } = await fieldworkSupabase
    .from('fieldwork_documents')
    .insert({
      ...baseRow,
      byte_size: file.size,
      content_type: file.type || null,
    })
    .select('*')
    .single();

  // Older Fieldwork DBs before 20260802060000 — retry without meta columns.
  if (dbErr && /byte_size|content_type/i.test(dbErr.message || '')) {
    ({ data: row, error: dbErr } = await fieldworkSupabase
      .from('fieldwork_documents')
      .insert(baseRow)
      .select('*')
      .single());
  }

  if (dbErr) {
    await fieldworkSupabase.storage.from(BUCKET).remove([storagePath]);
    throw dbErr;
  }

  return {
    doc: mapDocRow(row),
    removeIds: SINGLETON_KINDS.has(kind)
      ? existingDocs.filter((d) => d.kind === kind && d.id !== row.id).map((d) => d.id)
      : [],
  };
}

export async function deleteFieldworkDocument({ id, storagePath }) {
  if (!id) return;

  if (!fieldworkCloudEnabled || !fieldworkSupabase || !storagePath) {
    return { id, cloud: false };
  }

  if (storagePath) {
    const { error: rmErr } = await fieldworkSupabase.storage
      .from(BUCKET)
      .remove([storagePath]);
    if (rmErr) console.warn('[fieldwork] storage remove', rmErr.message);
  }

  const { error } = await fieldworkSupabase
    .from('fieldwork_documents')
    .delete()
    .eq('id', id);
  if (error) throw error;
  return { id, cloud: true };
}

export async function getFieldworkDocumentUrl(storagePath, expiresSec = 3600) {
  if (!storagePath) throw new Error('No storage path');
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const { data, error } = await fieldworkSupabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresSec);
  if (error) throw error;
  return data.signedUrl;
}

/** Download bytes as base64 (for future Lob enclosure packs). */
export async function getFieldworkDocumentBase64(storagePath) {
  if (!storagePath) throw new Error('No storage path');
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const { data, error } = await fieldworkSupabase.storage
    .from(BUCKET)
    .download(storagePath);
  if (error) throw error;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(data);
  });
}

export function mapDocRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind || 'Other',
    uploadedAt: r.created_at || r.uploadedAt,
    size: typeof r.byte_size === 'number' ? r.byte_size : r.size || null,
    contentType: r.content_type || r.contentType || null,
    storagePath: r.storage_path || r.storagePath || null,
    localDataUrl: r.localDataUrl || null,
    cloud: Boolean(r.storage_path || r.storagePath),
  };
}

export { fieldworkCloudEnabled };
