import { supabase } from './supabase';
import { diffAuditAccounts, normalizeFurnisher } from './diffEngine';
import { buildPhaseProgress } from './phaseProgress';

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

async function getUserId() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  return user.id;
}

// clientId is optional and preferred over clientName when present — see
// the client_id migration plan; clients.name has no unique constraint.
// Genuinely absent for a lead purely synthesized from orphan audits/letters
// with no clients row yet (see deleteLead), so upsert (not update) is kept
// either way — conflict target just switches to the real PK when we have it,
// which also means an existing row is matched/updated by id even if its
// name has since changed, instead of silently creating a second row.
export async function updateClientProfile(clientName, fields, clientId) {
  const userId = await getUserId();
  const { error } = clientId
    ? await supabase.from('clients').upsert({ id: clientId, user_id: userId, name: clientName, ...fields }, { onConflict: 'id' })
    : await supabase.from('clients').upsert({ user_id: userId, name: clientName, ...fields }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function updateClientEmail(clientName, email, clientId) {
  const userId = await getUserId();
  const { error } = clientId
    ? await supabase.from('clients').upsert({ id: clientId, user_id: userId, name: clientName, email }, { onConflict: 'id' })
    : await supabase.from('clients').upsert({ user_id: userId, name: clientName, email }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function updateLeadInfo(clientName, { email, phone, source, notes }, clientId) {
  const userId = await getUserId();
  const patch = clientId ? { id: clientId, user_id: userId, name: clientName } : { user_id: userId, name: clientName };
  if (email !== undefined) patch.email = email || null;
  if (phone !== undefined) patch.lead_phone = phone || null;
  if (source !== undefined) patch.lead_source = source || null;
  if (notes !== undefined) patch.lead_notes = notes || null;
  const { error } = await supabase.from('clients').upsert(patch, clientId ? { onConflict: 'id' } : { onConflict: 'user_id,name' });
  if (error) throw error;
}

// Lead pipeline stage lives in the tags array as 'lead-stage:<stage>' —
// no schema change needed; other tags are preserved
export async function updateLeadStage(clientName, stage, existingTags, clientId) {
  const userId = await getUserId();
  const tags = (existingTags || []).map(String).filter((t) => !t.startsWith('lead-stage:'));
  if (stage) tags.push('lead-stage:' + stage);
  const { error } = clientId
    ? await supabase.from('clients').upsert({ id: clientId, user_id: userId, name: clientName, tags }, { onConflict: 'id' })
    : await supabase.from('clients').upsert({ user_id: userId, name: clientName, tags }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

// Clears the sidebar's "new leads" badge for this one lead — stamped the
// moment staff open its card, not on any timer, so the badge behaves like a
// real notification instead of decaying on a 48h clock.
export async function markLeadViewed(clientName, clientId) {
  const userId = await getUserId();
  const { error } = clientId
    ? await supabase.from('clients').upsert({ id: clientId, user_id: userId, name: clientName, lead_viewed_at: new Date().toISOString() }, { onConflict: 'id' })
    : await supabase.from('clients').upsert({ user_id: userId, name: clientName, lead_viewed_at: new Date().toISOString() }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function toggleVip(clientName, isVip, clientId) {
  const userId = await getUserId();
  const { error } = clientId
    ? await supabase.from('clients').upsert({ id: clientId, user_id: userId, name: clientName, is_vip: isVip }, { onConflict: 'id' })
    : await supabase.from('clients').upsert({ user_id: userId, name: clientName, is_vip: isVip }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

// Fire-and-forget: kicks the server-side progress-narrative background
// function (Retention Build 1b) when a client has picked up their 2nd+
// audit. Never awaited by its callers and never throws outward — a failure
// here must not surface as an audit-save error. clientId is optional and
// preferred over clientName when present — see the client_id migration
// plan; clients.name has no unique constraint.
async function triggerProgressNarrative(clientName, clientId) {
  try {
    const userId = await getUserId();
    const countQuery = clientId
      ? supabase.from('audits').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('client_id', clientId)
      : supabase.from('audits').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('client_name', clientName);
    const { count } = await countQuery;
    if (!count || count < 2) return;

    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;

    // Netlify background functions ACK with 202 and run detached — this
    // fetch is not awaited by the caller, so the audit save never waits on
    // the network round trip, let alone the narrative generation itself.
    await fetch('/.netlify/functions/progress-narrative-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ clientName, clientId: clientId || null }),
    });
  } catch (e) {
    console.warn('Could not trigger progress narrative:', e);
  }
}

// Called from AuditResults.jsx whenever staff confirm a furnisher's address
// (the existing workflow, no new step) — makes that confirmation available
// for every future client's audit instead of it only ever applying to the
// one account it was typed in for.
export async function upsertFurnisherAddress(furnisherName, address) {
  const userId = await getUserId();
  const furnisherKey = normalizeFurnisher(furnisherName);
  if (!furnisherKey || !address || !address.line1) return;
  const { error } = await supabase.from('furnisher_addresses').upsert({
    user_id: userId,
    furnisher_key: furnisherKey,
    display_name: address.name || furnisherName,
    address_line1: address.line1,
    address_line2: address.line2 || null,
    city: address.city,
    state: address.state,
    zip: address.zip,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id,furnisher_key' });
  if (error) console.warn('Could not save furnisher address:', error);
}

export async function saveLetter(account, client, html, summary, phase, idSuffix, metadata = {}) {
  const userId = await getUserId();
  const clientName = (client && client.name) || 'Unknown Client';
  const clientId = (client && client.id) || null;
  const furnisher = (account && account.furnisher) || 'Unknown Furnisher';
  const accountId = (account && (account.id || account.accountNumberMasked)) || '';
  const clientAccountId = (account && account.clientAccountId) || null;
  const date = todayISO();
  // New records carry the canonical client/tradeline identity. The legacy
  // name-only form is retained only where an old caller genuinely has no id.
  const clientSuffix = clientId ? '__' + clientId : '';
  const stableAccountId = clientAccountId || accountId;
  const acctSuffix = stableAccountId ? '__' + slug(String(stableAccountId)) : '';
  const baseId = slug(clientName) + clientSuffix + '__' + slug(furnisher) + acctSuffix + '__' + date + (idSuffix || '');

  // A physical-mail record is evidence, not a regeneratable draft. The old
  // upsert silently reset mailed/response fields and could replace the HTML
  // behind an already-sent letter. Create a new explicit revision instead.
  let id = baseId;
  const { data: existing, error: existingError } = await supabase
    .from('letters')
    .select('id,lob_id,tracking_number,tracking_status,mailed_date,delivered_at,response_outcome')
    .eq('id', baseId)
    .eq('user_id', userId)
    .maybeSingle();
  if (existingError) throw existingError;
  const isImmutable = existing && (
    existing.lob_id || existing.tracking_number || existing.tracking_status ||
    existing.mailed_date || existing.delivered_at || existing.response_outcome
  );
  if (isImmutable) id = `${baseId}__revision-${Date.now()}`;

  const { error } = await supabase.from('letters').upsert({
    id,
    user_id: userId,
    created_by: userId,
    client_id: clientId,
    client_name: clientName,
    furnisher,
    account_id: accountId,
    // Persistent tradeline UUID (client_accounts) injected into the audit
    // account at ingest — stable across audit re-runs, unlike account_id
    // (positional). Phase 3 bureau gating resolves through this.
    client_account_id: clientAccountId,
    phase: phase || 'Phase 1',
    type: (account && account.type) || null,
    saved_at: new Date().toISOString(),
    date,
    html,
    summary: summary || null,
    ...('coveredFurnishers' in metadata ? { covered_furnishers: metadata.coveredFurnishers || [] } : {}),
    ...('enclosureParseBlocked' in metadata ? { enclosure_parse_blocked: !!metadata.enclosureParseBlocked } : {}),
    ...('enclosureParseIssues' in metadata ? { enclosure_parse_issues: metadata.enclosureParseIssues || [] } : {}),
    ...('sourcePhase3LetterId' in metadata ? { source_phase3_letter_id: metadata.sourcePhase3LetterId || null } : {}),
    ...('sourceBureauResponseEvidenceId' in metadata
      ? { source_bureau_response_evidence_id: metadata.sourceBureauResponseEvidenceId || null }
      : {}),
    ...('disputeTemplateId' in metadata ? { dispute_template_id: metadata.disputeTemplateId || null } : {}),
    ...('disputeTemplateName' in metadata ? { dispute_template_name: metadata.disputeTemplateName || null } : {}),
    ...('disputeTemplateVersionLabel' in metadata ? { dispute_template_version_label: metadata.disputeTemplateVersionLabel || null } : {}),
    ...('disputeTemplateFamilyKey' in metadata ? { dispute_template_family_key: metadata.disputeTemplateFamilyKey || null } : {}),
    ...('disputeFlowCode' in metadata ? { dispute_flow_code: metadata.disputeFlowCode || null } : {}),
    ...('disputeRoundNumber' in metadata ? { dispute_round_number: metadata.disputeRoundNumber || null } : {}),
    ...('disputeBureauCode' in metadata ? { dispute_bureau_code: metadata.disputeBureauCode || null } : {}),
    ...('disputeTemplateSnapshot' in metadata ? { dispute_template_snapshot: metadata.disputeTemplateSnapshot || null } : {}),
    ...('disputeEditableSections' in metadata ? { dispute_editable_sections: metadata.disputeEditableSections || {} } : {}),
    ...('disputeAccountSnapshot' in metadata ? { dispute_account_snapshot: metadata.disputeAccountSnapshot || [] } : {}),
  });
  if (error) throw error;
  return id;
}

export async function updateLetter(id, patch) {
  const userId = await getUserId();
  const mapped = {};
  if ('mailedDate' in patch) mapped.mailed_date = patch.mailedDate;
  if ('responseOutcome' in patch) mapped.response_outcome = patch.responseOutcome;
  if ('responseDate' in patch) mapped.response_date = patch.responseDate;
  if ('lobId' in patch) mapped.lob_id = patch.lobId;
  if ('trackingNumber' in patch) mapped.tracking_number = patch.trackingNumber;
  if ('trackingStatus' in patch) mapped.tracking_status = patch.trackingStatus;
  if ('deliveredAt' in patch) mapped.delivered_at = patch.deliveredAt;
  if ('mailService' in patch) mapped.mail_service = patch.mailService;
  if ('expectedDeliveryDate' in patch) mapped.expected_delivery_date = patch.expectedDeliveryDate;
  if ('html' in patch) mapped.html = patch.html;
  if ('summary' in patch) mapped.summary = patch.summary;
  if ('phase2Analysis' in patch) mapped.phase2_analysis = patch.phase2Analysis;
  if ('phase2AnalyzedAt' in patch) mapped.phase2_analyzed_at = patch.phase2AnalyzedAt;
  if ('bureauReviewStatus' in patch) mapped.bureau_review_status = patch.bureauReviewStatus;
  if ('bureauNextAction' in patch) mapped.bureau_next_action = patch.bureauNextAction;
  if ('bureauReviewNotes' in patch) mapped.bureau_review_notes = patch.bureauReviewNotes;
  if ('bureauReviewedAt' in patch) mapped.bureau_reviewed_at = patch.bureauReviewedAt;
  if ('bureauResponseStatus' in patch) mapped.bureau_response_status = patch.bureauResponseStatus;
  if ('bureauResponseReceivedAt' in patch) mapped.bureau_response_received_at = patch.bureauResponseReceivedAt;
  if ('bureauResponseAnalyzedAt' in patch) mapped.bureau_response_analyzed_at = patch.bureauResponseAnalyzedAt;
  if ('coveredFurnishers' in patch) mapped.covered_furnishers = patch.coveredFurnishers || [];
  if ('enclosureParseBlocked' in patch) mapped.enclosure_parse_blocked = !!patch.enclosureParseBlocked;
  if ('enclosureParseIssues' in patch) mapped.enclosure_parse_issues = patch.enclosureParseIssues || [];
  if ('sourcePhase3LetterId' in patch) mapped.source_phase3_letter_id = patch.sourcePhase3LetterId || null;
  if ('sourceBureauResponseEvidenceId' in patch) {
    mapped.source_bureau_response_evidence_id = patch.sourceBureauResponseEvidenceId || null;
  }

  const { data, error } = await supabase
    .from('letters')
    .update(mapped)
    .eq('id', id)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteLetter(id) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('letters')
    .delete()
    .eq('id', id)
    .eq('user_id', userId);
  if (error) throw error;
  return true;
}

function normalizeAudit(a) {
  return {
    id: a.id,
    clientId: a.client_id || null,
    clientName: a.client_name,
    clientAddress: a.client_address,
    reportDate: a.report_date,
    savedAt: a.saved_at,
    createdBy: a.created_by,
    audit: a.audit,
    auditorName: a.auditor_name || null,
  };
}

function normalizeLetter(l) {
  return {
    id: l.id,
    clientId: l.client_id || null,
    clientName: l.client_name,
    userId: l.user_id || null,
    furnisher: l.furnisher,
    accountId: l.account_id,
    phase: l.phase,
    type: l.type,
    savedAt: l.saved_at,
    createdBy: l.created_by,
    date: l.date,
    html: l.html,
    summary: l.summary,
    coveredFurnishers: l.covered_furnishers || [],
    mailedDate: l.mailed_date,
    responseOutcome: l.response_outcome,
    notificationsSent: l.notifications_sent || [],
    responseDate: l.response_date,
    phase2Analysis: l.phase2_analysis || null,
    phase2AnalyzedAt: l.phase2_analyzed_at || null,
    bureauReviewStatus: l.bureau_review_status || 'not_reviewed',
    bureauNextAction: l.bureau_next_action || null,
    bureauReviewNotes: l.bureau_review_notes || null,
    bureauReviewedAt: l.bureau_reviewed_at || null,
    bureauResponseStatus: l.bureau_response_status || 'not_received',
    bureauResponseReceivedAt: l.bureau_response_received_at || null,
    bureauResponseAnalyzedAt: l.bureau_response_analyzed_at || null,
    lobId: l.lob_id,
    trackingNumber: l.tracking_number,
    trackingStatus: l.tracking_status,
    deliveredAt: l.delivered_at,
    mailService: l.mail_service || null,
    expectedDeliveryDate: l.expected_delivery_date || null,
    returnReceiptUrl: l.return_receipt_url,
    responseFileUrl: l.response_file_url,
    hasResponseFile: !!l.response_file_url || !!l.has_response_file,
    enclosureParseBlocked: l.enclosure_parse_blocked || false,
    enclosureParseIssues: l.enclosure_parse_issues || [],
    sourcePhase3LetterId: l.source_phase3_letter_id || null,
    sourceBureauResponseEvidenceId: l.source_bureau_response_evidence_id || null,
    disputeTemplateId: l.dispute_template_id || null,
    disputeTemplateName: l.dispute_template_name || null,
    disputeTemplateVersionLabel: l.dispute_template_version_label || null,
    disputeTemplateFamilyKey: l.dispute_template_family_key || null,
    disputeFlowCode: l.dispute_flow_code || null,
    disputeRoundNumber: l.dispute_round_number || null,
    disputeBureauCode: l.dispute_bureau_code || null,
    disputeTemplateSnapshot: l.dispute_template_snapshot || null,
    disputeEditableSections: l.dispute_editable_sections || {},
    disputeAccountSnapshot: l.dispute_account_snapshot || [],
    clientAccountId: l.client_account_id || null,
    auditorName: l.auditor_name || null,
  };
}

// Keep the list payload deliberately small. The CRM board needs lifecycle
// fields to render its existing filters, but it does not need audit JSON,
// letter HTML, model output, signatures, DOB, monitoring credentials, or a
// billing ledger for every client. The SQL function behind this query is
// cursor-paginated and joins activity by client_id. A narrowly checked,
// unique-name fallback keeps pre-migration records visible without ever
// merging duplicate names.
function normalizeClientSummary(row) {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    address: row.address || null,
    audits: (row.audits || []).map(normalizeAudit),
    letters: (row.letters || []).map(normalizeLetter),
    auditCount: Number(row.audit_count || 0),
    letterCount: Number(row.letter_count || 0),
    lastActivity: row.last_activity || '',
    isVip: !!row.is_vip,
    email: row.email || null,
    lpoaSigned: !!row.lpoa_signed,
    portalOnboarded: !!row.portal_onboarded,
    agreementSigned: !!row.agreement_signed,
    status: row.status || 'active',
    leadSource: row.lead_source || null,
    leadPhone: row.lead_phone || null,
    leadNotes: row.lead_notes || null,
    leadCreatedAt: row.lead_created_at || null,
    leadViewedAt: row.lead_viewed_at || null,
    tags: row.tags || [],
    billingStatus: row.billing_status || null,
    billingType: row.billing_type || null,
    billingStartDate: row.billing_start_date || null,
    billingTier: row.billing_tier || null,
    exitReason: row.exit_reason || null,
    statusChangedAt: row.status_changed_at || null,
  };
}

const CLIENT_DETAIL_COLUMNS = 'id,name,is_vip,user_id,email,lpoa_signed,lpoa_signed_at,lpoa_signature_data,sign_token,phone,date_of_birth,monitoring_service,monitoring_email,monitoring_enrolled,monitoring_portal_url,referral_source,notes,tags,enrollment_date,score_eq_start,score_exp_start,score_tu_start,address,monitoring_not_required,status,lead_source,lead_phone,lead_notes,lead_created_at,lead_viewed_at,billing_status,billing_type,billing_start_date,billing_tier,referred_by,referral_fee,commission_paid,ledger,exit_reason,status_changed_at';

function hydrateClientRecord(row, audits, letters, portal = null) {
  const latestActivity = [
    row.lead_created_at,
    row.status_changed_at,
    ...audits.map((a) => a.savedAt),
    ...letters.map((l) => l.savedAt),
  ].filter(Boolean).sort().slice(-1)[0] || '';

  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    // A manually corrected CRM address wins over an audit-derived address.
    address: row.address || audits.find((a) => a.clientAddress)?.clientAddress || null,
    audits,
    letters,
    lastActivity: latestActivity,
    isVip: !!row.is_vip,
    email: row.email || portal?.email || null,
    lpoaSigned: !!row.lpoa_signed,
    lpoaSignedAt: row.lpoa_signed_at || null,
    lpoaSignatureData: row.lpoa_signature_data || null,
    signToken: row.sign_token || null,
    phone: row.phone || null,
    dateOfBirth: row.date_of_birth || null,
    monitoringService: row.monitoring_service || 'Privacy Guard',
    monitoringEmail: row.monitoring_email || null,
    monitoringEnrolled: !!row.monitoring_enrolled,
    monitoringPortalUrl: row.monitoring_portal_url || 'https://www.privacyguard.com',
    monitoringNotRequired: !!row.monitoring_not_required,
    referralSource: row.referral_source || null,
    notes: row.notes || null,
    tags: row.tags || [],
    enrollmentDate: row.enrollment_date || null,
    scoreEqStart: row.score_eq_start || null,
    scoreExpStart: row.score_exp_start || null,
    scoreTuStart: row.score_tu_start || null,
    status: row.status || 'active',
    leadSource: row.lead_source || null,
    leadPhone: row.lead_phone || null,
    leadNotes: row.lead_notes || null,
    leadCreatedAt: row.lead_created_at || null,
    leadViewedAt: row.lead_viewed_at || null,
    billingStatus: row.billing_status || null,
    billingType: row.billing_type || null,
    billingStartDate: row.billing_start_date || null,
    billingTier: row.billing_tier || null,
    exitReason: row.exit_reason || null,
    statusChangedAt: row.status_changed_at || null,
    referredBy: row.referred_by || null,
    referralFee: row.referral_fee || null,
    commissionPaid: !!row.commission_paid,
    ledger: row.ledger || [],
    portalOnboarded: !!portal?.onboarding_complete,
    signatureData: portal?.signature_data || null,
    agreementSigned: !!portal?.agreement_signed_at,
  };
}

/**
 * Fetch one compact page for the Clients board. `nextCursor` is opaque to
 * callers; use it unchanged for the next page. The RPC is introduced in
 * 20260728_client_summary_rpc.sql and is intentionally RLS/ID keyed.
 */
export async function listClientSummaries({ limit = 50, cursor = null, search = null } = {}) {
  const pageSize = Math.max(1, Math.min(Number(limit) || 50, 100));
  const { data, error } = await supabase.rpc('list_client_summaries', {
    p_limit: pageSize + 1,
    p_cursor_activity: cursor?.lastActivity || null,
    p_cursor_id: cursor?.id || null,
    p_search: search?.trim() || null,
  });
  if (error) throw error;

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).map(normalizeClientSummary);
  const last = page[page.length - 1];
  return {
    clients: page,
    totalCount: Number(rows[0]?.total_count || 0),
    nextCursor: hasMore && last ? { lastActivity: last.lastActivity, id: last.id } : null,
  };
}

// Inbox opens LobMailer directly from a compact summary row. Fetch the one
// selected letter just-in-time so the all-client inbox never carries letter
// HTML, model output, or other heavyweight fields for every record.
export async function getLetterForMail(letterId) {
  if (!letterId) throw new Error('A letter id is required');
  const { data, error } = await supabase
    .from('letters')
    .select('*')
    .eq('id', letterId)
    .single();
  if (error) throw error;
  return normalizeLetter(data);
}

// A delivery-clock work queue for Letter Tracker. It is deliberately
// separate from the CRM summary feed: it returns only mailed, unresolved
// letters and uses a deadline cursor instead of loading every client record.
export async function listInFlightLetterRows({ limit = 200, cursor = null } = {}) {
  const pageSize = Math.max(1, Math.min(Number(limit) || 200, 500));
  const { data, error } = await supabase.rpc('list_in_flight_letters', {
    p_limit: pageSize + 1,
    p_cursor_deadline: cursor?.sortDeadline || null,
    p_cursor_id: cursor?.letterId || null,
  });
  if (error) throw error;

  const rows = data || [];
  const hasMore = rows.length > pageSize;
  const page = rows.slice(0, pageSize).map((row) => ({
    letterId: row.letter_id,
    clientId: row.client_id,
    clientName: row.client_name,
    furnisher: row.furnisher,
    accountId: row.account_id,
    clientAccountId: row.client_account_id,
    accountLast4: row.account_last4 || null,
    phase: row.phase,
    mailDate: row.mailed_date,
    deliveryDate: row.delivered_at || null,
    mailService: row.mail_service || null,
    expectedDeliveryDate: row.expected_delivery_date || null,
    scheduleBasis: row.schedule_basis || null,
    bureauReviewStatus: row.bureau_review_status || 'not_reviewed',
    deadline: row.deadline || null,
    sortDeadline: row.sort_deadline,
  }));
  const last = page[page.length - 1];
  return {
    rows: page,
    totalCount: Number(rows[0]?.total_count || 0),
    nextCursor: hasMore && last ? { sortDeadline: last.sortDeadline, letterId: last.letterId } : null,
  };
}

/**
 * Hydrate the selected client only. This is the one place the staff UI loads
 * full audit JSON, letter HTML/analysis, signatures, and ledger data.
 */
export async function getClientDetails(clientId) {
  if (!clientId) throw new Error('A client id is required');

  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select(CLIENT_DETAIL_COLUMNS)
    .eq('id', clientId)
    .single();
  if (clientError) throw clientError;

  const { count: sameNameCount, error: sameNameError } = await supabase
    .from('clients')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', client.user_id)
    .eq('name', client.name);
  if (sameNameError) throw sameNameError;
  const canUseLegacyNameFallback = sameNameCount === 1;

  const [auditsRes, lettersRes, portalRes, legacyAuditsRes, legacyLettersRes] = await Promise.all([
    supabase.from('audits').select('*').eq('user_id', client.user_id).eq('client_id', clientId).order('saved_at', { ascending: false }),
    supabase.from('letters').select('*').eq('user_id', client.user_id).eq('client_id', clientId).order('saved_at', { ascending: false }),
    supabase.from('client_profiles').select('full_name,email,signature_data,onboarding_complete,agreement_signed_at').eq('client_id', clientId).limit(1),
    canUseLegacyNameFallback
      ? supabase.from('audits').select('*').eq('user_id', client.user_id).is('client_id', null).eq('client_name', client.name).order('saved_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    canUseLegacyNameFallback
      ? supabase.from('letters').select('*').eq('user_id', client.user_id).is('client_id', null).eq('client_name', client.name).order('saved_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (auditsRes.error) throw auditsRes.error;
  if (lettersRes.error) throw lettersRes.error;
  if (portalRes.error) throw portalRes.error;
  if (legacyAuditsRes.error) throw legacyAuditsRes.error;
  if (legacyLettersRes.error) throw legacyLettersRes.error;

  const rawAudits = [...(auditsRes.data || []), ...(legacyAuditsRes.data || [])]
    .sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
  const rawLetters = [...(lettersRes.data || []), ...(legacyLettersRes.data || [])]
    .sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || ''));
  const authorIds = [...new Set([
    ...rawAudits.map((a) => a.created_by),
    ...rawLetters.map((l) => l.created_by),
  ].filter(Boolean))];
  let authorMap = new Map();
  if (authorIds.length > 0) {
    const { data: authors, error: authorsError } = await supabase
      .from('profiles')
      .select('id,full_name,email')
      .in('id', authorIds);
    if (authorsError) throw authorsError;
    authorMap = new Map((authors || []).map((author) => [author.id, author]));
  }

  const audits = rawAudits.map((audit) => {
    const author = authorMap.get(audit.created_by);
    return { ...normalizeAudit(audit), auditorName: author ? (author.full_name || author.email) : null };
  });
  const letters = rawLetters.map((letter) => {
    const author = authorMap.get(letter.created_by);
    return { ...normalizeLetter(letter), auditorName: author ? (author.full_name || author.email) : null };
  });

  return hydrateClientRecord(client, audits, letters, (portalRes.data || [])[0] || null);
}

// Navigation elsewhere in the app still carries a client name today. This is
// a temporary, explicit adapter: it resolves a name to an ID only when the
// name is unambiguous under the caller's RLS scope. It will never silently
// choose between two same-named clients.
export async function findClientIdByLegacyReference(reference) {
  const value = String(reference || '').trim();
  if (!value) return { id: null, ambiguous: false };
  const looksLikeUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const query = supabase.from('clients').select('id').limit(2);
  const { data, error } = looksLikeUuid
    ? await query.eq('id', value)
    : await query.eq('name', value);
  if (error) throw error;
  if ((data || []).length > 1) return { id: null, ambiguous: true };
  return { id: data?.[0]?.id || null, ambiguous: false };
}

// clientId is optional and preferred over clientName when present — see
// the client_id migration plan; clients.name has no unique constraint.
export async function deleteClient(clientName, clientId) {
  const userId = await getUserId();
  const [a, b, c] = await Promise.all([
    clientId
      ? supabase.from('audits').delete().eq('user_id', userId).eq('client_id', clientId)
      : supabase.from('audits').delete().eq('user_id', userId).eq('client_name', clientName),
    clientId
      ? supabase.from('letters').delete().eq('user_id', userId).eq('client_id', clientId)
      : supabase.from('letters').delete().eq('user_id', userId).eq('client_name', clientName),
    clientId
      ? supabase.from('clients').delete().eq('user_id', userId).eq('id', clientId)
      : supabase.from('clients').delete().eq('user_id', userId).eq('name', clientName),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  if (c.error) throw c.error;
}

export async function createLead({ name, email, phone, source, notes }) {
  const userId = await getUserId();
  const { error } = await supabase.from('clients').insert({
    user_id: userId,
    name: name.trim(),
    email: email ? email.trim().toLowerCase() : null,
    lead_phone: phone ? phone.trim() : null,
    lead_source: source || null,
    lead_notes: notes || null,
    status: 'lead',
    lead_created_at: new Date().toISOString(),
  });
  if (error) throw error;
}

// clientId is optional and preferred over clientName when present — see
// the client_id migration plan; clients.name has no unique constraint.
export async function runProgressDiff(clientName, clientId) {
  const userId = await getUserId();
  const auditsQuery = clientId
    ? supabase.from('audits').select('id,report_date,audit').eq('user_id', userId).eq('client_id', clientId).order('report_date', { ascending: false }).limit(2)
    : supabase.from('audits').select('id,report_date,audit').eq('user_id', userId).eq('client_name', clientName).order('report_date', { ascending: false }).limit(2);
  const { data: audits, error } = await auditsQuery;

  if (error) throw error;
  if (!audits || audits.length < 2) {
    throw new Error('Need at least two audits for this client to run a comparison.');
  }

  const [newer, older] = audits; // already ordered desc
  const diff = diffAuditAccounts(older.audit, newer.audit);

  // The report diff and the mail/response lifecycle are separate data sets.
  // Persist a safe joined snapshot here so the same status is visible to the
  // staff comparison modal and the client portal after every 35-day report.
  const lettersQuery = clientId
    ? supabase.from('letters').select('id,client_id,client_account_id,furnisher,account_id,phase,saved_at,date,mailed_date,delivered_at,response_outcome,response_date,phase2_analyzed_at,bureau_response_status,bureau_response_received_at,bureau_response_analyzed_at,bureau_review_status,bureau_reviewed_at').eq('user_id', userId).eq('client_id', clientId)
    : supabase.from('letters').select('id,client_id,client_account_id,furnisher,account_id,phase,saved_at,date,mailed_date,delivered_at,response_outcome,response_date,phase2_analyzed_at,bureau_response_status,bureau_response_received_at,bureau_response_analyzed_at,bureau_review_status,bureau_reviewed_at').eq('user_id', userId).eq('client_name', clientName);
  const { data: letterRows, error: lettersError } = await lettersQuery;
  if (lettersError) throw lettersError;
  const phase3Ids = (letterRows || [])
    .filter((letter) => String(letter.phase || '').startsWith('Phase 3'))
    .map((letter) => letter.id);
  let escalationRows = [];
  if (phase3Ids.length > 0) {
    const { data, error: escalationError } = await supabase
      .from('escalations')
      .select('phase3_letter_id,status,updated_at')
      .eq('user_id', userId)
      .in('phase3_letter_id', phase3Ids);
    if (escalationError) throw escalationError;
    escalationRows = data || [];
  }
  const phaseProgress = buildPhaseProgress(diff, letterRows || [], escalationRows);

  // id embeds clientId when known — same collision class as audits.id and
  // letters.id fixed in earlier phases.
  const id = clientId
    ? slug(clientName) + '__' + clientId + '__diff__' + older.report_date + '__' + newer.report_date
    : slug(clientName) + '__diff__' + older.report_date + '__' + newer.report_date;
  const { error: saveErr } = await supabase.from('progress_updates').upsert({
    id,
    user_id: userId,
    client_id: clientId || null,
    client_name: clientName,
    from_audit_id: older.id,
    to_audit_id: newer.id,
    from_report_date: older.report_date,
    to_report_date: newer.report_date,
    diff,
    phase_progress: phaseProgress,
  });
  if (saveErr) throw saveErr;

  // The client's own portal reads this same progress_updates row (Progress
  // tab) — without this, a staff-triggered "Compare Latest Reports" run
  // saves a diff with no narrative ever generated for it, and the client
  // sees the raw account-level diff with no plain-language summary,
  // indefinitely (this manual path was the only way into progress_updates
  // that never called this trigger).
  triggerProgressNarrative(clientName, clientId); // fire-and-forget — never blocks the comparison UI

  // newerAudit rides along so callers (the Report Comparison modal's
  // "Generate Letter" shortcut) can look up a diffed account's full record
  // — violations, batch, strategy, etc. — without a second fetch; already
  // in hand here since diffAuditAccounts() needed it above.
  const newerAudit = clientId ? { ...newer.audit, client: { ...newer.audit.client, id: clientId } } : newer.audit;
  return { id, fromReportDate: older.report_date, toReportDate: newer.report_date, diff, phaseProgress, newerAudit };
}

// clientId is optional and preferred over clientName when present — see
// the client_id migration plan; clients.name has no unique constraint.
export async function convertLeadToClient(clientName, clientId) {
  const userId = await getUserId();
  const patch = { status: 'active', enrollment_date: new Date().toISOString().slice(0, 10) };
  const { error } = clientId
    ? await supabase.from('clients').update(patch).eq('user_id', userId).eq('id', clientId)
    : await supabase.from('clients').update(patch).eq('user_id', userId).eq('name', clientName);
  if (error) throw error;
}

// Reverses convertLeadToClient — for a client who was converted before
// actually paying and then went dark. Only touches the same two fields
// convertLeadToClient set (plus a fresh lead_viewed_at/lead_created_at so
// they reappear as a new, unviewed lead in the pipeline) — existing audit,
// letter, and document history is left untouched in case they come back.
export async function revertClientToLead(clientName, clientId) {
  const userId = await getUserId();
  const patch = {
    status: 'lead',
    enrollment_date: null,
    lead_created_at: new Date().toISOString(),
    lead_viewed_at: null,
  };
  const { error } = clientId
    ? await supabase.from('clients').update(patch).eq('user_id', userId).eq('id', clientId)
    : await supabase.from('clients').update(patch).eq('user_id', userId).eq('name', clientName);
  if (error) throw error;
}

// clientId is optional — genuinely absent for a lead purely synthesized
// from orphan audits/letters with no clients row at all (see below), so
// this always has to tolerate falling back to clientName.
export async function deleteLead(clientName, clientId) {
  const userId = await getUserId();
  // A "lead" in the dashboard can be a clients row, or purely synthesized
  // from orphan audits/letters with no clients row at all (any client_name
  // with no matching clients row reads as a lead). Only
  // deleting from clients left those orphan-only leads undeletable — the
  // delete matched zero rows, threw no error, and the lead reappeared on
  // reload. Clear all three, same as deleteClient().
  const [a, b, c] = await Promise.all([
    clientId
      ? supabase.from('audits').delete().eq('user_id', userId).eq('client_id', clientId)
      : supabase.from('audits').delete().eq('user_id', userId).eq('client_name', clientName),
    clientId
      ? supabase.from('letters').delete().eq('user_id', userId).eq('client_id', clientId)
      : supabase.from('letters').delete().eq('user_id', userId).eq('client_name', clientName),
    clientId
      ? supabase.from('clients').delete().eq('user_id', userId).eq('id', clientId).eq('status', 'lead')
      : supabase.from('clients').delete().eq('user_id', userId).eq('name', clientName).eq('status', 'lead'),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
  if (c.error) throw c.error;
}

// Recurring rows (month=null) repeat every month automatically; variable
// rows are scoped to one 'YYYY-MM' and have to be re-entered each month.
export async function listExpenses() {
  const { data, error } = await supabase.from('business_expenses').select('*').order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((e) => ({
    id: e.id,
    name: e.name,
    amount: parseFloat(e.amount) || 0,
    category: e.category,
    month: e.month,
  }));
}

export async function addExpense({ name, amount, category, month = null }) {
  const userId = await getUserId();
  const { error } = await supabase.from('business_expenses').insert({ user_id: userId, name, amount, category, month });
  if (error) throw error;
}

export async function updateExpense(id, { amount }) {
  const userId = await getUserId();
  const { error } = await supabase.from('business_expenses').update({ amount }).eq('id', id).eq('user_id', userId);
  if (error) throw error;
}

export async function deleteExpense(id) {
  const { error } = await supabase.from('business_expenses').delete().eq('id', id);
  if (error) throw error;
}
