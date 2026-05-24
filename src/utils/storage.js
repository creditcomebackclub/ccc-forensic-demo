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

export async function saveAudit(audit) {
  const userId = await getUserId();
  const clientName = (audit && audit.client && audit.client.name) || 'Unknown Client';
  const clientAddress = (audit && audit.client && audit.client.address) || null;
  const reportDate = (audit && audit.client && audit.client.reportDate) || todayISO();
  const id = slug(clientName) + '__' + reportDate;

  const { error } = await supabase.from('audits').upsert({
    id,
    user_id: userId,
    client_name: clientName,
    client_address: clientAddress,
    report_date: reportDate,
    saved_at: new Date().toISOString(),
    audit,
  });
  if (error) throw error;
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

export async function listClients() {
  const userId = await getUserId();

  const [auditsRes, lettersRes] = await Promise.all([
    supabase.from('audits').select('*').eq('user_id', userId).order('saved_at', { ascending: false }),
    supabase.from('letters').select('*').eq('user_id', userId).order('saved_at', { ascending: false }),
  ]);

  if (auditsRes.error) throw auditsRes.error;
  if (lettersRes.error) throw lettersRes.error;

  const audits = auditsRes.data || [];
  const letters = lettersRes.data || [];

  const map = new Map();
  const ensure = (name) => {
    if (!map.has(name)) {
      map.set(name, { name, address: null, audits: [], letters: [], lastActivity: '' });
    }
    return map.get(name);
  };

  for (const a of audits) {
    const c = ensure(a.client_name);
    c.address = c.address || a.client_address;
    c.audits.push({
      id: a.id,
      clientName: a.client_name,
      clientAddress: a.client_address,
      reportDate: a.report_date,
      savedAt: a.saved_at,
      audit: a.audit,
    });
    if (a.saved_at > c.lastActivity) c.lastActivity = a.saved_at;
  }

  for (const l of letters) {
    const c = ensure(l.client_name);
    c.letters.push({
      id: l.id,
      clientName: l.client_name,
      furnisher: l.furnisher,
      accountId: l.account_id,
      phase: l.phase,
      type: l.type,
      savedAt: l.saved_at,
      date: l.date,
      html: l.html,
      mailedDate: l.mailed_date,
      responseOutcome: l.response_outcome,
      responseDate: l.response_date,
    });
    if (l.saved_at > c.lastActivity) c.lastActivity = l.saved_at;
  }

  const out = Array.from(map.values());
  out.sort((x, y) => (y.lastActivity || '').localeCompare(x.lastActivity || ''));
  return out;
}

export async function deleteClient(clientName) {
  const userId = await getUserId();
  const [a, b] = await Promise.all([
    supabase.from('audits').delete().eq('user_id', userId).eq('client_name', clientName),
    supabase.from('letters').delete().eq('user_id', userId).eq('client_name', clientName),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
}
