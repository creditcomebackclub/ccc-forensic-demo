/** Client-authenticated, short-lived link to one signed enrollment artifact. */
const { createClient } = require('@supabase/supabase-js');
const { createAgreementViewToken } = require('./_agreementViewToken.cjs');
const { isAgreementArtifactKind, resolveAgreementDocument } = require('./_agreementDocument.cjs');

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function encodeArtifactDescriptor(document) {
  return Buffer.from(JSON.stringify({
    agreementId: document.agreementId,
    kind: document.kind,
    path: document.path,
    hash: document.hash || null,
  }), 'utf8').toString('base64url');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return json(400, { error: 'Invalid JSON.' }); }
  const kind = String(payload.kind || 'agreement');
  if (!isAgreementArtifactKind(kind)) return json(400, { error: 'Invalid signed-document kind.' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const accessToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!accessToken) return json(401, { error: 'Not signed in.' });

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !service) return json(500, { error: 'Server is not configured.' });

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData?.user) return json(401, { error: 'Invalid session.' });

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  let resolved;
  try { resolved = await resolveAgreementDocument(admin, userData.user.id, kind); }
  catch (error) {
    console.error('portal-agreement-url resolve failed', error);
    return json(500, { error: 'Could not verify the signed document.' });
  }
  if (resolved.profileMissing) return json(404, { error: 'Client profile not found.', available: false, kind });
  if (!resolved.document) {
    return json(404, { error: 'This signed document is not on file yet.', available: false, kind });
  }

  // _agreementViewToken signs its path field. Put the complete artifact
  // identity into that field so the HMAC is bound to agreement + kind + path
  // + immutable stored hash, not merely a caller-supplied storage path.
  const descriptor = encodeArtifactDescriptor(resolved.document);
  const viewToken = createAgreementViewToken(userData.user.id, resolved.document.bucket, descriptor, service);

  return json(200, {
    signedUrl: '/.netlify/functions/portal-agreement-view?token=' + encodeURIComponent(viewToken),
    fileName: resolved.document.fileName,
    contentType: resolved.document.contentType,
    kind,
    agreementId: resolved.document.agreementId,
    available: true,
  });
};

module.exports.encodeArtifactDescriptor = encodeArtifactDescriptor;
