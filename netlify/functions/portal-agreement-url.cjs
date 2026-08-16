/**
 * Client-authenticated signed URL for their signed LPOA / service agreement.
 * Does not rely on browser storage RLS or client documents SELECT.
 *
 * Three onboarding paths write the signed document to three different
 * places (see ClientBillingPanel.jsx comment near startOnboarding and
 * portal-enroll-upload.cjs's "legacy portal enrollment" branch), so this
 * checks all three before giving up:
 *   1. client_profiles.lpoa_storage_path — set by sign-lpoa.cjs (staff-sent
 *      signing link).
 *   2. The deterministic lpoaDocumentPath() location — written by the
 *      in-portal wizard (ClientOnboardingModal), which never backfills
 *      client_profiles.
 *   3. client_service_agreements.signed_document_path — the separate
 *      counsel-approved-template flow (agreement-onboarding.cjs).
 */
const { createClient } = require('@supabase/supabase-js');
const { DOCUMENTS_BUCKET, lpoaDocumentPath } = require('./_storagePaths.cjs');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json(401, { error: 'Not signed in.' });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return json(500, { error: 'Server is not configured.' });

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json(401, { error: 'Invalid session.' });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profile } = await admin
    .from('client_profiles')
    .select('client_id, full_name, user_id, lpoa_storage_bucket, lpoa_storage_path')
    .eq('user_id', userData.user.id)
    .limit(1)
    .maybeSingle();

  if (!profile) return json(404, { error: 'Client profile not found.' });

  const trySign = async (bucket, path) => {
    if (!bucket || !path) return null;
    const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 60 * 15);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  };

  // 1. Cached path from the staff-sent signing link (sign-lpoa.cjs).
  let signedUrl = await trySign(profile.lpoa_storage_bucket || DOCUMENTS_BUCKET, profile.lpoa_storage_path);

  // 2. In-portal wizard writes to the deterministic path but never backfills
  //    client_profiles — reconstruct it and check whether it's actually there.
  if (!signedUrl && profile.client_id) {
    const { data: clientRow } = await admin
      .from('clients')
      .select('user_id, lpoa_signed')
      .eq('id', profile.client_id)
      .limit(1)
      .maybeSingle();
    if (clientRow?.lpoa_signed && clientRow.user_id) {
      signedUrl = await trySign(DOCUMENTS_BUCKET, lpoaDocumentPath(clientRow.user_id, profile.client_id));
    }
  }

  // 3. Separate counsel-approved-template agreement flow.
  if (!signedUrl && profile.client_id) {
    const { data: agreementRows } = await admin
      .from('client_service_agreements')
      .select('signed_document_path')
      .eq('client_id', profile.client_id)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false })
      .limit(1);
    const agreementPath = agreementRows?.[0]?.signed_document_path;
    if (agreementPath) signedUrl = await trySign(DOCUMENTS_BUCKET, agreementPath);
  }

  if (!signedUrl) {
    return json(404, {
      error: 'No signed agreement file is on file yet. Ask Credit Comeback Club to confirm enrollment documents were saved.',
      available: false,
    });
  }

  return json(200, {
    signedUrl,
    fileName: 'lpoa-signed.html',
    available: true,
  });
};
