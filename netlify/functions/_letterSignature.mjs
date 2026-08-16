/**
 * Canonical client drawn-signature loader for letter generation.
 * The drawn PNG is stored at enrollment (portal-enroll-upload kind: 'signature')
 * and referenced from clients / client_profiles.lpoa_signature_data.
 */

export class MissingClientSignatureError extends Error {
  constructor(message, code = 'MISSING_CLIENT_SIGNATURE') {
    super(message);
    this.name = 'MissingClientSignatureError';
    this.code = code;
  }
}

/**
 * @param {import('@supabase/supabase-js').SupabaseClient} supabaseAdmin - service-role client
 * @param {{ clientId?: string, clientName?: string }} ref
 * @returns {Promise<{ signatureData: object, clientId: string|null, source: string } | null>}
 */
export async function loadCanonicalClientSignature(supabaseAdmin, { clientId, clientName } = {}) {
  if (!supabaseAdmin) return null;

  if (clientId) {
    const { data: byId } = await supabaseAdmin
      .from('clients')
      .select('id, name, lpoa_signature_data')
      .eq('id', clientId)
      .limit(1)
      .maybeSingle();
    if (byId?.lpoa_signature_data) {
      return { signatureData: byId.lpoa_signature_data, clientId: byId.id, source: 'clients' };
    }
  }

  if (clientName) {
    const { data: byName } = await supabaseAdmin
      .from('clients')
      .select('id, name, lpoa_signature_data')
      .eq('name', clientName)
      .limit(1)
      .maybeSingle();
    if (byName?.lpoa_signature_data) {
      return { signatureData: byName.lpoa_signature_data, clientId: byName.id, source: 'clients' };
    }
  }

  // Profile fallback (enrollment also writes client_profiles.lpoa_signature_data)
  if (clientId) {
    const { data: profile } = await supabaseAdmin
      .from('client_profiles')
      .select('client_id, full_name, lpoa_signature_data')
      .eq('client_id', clientId)
      .limit(1)
      .maybeSingle();
    if (profile?.lpoa_signature_data) {
      return {
        signatureData: profile.lpoa_signature_data,
        clientId: profile.client_id || clientId,
        source: 'client_profiles',
      };
    }
  }

  return null;
}

/**
 * Hard-fail variant for mail / PDF generation. Never silently continues.
 */
export async function requireCanonicalClientSignature(supabaseAdmin, ref = {}) {
  const loaded = await loadCanonicalClientSignature(supabaseAdmin, ref);
  if (loaded?.signatureData) return loaded;

  const who = ref.clientName || ref.clientId || 'this client';
  throw new MissingClientSignatureError(
    `No drawn signature on file for ${who}. Complete portal enrollment (draw signature) before generating or mailing letters.`,
    'MISSING_CLIENT_SIGNATURE'
  );
}

export async function resolveClientSignatureAsset(supabaseAdmin, signatureData) {
  if (!signatureData) {
    throw new MissingClientSignatureError(
      'Signature metadata is missing. Re-upload the client drawn signature before mailing.',
      'MISSING_SIGNATURE_METADATA'
    );
  }

  const bucket = signatureData.bucket || signatureData.storage_bucket || signatureData.signature_bucket;
  const path = signatureData.path || signatureData.storage_path || signatureData.signature_path;

  if (signatureData.dataUrl || signatureData.data_url) {
    return { type: 'dataUrl', value: signatureData.dataUrl || signatureData.data_url, bucket, path };
  }

  if (!bucket || !path) {
    throw new MissingClientSignatureError(
      'Drawn signature file path is incomplete on the client record. Have the client re-draw and complete enrollment.',
      'INCOMPLETE_SIGNATURE_PATH'
    );
  }

  if (!supabaseAdmin?.storage) {
    throw new MissingClientSignatureError(
      'Storage client unavailable while loading the drawn signature.',
      'SIGNATURE_STORAGE_UNAVAILABLE'
    );
  }

  const { data, error } = await supabaseAdmin.storage.from(bucket).download(path);
  if (error || !data) {
    throw new MissingClientSignatureError(
      `Could not load drawn signature from storage (${bucket}/${path}). ${error?.message || 'File missing.'}`,
      'SIGNATURE_FILE_MISSING'
    );
  }

  return { type: 'blob', value: data, bucket, path };
}
