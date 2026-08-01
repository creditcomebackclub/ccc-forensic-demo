import { fieldworkCloudEnabled, fieldworkSupabase } from './supabase';

async function authHeader() {
  if (!fieldworkSupabase) return null;
  const { data } = await fieldworkSupabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
}

export async function fieldworkSignUp({ email, password, name }) {
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const { data, error } = await fieldworkSupabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: name || '' } },
  });
  if (error) throw error;
  if (!data.session) {
    throw new Error('Account created but no session returned. Check email confirmation settings.');
  }
  return data;
}

export async function fieldworkSignIn({ email, password }) {
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const { data, error } = await fieldworkSupabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function fieldworkSignOut() {
  if (!fieldworkSupabase) return;
  await fieldworkSupabase.auth.signOut();
}

export async function fieldworkGetSession() {
  if (!fieldworkSupabase) return null;
  const { data } = await fieldworkSupabase.auth.getSession();
  return data.session || null;
}

async function fwFetch(path, options = {}) {
  const { timeoutMs = 8000, headers: optHeaders, ...fetchOpts } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(optHeaders || {}),
  };
  const auth = await authHeader();
  if (auth) Object.assign(headers, auth);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`/.netlify/functions/${path}`, {
      ...fetchOpts,
      headers,
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `Fieldwork API ${res.status}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  } catch (err) {
    if (err?.name === 'AbortError') {
      const timed = new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
      timed.name = 'AbortError';
      timed.status = 408;
      throw timed;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function getFieldworkStatus() {
  try {
    return await fwFetch('fieldwork-status');
  } catch {
    return {
      product: 'fieldwork',
      isolated: true,
      mode: 'demo',
      message: 'Status endpoint unreachable — running local demo mode.',
    };
  }
}

function planCredits(planId) {
  if (planId === 'starter') return 2;
  if (planId === 'unlimited') return 10;
  return 5;
}

/** Direct Supabase bootstrap when Netlify functions aren't running (plain `vite`). */
async function bootstrapFieldworkClient(profile = {}) {
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');

  const { data: authData, error: authErr } = await fieldworkSupabase.auth.getUser();
  if (authErr || !authData?.user) throw authErr || new Error('Not signed in');

  const user = authData.user;
  const planId = profile.plan_id || 'pro';

  const { data: existing, error: selErr } = await fieldworkSupabase
    .from('fieldwork_subscribers')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (selErr) throw selErr;

  let subscriber = existing;
  if (!subscriber) {
    const { data: created, error: insErr } = await fieldworkSupabase
      .from('fieldwork_subscribers')
      .insert({
        user_id: user.id,
        email: profile.email || user.email || '',
        full_name: profile.full_name || '',
        address_line1: profile.address_line1 || '',
        address_city: profile.address_city || '',
        address_state: profile.address_state || '',
        address_zip: profile.address_zip || '',
        plan_id: planId,
        mail_credits: planCredits(planId),
      })
      .select('*')
      .single();
    if (insErr) throw insErr;
    subscriber = created;
  } else if (profile.full_name || profile.plan_id || profile.address_line1) {
    const patch = { updated_at: new Date().toISOString() };
    if (profile.full_name != null) patch.full_name = profile.full_name;
    if (profile.email != null) patch.email = profile.email;
    if (profile.address_line1 != null) patch.address_line1 = profile.address_line1;
    if (profile.address_city != null) patch.address_city = profile.address_city;
    if (profile.address_state != null) patch.address_state = profile.address_state;
    if (profile.address_zip != null) patch.address_zip = profile.address_zip;
    if (profile.plan_id) {
      patch.plan_id = profile.plan_id;
      patch.mail_credits = planCredits(profile.plan_id);
    }
    const { data: updated, error: updErr } = await fieldworkSupabase
      .from('fieldwork_subscribers')
      .update(patch)
      .eq('id', subscriber.id)
      .select('*')
      .single();
    if (updErr) throw updErr;
    subscriber = updated;
  }

  const [{ data: campaigns }, { data: billing }, { data: documents }] = await Promise.all([
    fieldworkSupabase
      .from('fieldwork_campaigns')
      .select('*')
      .eq('subscriber_id', subscriber.id)
      .order('created_at', { ascending: false })
      .limit(20),
    fieldworkSupabase
      .from('fieldwork_billing_events')
      .select('*')
      .eq('subscriber_id', subscriber.id)
      .order('created_at', { ascending: false })
      .limit(20),
    fieldworkSupabase
      .from('fieldwork_documents')
      .select('*')
      .eq('subscriber_id', subscriber.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return {
    product: 'fieldwork',
    isolated: true,
    mode: 'client',
    subscriber,
    campaigns: campaigns || [],
    billing: billing || [],
    documents: documents || [],
  };
}

export async function bootstrapFieldwork(profile) {
  if (!fieldworkCloudEnabled) {
    return { mode: 'demo', isolated: true };
  }
  try {
    return await fwFetch('fieldwork-bootstrap', {
      method: 'POST',
      body: JSON.stringify(profile || {}),
      timeoutMs: 4000,
    });
  } catch (err) {
    // Plain `vite` has no Netlify functions — fall back to RLS client writes.
    if (err?.status === 404 || err?.name === 'AbortError' || /404|Failed to fetch|aborted/i.test(err?.message || '')) {
      return bootstrapFieldworkClient(profile || {});
    }
    throw err;
  }
}

export async function fieldworkCheckout(planId) {
  return fwFetch('fieldwork-checkout', {
    method: 'POST',
    body: JSON.stringify({
      plan_id: planId,
      success_url: `${window.location.origin}/diy.html#/app/billing?ok=1`,
      cancel_url: `${window.location.origin}/diy.html#/app/billing?cancelled=1`,
    }),
  });
}

/** Live forensic audit via FIELDWORK_ANTHROPIC (Fieldwork UI model). */
export async function runFieldworkAudit({ base64, mediaType, fileName, mode }) {
  return fwFetch('fieldwork-audit-run', {
    method: 'POST',
    // Full report audits routinely take 1–3 minutes.
    timeoutMs: 240000,
    body: JSON.stringify({
      base64,
      mediaType: mediaType || 'application/pdf',
      fileName: fileName || 'credit-report.pdf',
      mode: mode || 'combined',
    }),
  });
}

/** Fieldwork-styled letter from findings (engine when key set, local builder otherwise). */
export async function generateFieldworkLetter({ user, account, phaseId, tone }) {
  return fwFetch('fieldwork-generate-letter', {
    method: 'POST',
    timeoutMs: 120000,
    body: JSON.stringify({
      user,
      account,
      phaseId: phaseId || 'phase1',
      tone: tone || 'Standard',
    }),
  });
}

export { fieldworkCloudEnabled };
