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
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  const auth = await authHeader();
  if (auth) Object.assign(headers, auth);

  const res = await fetch(`/.netlify/functions/${path}`, {
    ...options,
    headers,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Fieldwork API ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
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

export async function bootstrapFieldwork(profile) {
  if (!fieldworkCloudEnabled) {
    return { mode: 'demo', isolated: true };
  }
  return fwFetch('fieldwork-bootstrap', {
    method: 'POST',
    body: JSON.stringify(profile || {}),
  });
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
    body: JSON.stringify({
      user,
      account,
      phaseId: phaseId || 'phase1',
      tone: tone || 'Standard',
    }),
  });
}

export { fieldworkCloudEnabled };
