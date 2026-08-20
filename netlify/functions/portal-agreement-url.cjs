/**
 * Client-authenticated link to their signed LPOA / service agreement.
 * Does not rely on browser storage RLS or client documents SELECT.
 *
 * Returns a URL to portal-agreement-view.cjs rather than a Supabase Storage
 * signed URL, because Supabase will not serve stored HTML inline — it forces
 * content-type: text/plain + nosniff regardless of the stored mimetype, so the
 * browser shows raw markup instead of the document. See the header comment on
 * portal-agreement-view.cjs for the full explanation.
 *
 * Locating the document is shared with that view endpoint via
 * _agreementDocument.cjs so the two cannot disagree about ownership.
 */
const { createClient } = require('@supabase/supabase-js');
const { createAgreementViewToken } = require('./_agreementViewToken.cjs');
const { resolveAgreementDocument } = require('./_agreementDocument.cjs');

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

  const { profileMissing, document } = await resolveAgreementDocument(admin, userData.user.id);
  if (profileMissing) return json(404, { error: 'Client profile not found.' });

  if (!document) {
    return json(404, {
      error: 'No signed agreement file is on file yet. Ask Credit Comeback Club to confirm enrollment documents were saved.',
      available: false,
    });
  }

  const viewToken = createAgreementViewToken(userData.user.id, document.bucket, document.path, service);

  // Still keyed "signedUrl" so existing portal callers keep working unchanged;
  // it is now a same-origin view URL rather than a Supabase signed URL.
  return json(200, {
    signedUrl: '/.netlify/functions/portal-agreement-view?token=' + encodeURIComponent(viewToken),
    fileName: 'lpoa-signed.html',
    available: true,
  });
};
