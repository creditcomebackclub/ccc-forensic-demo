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
    const rawText = await res.text();
    let body = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { error: rawText?.slice(0, 280) || `Fieldwork API ${res.status}` };
    }
    if (!res.ok) {
      const detail = body.error || body.message || body.msg;
      const err = new Error(detail || `Fieldwork API ${res.status}`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Poll fieldwork_audit_jobs until done/error (background Anthropic pass). */
async function pollFieldworkAuditJob(jobId, { timeoutMs = 240000 } = {}) {
  if (!fieldworkSupabase) throw new Error('Fieldwork Supabase is not configured');
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data, error } = await fieldworkSupabase
      .from('fieldwork_audit_jobs')
      .select('id,status,progress,error,result_json')
      .eq('id', jobId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Audit job not found');
    if (data.status === 'done' && data.result_json) {
      return { audit: data.result_json, mode: 'engine', jobId };
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'Audit failed');
    }
    await sleep(2000);
  }
  throw new Error('Audit timed out — check the netlify terminal for fieldwork-audit-run-background');
}

// Same-origin Vite proxy → scripts/fieldwork-audit-local.mjs (see vite.config.js).
// Avoids Safari/CORS issues with direct 127.0.0.1 calls and netlify's 30s cap.
const LOCAL_AUDIT_URL = import.meta.env.VITE_FIELDWORK_AUDIT_URL || '/fieldwork-local-audit';
const LOCAL_HEALTH_URL = import.meta.env.VITE_FIELDWORK_AUDIT_HEALTH_URL || '/fieldwork-local-health';

function abortAfter(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/** Local audit via Vite proxy → :8787 (no lambda-local 30s cap). */
async function runLocalAuditServer(payload) {
  const healthCtl = abortAfter(2000);
  try {
    const health = await fetch(LOCAL_HEALTH_URL, { signal: healthCtl.signal });
    if (!health.ok) {
      throw new Error(`Local audit health check failed (${health.status})`);
    }
  } catch (err) {
    throw new Error(
      'Local audit server not running. In a second terminal: npm run audit:fieldwork',
    );
  } finally {
    healthCtl.clear();
  }

  console.info('[fieldwork] using local audit server', LOCAL_AUDIT_URL);
  const runCtl = abortAfter(300000);
  try {
    const res = await fetch(LOCAL_AUDIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: runCtl.signal,
    });
    const rawText = await res.text();
    let body = {};
    try {
      body = rawText ? JSON.parse(rawText) : {};
    } catch {
      body = { error: rawText?.slice(0, 280) || `Local audit ${res.status}` };
    }
    if (!res.ok) throw new Error(body.error || `Local audit failed (${res.status})`);
    return body;
  } finally {
    runCtl.clear();
  }
}

/** Live forensic audit via FIELDWORK_ANTHROPIC (Fieldwork UI model). */
export async function runFieldworkAudit({ base64, mediaType, fileName, mode, subscriberId }) {
  if (!base64) throw new Error('base64 report required');
  if (base64.length > 12_000_000) throw new Error('Report too large for Fieldwork audit pass');

  const payload = {
    base64,
    mediaType: mediaType || 'application/pdf',
    fileName: fileName || 'credit-report.pdf',
    mode: mode || 'combined',
    subscriberId: subscriberId || undefined,
  };

  // Dev: NEVER use netlify functions for the heavy Anthropic pass (30s hard cap).
  if (import.meta.env.DEV) {
    return runLocalAuditServer(payload);
  }

  // Production: enqueue + background worker + poll.
  const queued = await fwFetch('fieldwork-audit-run', {
    method: 'POST',
    timeoutMs: 300000,
    body: JSON.stringify(payload),
  });

  if (queued?.audit) return queued;
  if (!queued?.jobId) {
    throw new Error(queued?.error || 'Audit did not return a job id');
  }

  const auth = await authHeader();
  await fetch('/.netlify/functions/fieldwork-audit-run-background', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth || {}),
    },
    body: JSON.stringify({
      jobId: queued.jobId,
      base64,
      mediaType: payload.mediaType,
      fileName: payload.fileName,
      mode: payload.mode,
    }),
  }).catch(() => {
    /* 202 / network race — polling will surface real failures */
  });

  return pollFieldworkAuditJob(queued.jobId);
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
