const { DOCUMENTS_BUCKET, lpoaDocumentPath } = require('./_storagePaths.cjs');

/**
 * Resolve where a given portal user's signed LPOA / service agreement actually
 * lives in storage.
 *
 * Three onboarding paths write the signed document to three different places
 * (see the ClientBillingPanel.jsx comment near startOnboarding and
 * portal-enroll-upload.cjs's "legacy portal enrollment" branch), so all three
 * are checked before giving up:
 *   1. client_profiles.lpoa_storage_path — set by sign-lpoa.cjs (staff-sent
 *      signing link).
 *   2. The deterministic lpoaDocumentPath() location — written by the in-portal
 *      wizard (ClientOnboardingModal), which never backfills client_profiles.
 *   3. client_service_agreements.signed_document_path — the separate
 *      counsel-approved-template flow (agreement-onboarding.cjs).
 *
 * Shared by portal-agreement-url.cjs (mints a view token) and
 * portal-agreement-view.cjs (re-resolves to authorize the token it was handed).
 * Keeping one implementation means the two can never drift out of agreement
 * about which document belongs to which user.
 */
async function objectExists(admin, bucket, path) {
  if (!bucket || !path) return false;
  const dir = path.split('/').slice(0, -1).join('/');
  const name = path.split('/').pop();
  const { data, error } = await admin.storage.from(bucket).list(dir, { search: name, limit: 100 });
  if (error) return false;
  return (data || []).some((f) => f.name === name);
}

async function resolveAgreementDocument(admin, userId) {
  const { data: profile } = await admin
    .from('client_profiles')
    .select('client_id, full_name, user_id, lpoa_storage_bucket, lpoa_storage_path')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (!profile) return { profileMissing: true, document: null };

  // 1. Cached path from the staff-sent signing link (sign-lpoa.cjs).
  if (profile.lpoa_storage_path) {
    const bucket = profile.lpoa_storage_bucket || DOCUMENTS_BUCKET;
    if (await objectExists(admin, bucket, profile.lpoa_storage_path)) {
      return { profileMissing: false, document: { bucket, path: profile.lpoa_storage_path } };
    }
  }

  // 2. In-portal wizard writes to the deterministic path but never backfills
  //    client_profiles — reconstruct it and check whether it's actually there.
  if (profile.client_id) {
    const { data: clientRow } = await admin
      .from('clients')
      .select('user_id, lpoa_signed')
      .eq('id', profile.client_id)
      .limit(1)
      .maybeSingle();
    if (clientRow?.lpoa_signed && clientRow.user_id) {
      const path = lpoaDocumentPath(clientRow.user_id, profile.client_id);
      if (await objectExists(admin, DOCUMENTS_BUCKET, path)) {
        return { profileMissing: false, document: { bucket: DOCUMENTS_BUCKET, path } };
      }
    }
  }

  // 3. Separate counsel-approved-template agreement flow.
  if (profile.client_id) {
    const { data: agreementRows } = await admin
      .from('client_service_agreements')
      .select('signed_document_path')
      .eq('client_id', profile.client_id)
      .eq('status', 'signed')
      .order('signed_at', { ascending: false })
      .limit(1);
    const path = agreementRows?.[0]?.signed_document_path;
    if (path && (await objectExists(admin, DOCUMENTS_BUCKET, path))) {
      return { profileMissing: false, document: { bucket: DOCUMENTS_BUCKET, path } };
    }
  }

  return { profileMissing: false, document: null };
}

module.exports = { resolveAgreementDocument, objectExists };
