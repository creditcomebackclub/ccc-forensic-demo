import { fieldworkCloudEnabled, fieldworkSupabase } from './supabase';

async function authHeader() {
  if (!fieldworkSupabase) return null;
  const { data } = await fieldworkSupabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return null;
  return { Authorization: `Bearer ${token}` };
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
      usesCccKeys: false,
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

export { fieldworkCloudEnabled };
