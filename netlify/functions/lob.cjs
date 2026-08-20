const https = require('https');
const crypto = require('crypto');
const { archiveLobArtifact } = require('./_lobArtifacts.cjs');

function lobRequest(path, method, body, apiKey, extraHeaders) {
  return new Promise((resolve, reject) => {
    const auth = Buffer.from(apiKey + ':').toString('base64');
    const data = JSON.stringify(body);
    const options = {
      hostname: 'api.lob.com',
      port: 443,
      path,
      method,
      headers: {
        'Authorization': 'Basic ' + auth,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...(extraHeaders || {}),
      },
    };
    const req = https.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(raw) }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Server-owned writes for an irreversible mail submission.  The browser must
// never be the durable source of truth for a Lob idempotency key: a timeout,
// reload, or second tab otherwise generates a new key and can mail twice.
function supabaseRequest(path, method, body, supabaseUrl, serviceKey, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body == null ? null : JSON.stringify(body);
    const u = new URL(supabaseUrl + path);
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method,
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
        ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        Prefer: 'return=representation',
        ...extraHeaders,
      },
    }, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }); }
        catch (e) { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function isSuccess(res) {
  return res && res.status >= 200 && res.status < 300;
}

function requestError(res, fallback) {
  if (!res) return fallback;
  if (typeof res.body === 'object' && res.body?.message) return res.body.message;
  if (typeof res.body === 'string' && res.body) return res.body;
  return fallback;
}

async function findLetter(letterId, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId)
      + '&select=id,user_id,client_id,client_name,phase,html,covered_furnishers,lob_id,mailed_date,tracking_number,tracking_status,mail_service,expected_delivery_date,enclosure_parse_blocked,enclosure_parse_issues,source_phase3_letter_id,source_bureau_response_evidence_id,dispute_round_number',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load letter before mailing'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

function isBureauFollowUp(letter) {
  return /^Phase 3\b.*\(Follow-up\)/i.test(String(letter?.phase || ''))
    || !!(letter?.source_phase3_letter_id || letter?.source_bureau_response_evidence_id);
}

function bureauFromPhase(phase) {
  const value = String(phase || '').toLowerCase();
  if (value.includes('equifax')) return 'equifax';
  if (value.includes('experian')) return 'experian';
  if (value.includes('transunion') || value.includes('trans union')) return 'transunion';
  return null;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || !right.length) return false;
  return JSON.stringify([...new Set(left.map(String))].sort())
    === JSON.stringify([...new Set(right.map(String))].sort());
}

async function validateBureauFollowUpPreflight(letter, manifest, supabaseUrl, serviceKey) {
  if (!isBureauFollowUp(letter)) return [];
  const issues = [];
  const sourceLetterId = letter.source_phase3_letter_id;
  const sourceEvidenceId = letter.source_bureau_response_evidence_id;
  if (!sourceLetterId || !sourceEvidenceId) {
    return ['The saved follow-up does not identify both its exact prior Phase 3 letter and exact bureau response. Regenerate it before mailing.'];
  }
  if (!letter.client_id || !letter.user_id || sourceLetterId === letter.id) {
    return ['The saved follow-up source relationship is incomplete or invalid. Reconcile it before mailing.'];
  }

  const [priorResult, evidenceResult, clientResult] = await Promise.all([
    supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(sourceLetterId)
        + '&user_id=eq.' + encodeURIComponent(letter.user_id)
        + '&select=id,user_id,client_id,phase,covered_furnishers,html',
      'GET', null, supabaseUrl, serviceKey
    ),
    supabaseRequest(
      '/rest/v1/response_evidence?id=eq.' + encodeURIComponent(sourceEvidenceId)
        + '&firm_user_id=eq.' + encodeURIComponent(letter.user_id)
        + '&select=id,firm_user_id,client_id,letter_id,response_kind,storage_bucket,storage_paths,file_names,upload_status',
      'GET', null, supabaseUrl, serviceKey
    ),
    supabaseRequest(
      '/rest/v1/clients?id=eq.' + encodeURIComponent(letter.client_id)
        + '&select=id,user_id,lpoa_signature_data',
      'GET', null, supabaseUrl, serviceKey
    ),
  ]);
  if (!isSuccess(priorResult)) throw new Error(requestError(priorResult, 'Could not validate the prior Phase 3 enclosure'));
  if (!isSuccess(evidenceResult)) throw new Error(requestError(evidenceResult, 'Could not validate the bureau-response enclosure'));
  if (!isSuccess(clientResult)) throw new Error(requestError(clientResult, 'Could not validate the Limited Power of Attorney'));

  const prior = Array.isArray(priorResult.body) ? priorResult.body[0] : null;
  const evidence = Array.isArray(evidenceResult.body) ? evidenceResult.body[0] : null;
  const client = Array.isArray(clientResult.body) ? clientResult.body[0] : null;
  if (!prior
    || prior.id !== sourceLetterId
    || prior.user_id !== letter.user_id
    || prior.client_id !== letter.client_id
    || !String(prior.phase || '').startsWith('Phase 3')
    || !bureauFromPhase(letter.phase)
    || bureauFromPhase(prior.phase) !== bureauFromPhase(letter.phase)
    || !sameStringSet(prior.covered_furnishers, letter.covered_furnishers)
    || !String(prior.html || '').trim()) {
    issues.push('Exhibit A is not a printable Phase 3 letter for the same client, firm, bureau, and furnisher coverage.');
  }

  const paths = Array.isArray(evidence?.storage_paths) ? evidence.storage_paths : [];
  const names = Array.isArray(evidence?.file_names) ? evidence.file_names : [];
  const expectedPrefix = `${letter.user_id}/response-evidence/${sourceEvidenceId}/`;
  if (!evidence
    || evidence.id !== sourceEvidenceId
    || evidence.firm_user_id !== letter.user_id
    || evidence.client_id !== letter.client_id
    || evidence.letter_id !== sourceLetterId
    || evidence.response_kind !== 'bureau'
    || evidence.storage_bucket !== 'responses'
    || evidence.upload_status !== 'received'
    || paths.length === 0
    || paths.some((path) => typeof path !== 'string' || !path.startsWith(expectedPrefix))
    || names.length !== paths.length) {
    issues.push('Exhibit B is not a complete bureau response to Exhibit A for this same client and firm.');
  }
  if (!client
    || client.id !== letter.client_id
    || client.user_id !== letter.user_id
    || !client.lpoa_signature_data?.lpoaUrl) {
    issues.push('Exhibit C is missing the client’s signed Limited Power of Attorney.');
  }

  if (!manifest
    || manifest.kind !== 'bureau_follow_up_v1'
    || manifest.source_phase3_letter_id !== sourceLetterId
    || manifest.source_bureau_response_evidence_id !== sourceEvidenceId
    || JSON.stringify(manifest.response_storage_paths || []) !== JSON.stringify(paths)) {
    issues.push('The rendered packet manifest does not exactly match the saved follow-up sources.');
  }
  return issues;
}

async function validateCccR1IdentityPreflight(letter, manifest, supabaseUrl, serviceKey) {
  const { requiresCccR1IdentityDocuments } = await import('../../src/utils/cccMailRules.js');
  if (!requiresCccR1IdentityDocuments(letter)) return [];
  if (!letter.client_id || !letter.user_id) {
    return ['CCC R1 requires a canonical client record before identity documents can be attached.'];
  }

  const result = await supabaseRequest(
    '/rest/v1/documents?user_id=eq.' + encodeURIComponent(letter.user_id)
      + '&client_id=eq.' + encodeURIComponent(letter.client_id)
      + '&doc_type=in.(id,address)&select=id,doc_type,storage_path',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not validate CCC R1 identity documents'));

  const documents = Array.isArray(result.body) ? result.body : [];
  const idDocument = documents.find((document) => document.doc_type === 'id');
  const addressDocument = documents.find((document) => document.doc_type === 'address');
  const issues = [];
  if (!idDocument) issues.push('Government-issued photo ID is missing.');
  if (!addressDocument) issues.push('Proof of current address is missing.');
  if (issues.length > 0) return issues;

  const expectedIds = [idDocument.id, addressDocument.id];
  const expectedPaths = [idDocument.storage_path, addressDocument.storage_path];
  if (!manifest
    || manifest.kind !== 'ccc_r1_identity_v1'
    || JSON.stringify(manifest.document_ids || []) !== JSON.stringify(expectedIds)
    || JSON.stringify(manifest.storage_paths || []) !== JSON.stringify(expectedPaths)) {
    issues.push('The rendered CCC R1 packet manifest does not match the client’s current ID and proof-of-address records.');
  }
  return issues;
}

async function findSubmission(letterId, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId)
      + '&select=id,letter_id,idempotency_key,status,lob_id,tracking_number,attempt_count,last_error',
    'GET', null, supabaseUrl, serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not load mail submission'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

async function getOrCreateSubmission(letter, requestedBy, supabaseUrl, serviceKey) {
  let submission = await findSubmission(letter.id, supabaseUrl, serviceKey);
  if (submission) return submission;

  const created = await supabaseRequest(
    '/rest/v1/mail_submissions?on_conflict=letter_id',
    'POST',
    {
      letter_id: letter.id,
      user_id: letter.user_id,
      client_id: letter.client_id || null,
      requested_by: requestedBy || null,
      idempotency_key: crypto.randomUUID(),
      status: 'pending',
    },
    supabaseUrl,
    serviceKey,
    { Prefer: 'resolution=ignore-duplicates,return=representation' }
  );
  if (!isSuccess(created)) throw new Error(requestError(created, 'Could not create durable mail submission'));

  submission = Array.isArray(created.body) ? created.body[0] : null;
  // A concurrent click may have won the unique(letter_id) insert. Fetch its
  // key and deliberately reuse it so Lob still sees both requests as one.
  return submission || findSubmission(letter.id, supabaseUrl, serviceKey);
}

async function updateSubmission(letterId, patch, supabaseUrl, serviceKey) {
  const result = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letterId),
    'PATCH',
    { ...patch, updated_at: new Date().toISOString() },
    supabaseUrl,
    serviceKey
  );
  if (!isSuccess(result)) throw new Error(requestError(result, 'Could not update durable mail submission'));
  return Array.isArray(result.body) ? result.body[0] : null;
}

// A retry is permitted only after the signed Lob webhook has recorded a
// rendering failure. It deliberately rotates the durable idempotency key and
// clears only the operational fields; the original failed Lob ID remains in
// lob_webhook_events as the immutable audit record.
async function prepareFailedRetry(letter, submission, supabaseUrl, serviceKey) {
  if (submission.status !== 'failed' || letter.tracking_status !== 'Failed') {
    throw new Error('This mailpiece is not a confirmed failed Lob send and cannot be retried.');
  }
  if (letter.lob_id) {
    const cleared = await supabaseRequest(
      '/rest/v1/letters?id=eq.' + encodeURIComponent(letter.id)
        + '&lob_id=eq.' + encodeURIComponent(letter.lob_id)
        + '&tracking_status=eq.Failed',
      'PATCH',
      { lob_id: null, mailed_date: null, tracking_number: null, tracking_status: 'Failed', delivered_at: null, expected_delivery_date: null },
      supabaseUrl, serviceKey
    );
    if (!isSuccess(cleared) || !Array.isArray(cleared.body) || cleared.body.length !== 1) {
      throw new Error('The failed mailpiece changed before it could be retried. Refresh the letter and try again.');
    }
  }
  const reset = await supabaseRequest(
    '/rest/v1/mail_submissions?letter_id=eq.' + encodeURIComponent(letter.id) + '&status=eq.failed',
    'PATCH',
    {
      idempotency_key: crypto.randomUUID(), status: 'pending', lob_id: null,
      tracking_number: null, submitted_at: null, last_error: null,
      updated_at: new Date().toISOString(),
    },
    supabaseUrl, serviceKey
  );
  if (!isSuccess(reset) || !Array.isArray(reset.body) || reset.body.length !== 1) {
    throw new Error('Could not prepare a fresh safe retry for this failed mailpiece.');
  }
  return reset.body[0];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // Only authenticated admins may send letters or verify addresses via Lob.
  const { requireAdmin } = require('./_requireAdmin.cjs');
  let admin;
  try { admin = await requireAdmin(event); }
  catch (e) { if (e.statusCode) return e; throw e; }

  // Prefer non-VITE names — VITE_-prefixed vars risk being inlined into the
  // client bundle if ever referenced from browser code. Old names kept as
  // fallback until the Netlify env is renamed.
  const mode = process.env.LOB_MODE || 'test';
  const apiKey = mode === 'live'
    ? process.env.LOB_LIVE_KEY
    : process.env.LOB_TEST_KEY;

  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Lob API key not configured' }) };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Supabase server configuration is required for Lob operations' }) };
  }

  let payload;
  try { payload = JSON.parse(event.body); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { action } = payload;

  try {
    if (action === 'verify_address') {
      const { address } = payload;
      const result = await lobRequest('/v1/us_verifications', 'POST', {
        primary_line: address.line1,
        secondary_line: address.line2 || '',
        city: address.city,
        state: address.state,
        zip_code: address.zip,
      }, apiKey);
      return { statusCode: 200, body: JSON.stringify(result.body) };
    }

    if (action === 'send_letter') {
      const { toAddress, fromAddress, remoteUrl, description, metadata, enclosureManifest } = payload;
      const letterId = metadata && metadata.letter_id;
      if (!letterId || !remoteUrl || !toAddress || !fromAddress) {
        return { statusCode: 400, body: JSON.stringify({ error: 'letter_id, rendered letter URL, and complete addresses are required' }) };
      }

      // The database—not browser state—is the authoritative preflight check.
      // It prevents both a citation/enclosure block bypass and a second send
      // after a reload, timeout, or a staff member opens the same letter in
      // another tab.
      const letter = await findLetter(letterId, supabaseUrl, serviceKey);
      if (!letter) return { statusCode: 404, body: JSON.stringify({ error: 'Letter not found' }) };
      if (String(letter.phase || '').startsWith('Phase 3')) {
        const {
          collectBureauFollowUpProblems,
          collectPhase3CitationProblems,
        } = await import('../../src/constants/metro2Fields.js');
        const currentProblems = isBureauFollowUp(letter)
          ? collectBureauFollowUpProblems(letter.html)
          : collectPhase3CitationProblems(letter.html);
        if (currentProblems.length > 0) {
          return {
            statusCode: 422,
            body: JSON.stringify({
              error: 'PHASE 3 CONTENT FAILED CURRENT PRODUCTION-SAFETY RULES — nothing was sent.',
              issues: currentProblems,
              blocked: true,
            }),
          };
        }
      }
      if (letter.enclosure_parse_blocked) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'ENCLOSURE UNPARSED — MANUAL RECONCILIATION REQUIRED',
            issues: letter.enclosure_parse_issues || [],
            blocked: true,
          }),
        };
      }
      // A bureau-facing Phase 3 packet must identify the exact furnishers it
      // covers. Never use a client-wide fallback here: it can attach unrelated
      // Phase 1 disputes and responses to the wrong bureau reinvestigation.
      if (String(letter.phase || '').startsWith('Phase 3')
        && (!Array.isArray(letter.covered_furnishers) || letter.covered_furnishers.length === 0)) {
        return {
          statusCode: 422,
          body: JSON.stringify({ error: 'PHASE 3 COVERAGE MISSING — assign the specific furnisher(s) this bureau letter covers before mailing.', blocked: true }),
        };
      }
      const followUpIssues = await validateBureauFollowUpPreflight(
        letter,
        enclosureManifest,
        supabaseUrl,
        serviceKey
      );
      if (followUpIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'BUREAU FOLLOW-UP ENCLOSURES INVALID — nothing was sent.',
            issues: followUpIssues,
            blocked: true,
          }),
        };
      }
      const identityIssues = await validateCccR1IdentityPreflight(
        letter,
        enclosureManifest,
        supabaseUrl,
        serviceKey
      );
      if (identityIssues.length > 0) {
        return {
          statusCode: 422,
          body: JSON.stringify({
            error: 'CCC R1 IDENTITY ENCLOSURES INVALID — nothing was sent.',
            issues: identityIssues,
            blocked: true,
          }),
        };
      }

      let submission = await findSubmission(letterId, supabaseUrl, serviceKey);
      if (submission && (submission.status === 'submitted' || submission.status === 'accepted_unreconciled') && submission.lob_id) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: submission.lob_id,
            tracking_number: submission.tracking_number || letter.tracking_number || null,
            mailed_date: letter.mailed_date || null,
            mail_service: letter.mail_service || null,
            expected_delivery_date: letter.expected_delivery_date || null,
            duplicate: true,
            mail_submission_status: submission.status,
          }),
        };
      }
      if (!submission && (letter.lob_id || letter.mailed_date)) {
        // Historical/manual mail has no durable submission record, but it is
        // still a real send. Never let a UI retry convert it to duplicate
        // postage; staff must create a reviewed revision instead.
        return {
          statusCode: 409,
          body: JSON.stringify({ error: 'This letter is already marked mailed. Create a new reviewed revision before sending again.' }),
        };
      }

      submission = submission || await getOrCreateSubmission(letter, admin.userId, supabaseUrl, serviceKey);
      if (!submission) throw new Error('Could not claim a durable mail submission');
      if ((submission.status === 'submitted' || submission.status === 'accepted_unreconciled') && submission.lob_id) {
        return {
          statusCode: 200,
          body: JSON.stringify({
            id: submission.lob_id,
            tracking_number: submission.tracking_number || letter.tracking_number || null,
            mailed_date: letter.mailed_date || null,
            mail_service: letter.mail_service || null,
            expected_delivery_date: letter.expected_delivery_date || null,
            duplicate: true,
            mail_submission_status: submission.status,
          }),
        };
      }

      if (submission.status === 'failed') {
        submission = await prepareFailedRetry(letter, submission, supabaseUrl, serviceKey);
      }

      await updateSubmission(letterId, {
        status: 'pending',
        attempt_count: (submission.attempt_count || 0) + 1,
        last_attempt_at: new Date().toISOString(),
        last_error: null,
      }, supabaseUrl, serviceKey);

      const { USPS_FIRST_CLASS, mailServiceForLetter } = await import('../../src/utils/cccMailRules.js');
      const mailService = mailServiceForLetter(letter);
      const letterPayload = {
        description: description || 'CCC Dispute Letter',
        to: {
          name: toAddress.name,
          address_line1: toAddress.line1,
          address_line2: toAddress.line2 || '',
          address_city: toAddress.city,
          address_state: toAddress.state,
          address_zip: toAddress.zip,
          address_country: 'US',
        },
        from: {
          name: fromAddress.name,
          address_line1: fromAddress.line1,
          address_line2: fromAddress.line2 || '',
          address_city: fromAddress.city,
          address_state: fromAddress.state,
          address_zip: fromAddress.zip,
          address_country: 'US',
        },
        file: remoteUrl,
        // Text letters print B&W double-sided — enclosures are grayscaled
        // upstream anyway, and this roughly halves the per-letter cost
        color: false,
        double_sided: true,
        address_placement: 'top_first_page',
        mail_type: 'usps_first_class',
        // New CCC flow letters use regular First Class, exactly as the course
        // specifies. Historical Phase 1/3 workflows retain their original
        // Certified Return Receipt service so old client records stay true.
        ...(mailService === USPS_FIRST_CLASS ? {} : { extra_service: 'certified_return_receipt' }),
        // Lets the webhook match the letter row even if lob_id never got saved
        metadata: { letter_id: String(letterId) },
      };
      // This key was persisted before the Lob request. A reload or a second
      // tab therefore hits the same Lob idempotency record rather than
      // creating another physical mailpiece.
      const result = await lobRequest('/v1/letters', 'POST', letterPayload, apiKey, {
        'Idempotency-Key': String(submission.idempotency_key),
      });
      if (!isSuccess(result) || !result.body?.id) {
        await updateSubmission(letterId, {
          status: 'failed',
          last_error: requestError(result, 'Lob did not accept the letter'),
        }, supabaseUrl, serviceKey);
        return { statusCode: result.status || 502, body: JSON.stringify(result.body || { error: 'Lob did not accept the letter' }) };
      }

      // Persist Lob's acceptance server-side. If the letters row cannot be
      // reconciled after an accepted send, retain the Lob ID in the durable
      // submission and explicitly surface it as a reconciliation task—never
      // present it as a failed send that someone might retry.
      const mailedAt = new Date().toISOString().slice(0, 10);
      const savedLetter = await supabaseRequest(
        '/rest/v1/letters?id=eq.' + encodeURIComponent(letterId) + '&lob_id=is.null',
        'PATCH',
        {
          lob_id: result.body.id,
          mailed_date: mailedAt,
          tracking_number: result.body.tracking_number || null,
          tracking_status: 'Mailed',
          mail_service: mailService,
          expected_delivery_date: result.body.expected_delivery_date || null,
        },
        supabaseUrl,
        serviceKey
      );
      let letterWasSaved = isSuccess(savedLetter) && Array.isArray(savedLetter.body) && savedLetter.body.length > 0;
      // When two browser tabs race with the same durable Lob key, Lob returns
      // the same accepted mailpiece to both. The losing PATCH sees `lob_id`
      // already populated, which is a successful reconciliation—not a reason
      // to downgrade the submission to `accepted_unreconciled`.
      if (!letterWasSaved) {
        try {
          const reconciledLetter = await findLetter(letterId, supabaseUrl, serviceKey);
          letterWasSaved = reconciledLetter?.lob_id === result.body.id;
        } catch (recheckError) {
          console.warn('Could not confirm concurrent letter reconciliation:', letterId, recheckError.message);
        }
      }
      await updateSubmission(letterId, {
        status: letterWasSaved ? 'submitted' : 'accepted_unreconciled',
        lob_id: result.body.id,
        tracking_number: result.body.tracking_number || null,
        submitted_at: new Date().toISOString(),
        last_error: letterWasSaved ? null : 'Lob accepted the mailpiece, but the letters row requires reconciliation.',
      }, supabaseUrl, serviceKey);
      // Archive the immutable, Lob-rendered mailpiece while this request still
      // knows the CCC letter id. This is evidence capture, never a condition
      // of mailing: Lob already accepted the mailpiece, so an archive failure
      // must not be reported as a send failure or invite an expensive resend.
      let artifactArchive = null;
      if (result.status >= 200 && result.status < 300 && result.body?.id && letterId) {
        try {
          artifactArchive = await archiveLobArtifact({
            lobId: result.body.id,
            letterId,
            artifactType: 'mailpiece_pdf',
            sourceUrl: result.body.url || null,
            apiKey,
            supabaseUrl,
            serviceKey,
          });
          if (!artifactArchive.archived) console.warn('Lob mailpiece not archived yet:', artifactArchive.reason, result.body.id);
        } catch (archiveErr) {
          console.error('Lob mailpiece archive failed (mail was still accepted):', result.body.id, archiveErr.message);
        }
      }
      return {
        statusCode: result.status,
        body: JSON.stringify({
          ...(result.body || {}),
          mailed_date: mailedAt,
          mail_service: mailService,
          artifact_archive: artifactArchive && artifactArchive.archived ? 'archived' : 'pending',
          mail_submission_status: letterWasSaved ? 'submitted' : 'accepted_unreconciled',
          reconciliation_required: !letterWasSaved,
        }),
      };
    }

    if (action === 'get_tracking') {
      const { letterId } = payload;
      const result = await lobRequest('/v1/letters/' + letterId, 'GET', {}, apiKey);
      return { statusCode: result.status, body: JSON.stringify(result.body) };
    }

    // Historical backfill: a staff member can ask Lob for the exact rendered
    // PDF for an already-mailed letter. The archive helper verifies that the
    // supplied Lob ID belongs to this CCC letter before it downloads anything.
    if (action === 'archive_letter_artifact') {
      const { letterId, lobId } = payload;
      if (!letterId || !lobId) return { statusCode: 400, body: JSON.stringify({ error: 'letterId and lobId required' }) };
      const archived = await archiveLobArtifact({
        lobId,
        letterId,
        artifactType: 'mailpiece_pdf',
        apiKey,
        supabaseUrl: process.env.VITE_SUPABASE_URL,
        serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      });
      return { statusCode: archived.archived ? 200 : 202, body: JSON.stringify(archived) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message || 'Lob request failed' }) };
  }
};
