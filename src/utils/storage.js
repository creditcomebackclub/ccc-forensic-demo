import { supabase } from './supabase';
import { diffAuditAccounts, normalizeFurnisher } from './diffEngine';

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

export async function getProfile() {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return data;
}

export async function updateClientProfile(clientName, fields) {
  const userId = await getUserId();
  const { error } = await supabase.from('clients').upsert({
    user_id: userId,
    name: clientName,
    ...fields,
  }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function updateClientEmail(clientName, email) {
  const userId = await getUserId();
  const { error } = await supabase.from('clients').upsert({
    user_id: userId, name: clientName, email,
  }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function updateLeadInfo(clientName, { email, phone, source, notes }) {
  const userId = await getUserId();
  const patch = { user_id: userId, name: clientName };
  if (email !== undefined) patch.email = email || null;
  if (phone !== undefined) patch.lead_phone = phone || null;
  if (source !== undefined) patch.lead_source = source || null;
  if (notes !== undefined) patch.lead_notes = notes || null;
  const { error } = await supabase.from('clients').upsert(patch, { onConflict: 'user_id,name' });
  if (error) throw error;
}

// Lead pipeline stage lives in the tags array as 'lead-stage:<stage>' —
// no schema change needed; other tags are preserved
export async function updateLeadStage(clientName, stage, existingTags) {
  const userId = await getUserId();
  const tags = (existingTags || []).map(String).filter((t) => !t.startsWith('lead-stage:'));
  if (stage) tags.push('lead-stage:' + stage);
  const { error } = await supabase.from('clients').upsert({
    user_id: userId,
    name: clientName,
    tags,
  }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

// Clears the sidebar's "new leads" badge for this one lead — stamped the
// moment staff open its card, not on any timer, so the badge behaves like a
// real notification instead of decaying on a 48h clock.
export async function markLeadViewed(clientName) {
  const userId = await getUserId();
  const { error } = await supabase.from('clients').upsert({
    user_id: userId,
    name: clientName,
    lead_viewed_at: new Date().toISOString(),
  }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

export async function toggleVip(clientName, isVip) {
  const userId = await getUserId();
  const { error } = await supabase.from('clients').upsert({
    user_id: userId,
    name: clientName,
    is_vip: isVip,
  }, { onConflict: 'user_id,name' });
  if (error) throw error;
}

async function getClientMeta(userId) {
  const { data } = await supabase
    .from('clients')
    .select('name,is_vip')
    .eq('user_id', userId);
  const map = new Map();
  for (const c of (data || [])) map.set(c.name, c);
  return map;
}

// Fire-and-forget: kicks the server-side progress-narrative background
// function (Retention Build 1b) when a client has picked up their 2nd+
// audit. Never awaited by saveAudit() and never throws outward — a failure
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
    // fetch is not awaited by the caller (saveAudit doesn't await this
    // function's promise), so the audit save never waits on the network
    // round trip, let alone the narrative generation itself.
    await fetch('/.netlify/functions/progress-narrative-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ clientName, clientId: clientId || null }),
    });
  } catch (e) {
    console.warn('Could not trigger progress narrative:', e);
  }
}

// Reusable, compounding furnisher-address book — see
// supabase/migrations/20260726_furnisher_addresses.sql for why this exists.
export async function listFurnisherAddresses() {
  const userId = await getUserId();
  const { data, error } = await supabase.from('furnisher_addresses').select('*').eq('user_id', userId);
  if (error) throw error;
  return (data || []).map((r) => ({
    id: r.id,
    furnisherKey: r.furnisher_key,
    displayName: r.display_name,
    address: {
      name: r.display_name,
      line1: r.address_line1,
      line2: r.address_line2 || '',
      city: r.city,
      state: r.state,
      zip: r.zip,
    },
  }));
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

export async function saveAudit(audit) {
  // Auto-populate starting scores if not already set
  try {
    const userId = await getUserId();
    const clientName = audit.client && audit.client.name;
    const scores = audit.scores || (audit.client && audit.client.scores);
    if (clientName && scores) {
      const { data: existing } = await supabase.from('clients')
        .select('score_eq_start,score_exp_start,score_tu_start')
        .eq('name', clientName)
        .eq('user_id', userId)
        .limit(1);
      const hasScores = existing && existing.length > 0 && (existing[0].score_eq_start || existing[0].score_exp_start || existing[0].score_tu_start);
      if (!hasScores) {
        const eq = scores.equifax || scores.eq || null;
        const exp = scores.experian || scores.exp || null;
        const tu = scores.transunion || scores.tu || null;
        if (eq || exp || tu) {
          const isNewRow = !existing || existing.length === 0;
          await supabase.from('clients').upsert({
            user_id: userId,
            name: clientName,
            score_eq_start: eq ? parseInt(eq) : null,
            score_exp_start: exp ? parseInt(exp) : null,
            score_tu_start: tu ? parseInt(tu) : null,
            ...(isNewRow ? { status: 'lead' } : {}),
          }, { onConflict: 'user_id,name' });
        }
      }
    }
  } catch(e) { console.warn('Could not auto-populate scores:', e); }

  // Fill in any account the audit-generation LLM left PENDING using
  // addresses staff have already confirmed for other clients — this is
  // what actually makes a confirmation reusable instead of one-off.
  try {
    if (Array.isArray(audit.accounts) && audit.accounts.some((a) => a.addressStatus === 'PENDING')) {
      const known = await listFurnisherAddresses();
      const byKey = new Map(known.map((k) => [k.furnisherKey, k]));
      for (const acct of audit.accounts) {
        if (acct.addressStatus !== 'PENDING') continue;
        const match = byKey.get(normalizeFurnisher(acct.furnisher));
        if (match) {
          acct.furnisherAddress = [match.address.line1, match.address.line2, match.address.city + ', ' + match.address.state + ' ' + match.address.zip].filter(Boolean).join(', ');
          acct.addressStatus = 'YES';
        }
      }
    }
  } catch (e) { console.warn('Could not backfill furnisher addresses:', e); }

  const userId = await getUserId();
  const clientName = (audit && audit.client && audit.client.name) || 'Unknown Client';
  const clientAddress = (audit && audit.client && audit.client.address) || null;
  const reportDate = (audit && audit.client && audit.client.reportDate) || todayISO();
  const id = slug(clientName) + '__' + reportDate;

  const { error } = await supabase.from('audits').upsert({
    id,
    user_id: userId,
    created_by: userId,
    client_name: clientName,
    client_address: clientAddress,
    report_date: reportDate,
    saved_at: new Date().toISOString(),
    audit,
  });
  if (error) throw error;

  await supabase.from('clients').upsert({
    user_id: userId,
    name: clientName,
    address: clientAddress,
  }, { onConflict: 'user_id,name', ignoreDuplicates: true });

  triggerProgressNarrative(clientName); // fire-and-forget — never blocks the save

  return id;
}

export async function saveLetter(account, client, html, summary, phase, idSuffix) {
  const userId = await getUserId();
  const clientName = (client && client.name) || 'Unknown Client';
  const furnisher = (account && account.furnisher) || 'Unknown Furnisher';
  const accountId = (account && (account.id || account.accountNumberMasked)) || '';
  const date = todayISO();
  const acctSuffix = accountId ? '__' + slug(String(accountId)) : '';
  const id = slug(clientName) + '__' + slug(furnisher) + acctSuffix + '__' + date + (idSuffix || '');

  const { error } = await supabase.from('letters').upsert({
    id,
    user_id: userId,
    created_by: userId,
    client_id: (client && client.id) || null,
    client_name: clientName,
    furnisher,
    account_id: accountId,
    // Persistent tradeline UUID (client_accounts) injected into the audit
    // account at ingest — stable across audit re-runs, unlike account_id
    // (positional). Phase 3 bureau gating resolves through this.
    client_account_id: (account && account.clientAccountId) || null,
    phase: phase || 'Phase 1',
    type: (account && account.type) || null,
    saved_at: new Date().toISOString(),
    date,
    html,
    summary: summary || null,
    mailed_date: null,
    response_outcome: null,
    response_date: null,
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
  if ('html' in patch) mapped.html = patch.html;
  if ('summary' in patch) mapped.summary = patch.summary;
  if ('phase2Analysis' in patch) mapped.phase2_analysis = patch.phase2Analysis;
  if ('phase2AnalyzedAt' in patch) mapped.phase2_analyzed_at = patch.phase2AnalyzedAt;

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
  };
}

function normalizeLetter(l) {
  return {
    id: l.id,
    clientId: l.client_id || null,
    clientName: l.client_name,
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
    lobId: l.lob_id,
    trackingNumber: l.tracking_number,
    trackingStatus: l.tracking_status,
    deliveredAt: l.delivered_at,
    returnReceiptUrl: l.return_receipt_url,
    responseFileUrl: l.response_file_url,
    enclosureParseBlocked: l.enclosure_parse_blocked || false,
    enclosureParseIssues: l.enclosure_parse_issues || [],
    clientAccountId: l.client_account_id || null,
  };
}

function buildClientMap(audits, letters, profiles) {
  const profileMap = new Map((profiles || []).map((p) => [p.id, p]));
  const map = new Map();
  const ensure = (name) => {
    if (!map.has(name)) {
      map.set(name, { name, address: null, audits: [], letters: [], lastActivity: '', isVip: false });
    }
    return map.get(name);
  };

  for (const a of audits) {
    const c = ensure(a.clientName);
    c.address = c.address || a.clientAddress;
    const profile = profileMap.get(a.createdBy);
    c.audits.push({ ...a, auditorName: profile ? (profile.full_name || profile.email) : null });
    if (a.savedAt > c.lastActivity) c.lastActivity = a.savedAt;
  }

  for (const l of letters) {
    const c = ensure(l.clientName);
    const profile = profileMap.get(l.createdBy);
    c.letters.push({ ...l, auditorName: profile ? (profile.full_name || profile.email) : null });
    if (l.savedAt > c.lastActivity) c.lastActivity = l.savedAt;
  }

  const out = Array.from(map.values());
  out.sort((x, y) => (y.lastActivity || '').localeCompare(x.lastActivity || ''));
  return out;
}

export async function listClients() {
  const userId = await getUserId();
  const [auditsRes, lettersRes, metaMap] = await Promise.all([
    supabase.from('audits').select('*').eq('user_id', userId).order('saved_at', { ascending: false }),
    supabase.from('letters').select('*').eq('user_id', userId).order('saved_at', { ascending: false }),
    getClientMeta(userId),
  ]);
  if (auditsRes.error) throw auditsRes.error;
  if (lettersRes.error) throw lettersRes.error;

  const out = buildClientMap(
    (auditsRes.data || []).map(normalizeAudit),
    (lettersRes.data || []).map(normalizeLetter),
    []
  );
  out.forEach((c) => { const meta = metaMap.get(c.name); c.isVip = meta ? !!meta.is_vip : false; });
  return out;
}

export async function adminListClients() {
  const userId = await getUserId();
  const [auditsRes, lettersRes, profilesRes, metaRes, portalRes] = await Promise.all([
    supabase.from('audits').select('*').order('saved_at', { ascending: false }),
    supabase.from('letters').select('*').order('saved_at', { ascending: false }),
    supabase.from('profiles').select('*'),
    // ssn_last4 / monitoring_password are intentionally excluded — they're
    // encrypted at rest in client_sensitive_data and only ever fetched
    // on-demand (decrypted server-side) via ClientProfilePanel, never as
    // part of this bulk dashboard load.
    supabase.from('clients').select('id,name,is_vip,user_id,email,lpoa_signed,lpoa_signed_at,lpoa_signature_data,sign_token,phone,date_of_birth,monitoring_service,monitoring_email,monitoring_enrolled,monitoring_portal_url,referral_source,notes,tags,enrollment_date,score_eq_start,score_exp_start,score_tu_start,address,monitoring_not_required,status,lead_source,lead_phone,lead_notes,lead_created_at,lead_viewed_at,billing_status,billing_type,billing_start_date,billing_tier,referred_by,referral_fee,commission_paid,ledger,exit_reason,status_changed_at'),
    supabase.from('client_profiles').select('full_name,email,signature_data,onboarding_complete,agreement_signed_at'),
  ]);
  if (auditsRes.error) throw auditsRes.error;
  if (lettersRes.error) throw lettersRes.error;
  if (profilesRes.error) throw profilesRes.error;

  const out = buildClientMap(
    (auditsRes.data || []).map(normalizeAudit),
    (lettersRes.data || []).map(normalizeLetter),
    profilesRes.data || []
  );

  const vipSet = new Set((metaRes.data || []).filter((c) => c.is_vip).map((c) => c.name));
  const metaMap2 = new Map((metaRes.data || []).map((c) => [c.name, c]));
  const portalMap = new Map((portalRes.data || []).map((p) => [p.full_name, p]));
  out.forEach((c) => {
    c.isVip = vipSet.has(c.name);
    // Auto-populate from client_profiles if clients table is missing data
    const portal = portalMap.get(c.name);
    if (portal) {
      if (!c.email && portal.email) c.email = portal.email;
      c.portalOnboarded = portal.onboarding_complete || false;
      c.signatureData = portal.signature_data || null;
      c.agreementSigned = !!portal.agreement_signed_at;
    }
    const meta = metaMap2.get(c.name);
    if (meta) {
      c.id = meta.id;
      c.email = meta.email || null;
      c.lpoaSigned = meta.lpoa_signed || false;
      c.lpoaSignedAt = meta.lpoa_signed_at || null;
      c.lpoaSignatureData = meta.lpoa_signature_data || null;
      c.signToken = meta.sign_token || null;
      c.phone = meta.phone || null;
      c.dateOfBirth = meta.date_of_birth || null;
      c.monitoringService = meta.monitoring_service || 'Privacy Guard';
      c.monitoringEmail = meta.monitoring_email || null;
      c.monitoringEnrolled = meta.monitoring_enrolled || false;
      c.monitoringPortalUrl = meta.monitoring_portal_url || 'https://www.privacyguard.com';
      c.referralSource = meta.referral_source || null;
      c.notes = meta.notes || null;
      c.tags = meta.tags || [];
      c.enrollmentDate = meta.enrollment_date || null;
      c.scoreEqStart = meta.score_eq_start || null;
      c.scoreExpStart = meta.score_exp_start || null;
      c.scoreTuStart = meta.score_tu_start || null;
      c.monitoringNotRequired = meta.monitoring_not_required || false;
      c.status = meta.status || 'active';
      c.leadSource = meta.lead_source || null;
      c.leadPhone = meta.lead_phone || null;
      c.leadNotes = meta.lead_notes || null;
      c.leadCreatedAt = meta.lead_created_at || null;
      c.leadViewedAt = meta.lead_viewed_at || null;
      c.billingStatus = meta.billing_status || null;
      c.billingType = meta.billing_type || null;
      c.billingStartDate = meta.billing_start_date || null;
      c.billingTier = meta.billing_tier || null;
      c.exitReason = meta.exit_reason || null;
      c.statusChangedAt = meta.status_changed_at || null;
      c.referredBy = meta.referred_by || null;
      c.referralFee = meta.referral_fee || null;
      c.commissionPaid = meta.commission_paid || false;
      c.ledger = meta.ledger || [];
    } else {
      c.status = 'lead';
    }
  });

  // Leads (and any client rows) that have no audits/letters yet won't exist in `out` —
  // buildClientMap only creates entries from audit/letter rows. Add them here.
  const existingNames = new Set(out.map((c) => c.name));
  for (const row of (metaRes.data || [])) {
    if (existingNames.has(row.name)) continue;
    out.push({
      id: row.id,
      name: row.name,
      address: row.address || null,
      audits: [],
      letters: [],
      lastActivity: row.lead_created_at || '',
      isVip: !!row.is_vip,
      email: row.email || null,
      phone: row.phone || null,
      status: row.status || 'active',
      leadSource: row.lead_source || null,
      leadPhone: row.lead_phone || null,
      leadNotes: row.lead_notes || null,
      leadCreatedAt: row.lead_created_at || null,
      leadViewedAt: row.lead_viewed_at || null,
      referralSource: row.referral_source || null,
      billingStatus: row.billing_status || null,
      billingType: row.billing_type || null,
      billingStartDate: row.billing_start_date || null,
      billingTier: row.billing_tier || null,
      exitReason: row.exit_reason || null,
      statusChangedAt: row.status_changed_at || null,
      referredBy: row.referred_by || null,
      referralFee: row.referral_fee || null,
      commissionPaid: row.commission_paid || false,
      ledger: row.ledger || [],
      notes: row.notes || null,
      tags: row.tags || [],
    });
  }
  return out;
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
  return { id, fromReportDate: older.report_date, toReportDate: newer.report_date, diff, newerAudit };
}

export async function getProgressUpdates(clientName) {
  const userId = await getUserId();
  const { data, error } = await supabase
    .from('progress_updates')
    .select('*')
    .eq('user_id', userId)
    .eq('client_name', clientName)
    .order('to_report_date', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function convertLeadToClient(clientName) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('clients')
    .update({ status: 'active', enrollment_date: new Date().toISOString().slice(0, 10) })
    .eq('user_id', userId)
    .eq('name', clientName);
  if (error) throw error;
}

// Reverses convertLeadToClient — for a client who was converted before
// actually paying and then went dark. Only touches the same two fields
// convertLeadToClient set (plus a fresh lead_viewed_at/lead_created_at so
// they reappear as a new, unviewed lead in the pipeline) — existing audit,
// letter, and document history is left untouched in case they come back.
export async function revertClientToLead(clientName) {
  const userId = await getUserId();
  const { error } = await supabase
    .from('clients')
    .update({
      status: 'lead',
      enrollment_date: null,
      lead_created_at: new Date().toISOString(),
      lead_viewed_at: null,
    })
    .eq('user_id', userId)
    .eq('name', clientName);
  if (error) throw error;
}

// clientId is optional — genuinely absent for a lead purely synthesized
// from orphan audits/letters with no clients row at all (see below), so
// this always has to tolerate falling back to clientName.
export async function deleteLead(clientName, clientId) {
  const userId = await getUserId();
  // A "lead" in the dashboard can be a clients row, or purely synthesized
  // from orphan audits/letters with no clients row at all (buildClientMap
  // treats any client_name with no matching clients row as a lead). Only
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

export async function deleteExpense(id) {
  const { error } = await supabase.from('business_expenses').delete().eq('id', id);
  if (error) throw error;
}
