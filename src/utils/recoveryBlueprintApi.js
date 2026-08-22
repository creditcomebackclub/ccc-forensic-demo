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
      auditId: audit.id || audit.auditId || null,
      expectedAuditRevision: audit.auditRevision ?? audit.savedAt ?? null,
      expectedAuditSha256: audit.auditSha256 || null,
      clientId: audit.client?.id || null,
      clientName: audit.client?.name || null,
      reportDate: audit.client?.reportDate || audit.reportDate || null,
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
    accounts: accounts.map((account) => ({
      id: account.id,
      clientAccountId: account.clientAccountId || account.client_account_id || null,
      classificationAttested: account.classificationAttested === true,
      accountKind: account.accountKind,
      latePaymentCount: account.latePaymentCount,
      latePaymentBand: account.latePaymentBand,
      latePaymentByBureau: account.latePaymentByBureau || account.routingFacts?.bureauFacts || null,
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

export function deleteBlueprint(audit, artifactId) {
  return blueprintRequest('delete', audit, { artifactId });
}

export function base64ToPdfBytes(base64) {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

export function base64PdfUrl(base64) {
  return URL.createObjectURL(new Blob([base64ToPdfBytes(base64)], { type: 'application/pdf' }));
}
