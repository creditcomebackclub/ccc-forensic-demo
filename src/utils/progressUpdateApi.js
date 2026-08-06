import { supabase } from './supabase.js';

async function progressRequest(action, audit, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your staff session has expired. Please sign in again.');
  const res = await fetch('/.netlify/functions/progress-update', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      action,
      clientId: audit.client?.id || null,
      clientName: audit.client?.name || null,
      reportDate: audit.client?.reportDate || null,
      ...extra,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Progress Update request failed (${res.status}).`);
  return data;
}

export function getProgressUpdateStatus(audit) {
  return progressRequest('status', audit);
}

export function saveProgressUpdate(audit, details) {
  return progressRequest('save', audit, details);
}

export function sendProgressUpdate(audit, details) {
  return progressRequest('send', audit, details);
}
