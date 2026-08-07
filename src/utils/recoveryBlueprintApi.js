import { supabase } from './supabase.js';

async function blueprintRequest(action, audit, extra = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Your staff session has expired. Please sign in again.');
  const res = await fetch('/.netlify/functions/recovery-blueprint', {
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
  if (!res.ok) throw new Error(data.error || `Recovery Blueprint request failed (${res.status}).`);
  return data;
}

export function getBlueprintStatus(audit) {
  return blueprintRequest('status', audit);
}

export function persistReviewedAccounts(audit, accounts) {
  return blueprintRequest('save_corrections', audit, {
    accounts: accounts.map(({ id, balance, status, accountNumberMasked, originalCreditor }) => ({
      id, balance, status, accountNumberMasked, originalCreditor,
    })),
  });
}

export function previewBlueprint(audit) {
  return blueprintRequest('preview', audit);
}

export function approveBlueprint(audit) {
  return blueprintRequest('approve', audit);
}

export function sendBlueprint(audit, details) {
  return blueprintRequest('send', audit, details);
}

export function base64ToPdfBytes(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function base64PdfUrl(base64) {
  return URL.createObjectURL(new Blob([base64ToPdfBytes(base64)], { type: 'application/pdf' }));
}

