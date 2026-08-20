/**
 * Serves the client's signed LPOA / service agreement HTML with a real
 * Content-Type: text/html so the browser renders it as a document.
 *
 * WHY THIS EXISTS: Supabase Storage refuses to serve stored HTML inline. Even
 * when the object's stored mimetype is correctly "text/html", a request to
 * /storage/v1/object/sign/... comes back as:
 *     content-type: text/plain
 *     x-content-type-options: nosniff
 * which makes the browser display the raw markup instead of the document.
 * That is a deliberate stored-XSS defense on the *.supabase.co origin, so no
 * amount of re-uploading with the right content-type can change it (two
 * earlier attempts to do exactly that shipped and failed). The blueprint PDF
 * is unaffected because PDFs are not an XSS vector and are served as stored.
 *
 * So the bytes are proxied through this function instead, which is free to
 * declare the correct type on its own origin.
 *
 * This is a GET so window.open() can reach it, which means auth rides in a
 * short-lived HMAC token rather than an Authorization header. The token is
 * minted by portal-agreement-url.cjs only for an authenticated client, expires
 * in 120s, and is bound to both the user and the object path. On top of that
 * this handler re-resolves which document the token's user actually owns and
 * refuses to serve anything else, so a tampered or replayed token cannot reach
 * another client's file.
 */
const { createClient } = require('@supabase/supabase-js');
const { verifyAgreementViewToken } = require('./_agreementViewToken.cjs');
const { resolveAgreementDocument } = require('./_agreementDocument.cjs');

function text(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    body,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return text(405, 'Method not allowed');

  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !service) return text(500, 'Server is not configured.');

  const claims = verifyAgreementViewToken(event.queryStringParameters?.token, service);
  if (!claims) return text(403, 'This agreement link is invalid or has expired. Please reopen it from your portal.');

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });

  // Re-resolve from the user in the token rather than trusting the path in it.
  const { document } = await resolveAgreementDocument(admin, claims.userId);
  if (!document) return text(404, 'No signed agreement file is on file yet.');
  if (document.bucket !== claims.bucket || document.path !== claims.path) {
    return text(403, 'This agreement link is no longer valid. Please reopen it from your portal.');
  }

  const { data: blob, error } = await admin.storage.from(document.bucket).download(document.path);
  if (error || !blob) return text(404, 'Could not load your signed agreement.');

  const html = Buffer.from(await blob.arrayBuffer()).toString('utf8');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      // Serving this on our own origin gives up the isolation Supabase was
      // enforcing, so lock the document down instead: the LPOA only ever needs
      // inline CSS and a base64 signature image, never script or network access.
      //
      // `sandbox` (with no allow-* tokens) drops the document into an opaque
      // origin, so even a bypass of the directives above cannot reach the
      // portal's own localStorage/session on this domain. It is the same
      // pairing Supabase Storage itself applies to HTML objects. Scripting is
      // already dead via default-src 'none'; this is the second lock, and it
      // matters because the stored LPOA historically interpolated a
      // client-supplied name without escaping.
      'Content-Security-Policy':
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    },
    body: html,
  };
};
