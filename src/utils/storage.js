import { supabase } from './supabase';

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

export async function saveAudit(audit) {
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

  return id;
}

export async function saveLetter(account, client, html) {
  const userId = await getUserId();
  const clientName = (client && client.name) || 'Unknown Client';
  const furnisher = (account && account.furnisher) || 'Unknown Furnisher';
  const accountId = (account && (account.id || account.accountNumberMasked)) || '';
  const date = todayISO();
  const id = slug(clientName) + '__' + slug(furnisher) + '__' + date;

  const { error } = await supabase.from('letters').upsert({
    id,
    user_id: userId,
    created_by: userId,
    client_name: clientName,
    furnisher,
    account_id: accountId,
    phase: 'Phase 1',
    type: (account && account.type) || null,
    saved_at: new Date().toISOString(),
    date,
    html,
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

function normalizeAudit(a) {
  return {
    id: a.id,
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
    clientName: l.client_name,
    furnisher: l.furnisher,
    accountId: l.account_id,
    phase: l.phase,
    type: l.type,
    savedAt: l.saved_at,
    createdBy: l.created_by,
    date: l.date,
    html: l.html,
    mailedDate: l.mailed_date,
    responseOutcome: l.response_outcome,
    notificationsSent: l.notifications_sent || [],
    responseDate: l.response_date,
    lobId: l.lob_id,
    trackingNumber: l.tracking_number,
    trackingStatus: l.tracking_status,
    deliveredAt: l.delivered_at,
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
    supabase.from('clients').select('name,is_vip,user_id,email,lpoa_signed,lpoa_signed_at,lpoa_signature_data,phone,date_of_birth,ssn_last4,monitoring_service,monitoring_email,monitoring_enrolled,monitoring_portal_url,referral_source,notes,tags,enrollment_date,score_eq_start,score_exp_start,score_tu_start,monitoring_password'),
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
      c.email = meta.email || null;
      c.lpoaSigned = meta.lpoa_signed || false;
      c.lpoaSignedAt = meta.lpoa_signed_at || null;
      c.phone = meta.phone || null;
      c.dateOfBirth = meta.date_of_birth || null;
      c.ssnLast4 = meta.ssn_last4 || null;
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
      c.monitoringPassword = meta.monitoring_password || null;
    }
  });
  return out;
}

export async function deleteClient(clientName) {
  const userId = await getUserId();
  const [a, b] = await Promise.all([
    supabase.from('audits').delete().eq('user_id', userId).eq('client_name', clientName),
    supabase.from('letters').delete().eq('user_id', userId).eq('client_name', clientName),
    supabase.from('clients').delete().eq('user_id', userId).eq('name', clientName),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}
