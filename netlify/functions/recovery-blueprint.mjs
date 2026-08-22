import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import {
  assertRecoveryBlueprintReady,
  buildRecoveryBlueprintModel,
  RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
  recoveryBlueprintFilename,
} from '../../src/utils/recoveryBlueprintModel.js';
import { buildRecoveryBlueprintPdf } from '../../src/utils/recoveryBlueprintPdf.js';
import {
  buildClassificationReviewSnapshot,
  buildInitialAccountTrackStates,
  canonicalClassificationReviewSnapshotJson,
  canonicalClassificationRoutesJson,
  classificationRoutesFromStates,
  CLASSIFICATION_REVIEW_METHOD_VERSION,
} from '../../src/utils/disputeFlow.js';
import { hardRoutingBlockers, validateLatePaymentFacts } from '../../src/utils/disputeRoutingFacts.js';
import authHelpers from './_requireAuth.cjs';
import storagePaths from './_storagePaths.cjs';
import emailHelpers from './_email.cjs';

// Netlify's Node runtime (and any pin below 22) has no reliable global
// WebSocket. supabase-js always constructs a RealtimeClient in createClient()
// even for pure REST/storage — pass `ws` via realtime.transport. Do NOT use
// createRequire(import.meta.url): Netlify esbuild emits CJS where
// import.meta.url is undefined and the function 502s on cold start.

const { requireStaff } = authHelpers;
const { BLUEPRINTS_BUCKET: BUCKET, recoveryBlueprintPath } = storagePaths;
const { sendEmail } = emailHelpers;
const ACCOUNT_KINDS = new Set(['charge_off', 'collection', 'repossession', 'bankruptcy', 'student_loan', 'late_payment', 'positive', 'other']);
const BUREAU_CODES = new Set(['EQ', 'EXP', 'TU']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) };
}

function serverClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server environment is not configured.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, realtime: { transport: ws } });
}

async function loadAudit(db, payload, caller) {
  let query = db.from('audits').select('id,user_id,client_id,client_name,report_date,audit,saved_at');
  if (payload.auditId) {
    query = query.eq('id', payload.auditId);
  } else if (payload.clientId) {
    if (!payload.reportDate) throw badRequest('The report date is required to resolve the exact saved audit record.');
    query = query.eq('client_id', payload.clientId);
    query = query.eq('report_date', payload.reportDate);
  } else if (payload.clientName) {
    if (!payload.reportDate) throw badRequest('The report date is required to resolve the exact saved audit record.');
    query = query.eq('client_name', payload.clientName);
    query = query.eq('report_date', payload.reportDate);
    if (caller.role !== 'admin') query = query.eq('user_id', caller.userId);
  } else {
    throw Object.assign(new Error('An audit id or client identifier is required.'), { statusCode: 400 });
  }
  const { data, error } = await query.order('saved_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Saved audit not found.'), { statusCode: 404 });
  if (caller.role !== 'admin' && data.user_id !== caller.userId) {
    throw Object.assign(new Error('You do not have access to this audit.'), { statusCode: 403 });
  }
  return data;
}

function auditHash(audit) {
  return crypto.createHash('sha256').update(JSON.stringify(audit)).digest('hex');
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function badRequest(message) {
  return Object.assign(new Error(message), { statusCode: 400 });
}

function sameAuditRevision(expected, actual) {
  if (expected == null || actual == null) return expected == null && actual == null;
  if (expected === actual) return true;
  const expectedTime = Date.parse(expected);
  const actualTime = Date.parse(actual);
  return Number.isFinite(expectedTime) && Number.isFinite(actualTime) && expectedTime === actualTime;
}

function exactAccountId(account) {
  return String(account?.id || '').trim();
}

function exactClientAccountId(account) {
  return String(account?.clientAccountId || account?.client_account_id || '').trim();
}

function normalizedBureauCode(value) {
  const aliases = { eq: 'EQ', equifax: 'EQ', exp: 'EXP', experian: 'EXP', tu: 'TU', transunion: 'TU' };
  return aliases[String(value || '').trim().toLowerCase()] || null;
}

function reportedBureaus(account) {
  const bureaus = Array.isArray(account?.bureaus)
    ? account.bureaus.map(normalizedBureauCode)
    : [];
  if (!bureaus.length || bureaus.some((code) => !BUREAU_CODES.has(code)) || new Set(bureaus).size !== bureaus.length) {
    throw conflict(`Account ${account?.furnisher || exactAccountId(account) || 'unknown'} does not have an exact, unique reported-bureau list.`);
  }
  return [...bureaus].sort();
}

function assertAuditCoverage(audit) {
  const coverage = audit?.reportCoverage;
  if (!coverage?.complete
    || (coverage?.missing || []).length
    || (coverage?.duplicates || []).length
    || [...BUREAU_CODES].some((code) => Number(coverage?.counts?.[code]) !== 1)) {
    throw conflict('Classification review is blocked until the source contains exactly one Equifax, Experian, and TransUnion report.');
  }
}

function assertExactActionRevision(payload, auditRow) {
  if (!payload.auditId || payload.auditId !== auditRow.id) throw badRequest('The exact saved audit id is required for this Blueprint action.');
  if (!payload.clientId || payload.clientId !== auditRow.client_id) throw badRequest('The exact canonical client id is required for this Blueprint action.');
  if (!Object.prototype.hasOwnProperty.call(payload, 'expectedAuditRevision')
    || !/^[0-9a-f]{64}$/.test(String(payload.expectedAuditSha256 || ''))) {
    throw badRequest('Reload the exact saved audit revision before generating, approving, or sending a Blueprint.');
  }
  const currentSha256 = auditHash(auditRow.audit);
  if (!sameAuditRevision(payload.expectedAuditRevision ?? null, auditRow.saved_at ?? null)
    || payload.expectedAuditSha256 !== currentSha256) {
    throw conflict('This audit changed after it was opened. Reload the current saved review before continuing.');
  }
  return currentSha256;
}

function reviewedLateFacts(correction, account, bureauCode) {
  const supplied = correction?.latePaymentByBureau?.[bureauCode]
    || correction?.routingFacts?.bureauFacts?.[bureauCode]
    || null;
  if (!supplied) throw conflict(`${account.furnisher || exactAccountId(account)} needs confirmed late-payment facts for ${bureauCode}.`);
  const count = supplied.latePaymentCount === '' || supplied.latePaymentCount === null || supplied.latePaymentCount === undefined
    ? null
    : Number(supplied.latePaymentCount);
  const band = String(supplied.latePaymentBand || '').trim().toLowerCase();
  const validationError = validateLatePaymentFacts(count, band);
  if (validationError) throw conflict(`${account.furnisher || exactAccountId(account)} (${bureauCode}): ${validationError}`);
  return {
    ...(account?.routingFacts?.bureauFacts?.[bureauCode] || {}),
    accountKind: 'late_payment',
    latePaymentCount: count,
    latePaymentBand: band,
    latePaymentStatus: 'confirmed',
    reviewedSource: 'staff_review',
  };
}

function safeArtifact(row, signedUrl = null, currentAuditHash = null) {
  if (!row) return null;
  return {
    id: row.id,
    auditId: row.audit_id,
    version: row.version,
    status: row.status,
    templateVersion: row.template_version,
    fileName: row.file_name,
    approvedAt: row.approved_at,
    sentAt: row.sent_at,
    sentTo: row.sent_to,
    deliveryStatus: row.delivery_status,
    deliveryEventAt: row.delivery_event_at,
    deliveryError: row.delivery_error,
    deliveredAt: row.delivered_at,
    viewedAt: row.viewed_at,
    isCurrent: currentAuditHash ? row.audit_sha256 === currentAuditHash : true,
    signedUrl,
  };
}

async function latestArtifact(db, auditId) {
  const { data, error } = await db.from('recovery_blueprints')
    .select('*').eq('audit_id', auditId).order('version', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  return data;
}

async function signedUrl(db, path) {
  if (!path) return null;
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 15);
  if (error) throw error;
  return data?.signedUrl || null;
}

function pdfBuffer(auditRow) {
  const auditSha256 = auditHash(auditRow.audit);
  const exactAudit = {
    ...auditRow.audit,
    id: auditRow.id,
    auditRevision: auditRow.saved_at ?? null,
    auditSha256,
    client: { ...(auditRow.audit?.client || {}), id: auditRow.client_id, reportDate: auditRow.report_date },
  };
  const model = buildRecoveryBlueprintModel(exactAudit, {
    auditId: auditRow.id,
    clientId: auditRow.client_id,
    reportDate: auditRow.report_date,
    auditRevision: auditRow.saved_at ?? null,
    auditSha256,
  });
  const doc = buildRecoveryBlueprintPdf(model);
  return { model, buffer: Buffer.from(doc.output('arraybuffer')) };
}

async function sendBlueprintEmail({ to, subject, bodyText, fileName, buffer, artifactId }) {
  const { wrapClientEmail, escapeHtml } = emailHelpers;
  const paragraphs = String(bodyText).split(/\n{2,}/).map((paragraph) =>
    `<p style="margin:0 0 14px;">${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`).join('');
  const html = wrapClientEmail({
    eyebrow: 'Your Recovery Blueprint',
    bodyHtml: paragraphs,
    cta: null,
  });
  return sendEmail({
    to,
    subject,
    html,
    attachments: [{
      content: buffer.toString('base64'),
      filename: fileName,
      type: 'application/pdf',
    }],
    tags: [{ name: 'recovery_blueprint_id', value: String(artifactId) }],
  });
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return response(405, { error: 'Method not allowed' });
  let caller;
  try { caller = await requireStaff(event); }
  catch (error) { return error?.statusCode ? error : response(401, { error: 'Staff session required' }); }

  let payload;
  try { payload = JSON.parse(event.body || '{}'); }
  catch { return response(400, { error: 'Invalid JSON' }); }

  try {
    const db = serverClient();
    const auditRow = await loadAudit(db, payload, caller);
    const action = payload.action;

    if (action === 'status') {
      const artifact = await latestArtifact(db, auditRow.id);
      return response(200, {
        auditId: auditRow.id,
        auditRevision: auditRow.saved_at ?? null,
        auditSha256: auditHash(auditRow.audit),
        audit: auditRow.audit,
        classificationReview: auditRow.audit?.classificationReview || null,
        artifact: safeArtifact(artifact, artifact ? await signedUrl(db, artifact.storage_path) : null, auditHash(auditRow.audit)),
      });
    }

    if (action === 'save_corrections') {
      if (!payload.auditId || payload.auditId !== auditRow.id) throw badRequest('The exact saved audit id is required for classification review.');
      if (!payload.clientId || payload.clientId !== auditRow.client_id) throw badRequest('The exact canonical client id is required for classification review.');
      if (!auditRow.client_id) throw conflict('This audit must be linked to a canonical client before classification review.');
      if (!Object.prototype.hasOwnProperty.call(payload, 'expectedAuditRevision')
        || !/^[0-9a-f]{64}$/.test(String(payload.expectedAuditSha256 || ''))) {
        throw badRequest('Reload the exact saved audit revision before confirming classifications.');
      }
      const currentAuditSha256 = auditHash(auditRow.audit);
      if (!sameAuditRevision(payload.expectedAuditRevision ?? null, auditRow.saved_at ?? null)
        || payload.expectedAuditSha256 !== currentAuditSha256) {
        throw conflict('This audit changed after it was opened. Reload it and confirm the classifications against the current report facts.');
      }
      const { count: initializedTrackCount, error: initializedTrackError } = await db.from('ccc_account_tracks')
        .select('id', { count: 'exact', head: true })
        .eq('source_audit_id', auditRow.id)
        .eq('track_scope', 'cra');
      if (initializedTrackError) throw initializedTrackError;
      if (Number(initializedTrackCount) > 0) {
        throw conflict('This classification review is immutable because CRA tracks have already been initialized from it. Start from a new saved audit instead.');
      }
      assertAuditCoverage(auditRow.audit);

      const sourceAccounts = Array.isArray(auditRow.audit?.accounts) ? auditRow.audit.accounts : [];
      const suppliedCorrections = Array.isArray(payload.accounts) ? payload.accounts : [];
      if (!sourceAccounts.length || suppliedCorrections.length !== sourceAccounts.length) {
        throw badRequest('The classification review must include every account from the exact saved audit.');
      }
      const corrections = new Map();
      for (const correction of suppliedCorrections) {
        const correctionId = exactAccountId(correction);
        if (!correctionId || corrections.has(correctionId)) throw badRequest('Classification review contains a missing or duplicate audit account id.');
        corrections.set(correctionId, correction);
      }

      const reviewedAt = new Date().toISOString();
      const canonicalIds = [];
      const reviewedAccounts = sourceAccounts.map((account) => {
        const accountId = exactAccountId(account);
        const correction = corrections.get(accountId);
        if (!accountId || !correction) throw badRequest('A classification correction does not match the exact saved audit account ids.');
        if (correction.classificationAttested !== true) {
          throw conflict(`${account.furnisher || accountId} requires staff attestation after reviewing the displayed source evidence.`);
        }
        const clientAccountId = exactClientAccountId(account);
        if (!UUID_PATTERN.test(clientAccountId) || exactClientAccountId(correction) !== clientAccountId) {
          throw conflict(`${account.furnisher || accountId} is not reconciled to the exact canonical client account.`);
        }
        canonicalIds.push(clientAccountId);

        const originalHardBlockers = new Set(hardRoutingBlockers(account.routingFacts));
        if ((account.findings || []).some((finding) => finding?.ruleId === 'ACCOUNT_MATCH_AMBIGUOUS' || finding?.type === 'ACCOUNT_MATCH_AMBIGUOUS')) {
          originalHardBlockers.add('ACCOUNT_MATCH_AMBIGUOUS');
        }
        if (originalHardBlockers.size) {
          throw conflict(`${account.furnisher || accountId} cannot be confirmed until ${[...originalHardBlockers].join(', ')} is resolved in the source report match.`);
        }

        const accountKind = String(correction.accountKind || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
        if (!ACCOUNT_KINDS.has(accountKind)) throw badRequest('An account correction contains an unsupported category.');
        if (accountKind === 'other') throw conflict(`${account.furnisher || accountId} still needs a supported account category.`);
        const bureaus = reportedBureaus(account);
        const suppliedLateEntries = Object.entries(correction.latePaymentByBureau || {}).map(([code, fact]) => [normalizedBureauCode(code), fact]);
        if (suppliedLateEntries.some(([code]) => !code || !bureaus.includes(code))
          || new Set(suppliedLateEntries.map(([code]) => code)).size !== suppliedLateEntries.length) {
          throw badRequest(`${account.furnisher || accountId} contains late-payment facts for a bureau where the account is not reported.`);
        }
        const normalizedCorrection = {
          ...correction,
          latePaymentByBureau: Object.fromEntries(suppliedLateEntries),
        };
        const bureauFacts = Object.fromEntries(bureaus.map((bureauCode) => [bureauCode, accountKind === 'late_payment'
          ? reviewedLateFacts(normalizedCorrection, account, bureauCode)
          : {
            ...(account?.routingFacts?.bureauFacts?.[bureauCode] || {}),
            accountKind,
            latePaymentCount: null,
            latePaymentBand: 'none',
            latePaymentStatus: 'not_applicable',
            reviewedSource: 'staff_review',
          }]));
        const lateCounts = Object.values(bureauFacts).map((fact) => fact.latePaymentCount).filter(Number.isInteger);
        const lateBands = Object.values(bureauFacts).map((fact) => fact.latePaymentBand);
        const next = {
          ...account,
          clientAccountId,
          bureaus,
          classificationAttested: true,
          accountKind,
          latePaymentCount: accountKind === 'late_payment' && new Set(lateCounts).size === 1 ? lateCounts[0] : null,
          latePaymentBand: accountKind === 'late_payment' && new Set(lateBands).size === 1 ? lateBands[0] : (accountKind === 'late_payment' ? 'per_bureau' : 'none'),
          latePaymentByBureau: bureauFacts,
          routingFacts: {
            ...(account.routingFacts || {}),
            status: 'confirmed',
            source: 'staff_review',
            accountKind,
            blockingCodes: [],
            reportCoverage: account?.routingFacts?.reportCoverage || auditRow.audit.reportCoverage,
            evidence: Array.isArray(account?.routingFacts?.evidence) ? account.routingFacts.evidence : [],
            bureauFacts,
            reviewedAt,
            reviewedBy: caller.userId,
            staffAttested: true,
          },
        };
        delete next._edited;
        return next;
      });

      const uniqueCanonicalIds = [...new Set(canonicalIds)];
      if (uniqueCanonicalIds.length !== canonicalIds.length) throw conflict('Two audit accounts resolve to the same canonical client account; reconcile the match before review.');
      const { data: ownedAccounts, error: ownedError } = await db.from('client_accounts')
        .select('id,user_id,client_id,needs_review')
        .in('id', uniqueCanonicalIds);
      if (ownedError) throw ownedError;
      const ownedById = new Map((ownedAccounts || []).map((account) => [account.id, account]));
      for (const canonicalId of uniqueCanonicalIds) {
        const owned = ownedById.get(canonicalId);
        if (!owned || owned.user_id !== auditRow.user_id || owned.client_id !== auditRow.client_id || owned.needs_review) {
          throw conflict(`Canonical client account ${canonicalId} is missing, belongs to another client, or still requires reconciliation.`);
        }
      }

      const routingAudit = {
        ...auditRow.audit,
        id: auditRow.id,
        client: { ...(auditRow.audit.client || {}), id: auditRow.client_id },
        accounts: reviewedAccounts,
        classificationReview: null,
      };
      const states = buildInitialAccountTrackStates(routingAudit, CLASSIFICATION_REVIEW_METHOD_VERSION);
      const routes = classificationRoutesFromStates(states);
      if (!routes.length) throw conflict('No dispute-eligible CRA routes remain after classification review.');
      const routeJson = canonicalClassificationRoutesJson(routes);
      const previousReviewVersion = Number(auditRow.audit?.classificationReview?.version || 0);
      const reviewVersion = Number.isInteger(previousReviewVersion) && previousReviewVersion >= 0 ? previousReviewVersion + 1 : 1;
      const routingSnapshot = buildClassificationReviewSnapshot(routingAudit, routes, CLASSIFICATION_REVIEW_METHOD_VERSION);
      const routingSnapshotCanonical = canonicalClassificationReviewSnapshotJson(routingSnapshot);
      const classificationReview = {
        status: 'confirmed',
        version: reviewVersion,
        reviewedAt,
        reviewedBy: caller.userId,
        methodVersion: CLASSIFICATION_REVIEW_METHOD_VERSION,
        auditId: auditRow.id,
        clientId: auditRow.client_id,
        routes,
        routesSha256: crypto.createHash('sha256').update(routeJson).digest('hex'),
        routingSnapshot,
        routingSnapshotCanonical,
        routingSnapshotSha256: crypto.createHash('sha256').update(routingSnapshotCanonical).digest('hex'),
      };
      const nextAudit = { ...routingAudit, classificationReview };
      let saveQuery = db.from('audits')
        .update({ audit: nextAudit, saved_at: reviewedAt })
        .eq('id', auditRow.id)
        .eq('user_id', auditRow.user_id);
      saveQuery = payload.expectedAuditRevision == null
        ? saveQuery.is('saved_at', null)
        : saveQuery.eq('saved_at', payload.expectedAuditRevision);
      const { data: savedRow, error } = await saveQuery
        .select('id,saved_at,audit')
        .maybeSingle();
      if (error) throw error;
      if (!savedRow) throw conflict('This audit changed while it was being reviewed. Reload it and confirm the classifications again.');
      return response(200, {
        saved: true,
        auditId: auditRow.id,
        auditRevision: savedRow.saved_at ?? reviewedAt,
        auditSha256: auditHash(savedRow.audit || nextAudit),
        audit: savedRow.audit || nextAudit,
        classificationReview,
      });
    }

    if (action === 'preview') {
      assertExactActionRevision(payload, auditRow);
      const { model, buffer } = pdfBuffer(auditRow);
      return response(200, { auditId: auditRow.id, fileName: recoveryBlueprintFilename(model), pdfBase64: buffer.toString('base64'), templateVersion: model.templateVersion });
    }

    if (action === 'approve') {
      assertExactActionRevision(payload, auditRow);
      const latest = await latestArtifact(db, auditRow.id);
      const version = (latest?.version || 0) + 1;
      const { model, buffer } = pdfBuffer(auditRow);
      const sha = crypto.createHash('sha256').update(buffer).digest('hex');
      const fileName = recoveryBlueprintFilename(model);
      if (!auditRow.client_id) {
        throw Object.assign(new Error('This audit is missing a client_id; link it before approving a Blueprint.'), { statusCode: 409 });
      }
      const path = recoveryBlueprintPath(auditRow.user_id, auditRow.client_id, auditRow.id, version, sha.slice(0, 12));
      const { error: uploadError } = await db.storage.from(BUCKET).upload(path, buffer, { contentType: 'application/pdf', upsert: false });
      if (uploadError) throw uploadError;
      const { data: artifact, error: insertError } = await db.from('recovery_blueprints').insert({
        audit_id: auditRow.id,
        user_id: auditRow.user_id,
        client_id: auditRow.client_id,
        client_name: auditRow.client_name,
        report_date: auditRow.report_date,
        version,
        status: 'approved',
        template_version: RECOVERY_BLUEPRINT_TEMPLATE_VERSION,
        storage_path: path,
        file_name: fileName,
        file_sha256: sha,
        audit_sha256: auditHash(auditRow.audit),
        approved_by: caller.userId,
      }).select('*').single();
      if (insertError) {
        await db.storage.from(BUCKET).remove([path]);
        throw insertError;
      }
      return response(200, { artifact: safeArtifact(artifact, await signedUrl(db, path), auditHash(auditRow.audit)) });
    }

    if (action === 'send') {
      assertExactActionRevision(payload, auditRow);
      const exactAudit = {
        ...auditRow.audit,
        id: auditRow.id,
        client: { ...(auditRow.audit?.client || {}), id: auditRow.client_id },
      };
      assertRecoveryBlueprintReady(exactAudit, { auditId: auditRow.id, clientId: auditRow.client_id });
      const artifact = payload.artifactId
        ? (await db.from('recovery_blueprints').select('*').eq('id', payload.artifactId).eq('audit_id', auditRow.id).single()).data
        : await latestArtifact(db, auditRow.id);
      if (!artifact) throw Object.assign(new Error('Approve a Recovery Blueprint before sending it.'), { statusCode: 409 });
      if (artifact.audit_sha256 !== auditHash(auditRow.audit)) {
        throw Object.assign(new Error('The reviewed audit changed after this Blueprint was approved. Approve a new version before sending.'), { statusCode: 409 });
      }
      const to = String(payload.clientEmail || '').trim().toLowerCase();
      if (!to || !/^\S+@\S+\.\S+$/.test(to)) throw Object.assign(new Error('A valid recipient email is required.'), { statusCode: 400 });
      const { data: file, error: downloadError } = await db.storage.from(BUCKET).download(artifact.storage_path);
      if (downloadError) throw downloadError;
      const buffer = Buffer.from(await file.arrayBuffer());
      const messageId = await sendBlueprintEmail({
        to,
        subject: String(payload.subject || 'Your Credit Comeback Club Recovery Blueprint is Ready'),
        bodyText: String(payload.bodyText || 'Your Recovery Blueprint is attached.'),
        fileName: artifact.file_name,
        buffer,
        artifactId: artifact.id,
      });
      const now = new Date().toISOString();
      const { data: updated, error: updateError } = await db.from('recovery_blueprints').update({
        status: 'sent', sent_to: to, sent_at: now, sendgrid_message_id: messageId,
        delivery_status: 'accepted', delivery_event_at: now, updated_at: now,
      }).eq('id', artifact.id).select('*').single();
      if (updateError) throw updateError;
      return response(200, { sent: true, artifact: safeArtifact(updated, await signedUrl(db, artifact.storage_path), auditHash(auditRow.audit)) });
    }

    if (action === 'delete') {
      const artifactId = payload.artifactId;
      if (!artifactId) throw Object.assign(new Error('artifactId is required to delete a Blueprint version.'), { statusCode: 400 });
      const { data: artifact, error: loadError } = await db.from('recovery_blueprints')
        .select('*').eq('id', artifactId).eq('audit_id', auditRow.id).maybeSingle();
      if (loadError) throw loadError;
      if (!artifact) throw Object.assign(new Error('Blueprint version not found for this audit.'), { statusCode: 404 });

      const storagePath = artifact.storage_path;
      const { error: deleteError } = await db.from('recovery_blueprints')
        .delete().eq('id', artifact.id).eq('audit_id', auditRow.id);
      if (deleteError) throw deleteError;

      if (storagePath) {
        const { error: removeError } = await db.storage.from(BUCKET).remove([storagePath]);
        if (removeError) {
          // DB row is already gone — log and continue so staff aren't stuck.
          console.warn('[recovery-blueprint] storage remove failed after DB delete', removeError.message || removeError);
        }
      }

      const next = await latestArtifact(db, auditRow.id);
      return response(200, {
        deleted: true,
        deletedId: artifactId,
        artifact: safeArtifact(next, next ? await signedUrl(db, next.storage_path) : null, auditHash(auditRow.audit)),
      });
    }

    return response(400, { error: 'Unknown action' });
  } catch (error) {
    console.error('[recovery-blueprint]', error);
    return response(error.statusCode || 500, { error: error.message || 'Recovery Blueprint request failed.' });
  }
};
