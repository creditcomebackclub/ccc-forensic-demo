import { supabase } from "./supabase";
import { runAuditJob } from "./auditJobs.js";

export async function runAudit(file, onProgress, clientSelection) {
  return runAuditJob({ mode: 'combined', files: [{ file }], clientSelection }, onProgress);
}

export async function runTripleBureauAudit(files, onProgress, clientSelection) {
  return runAuditJob({
    mode: 'individual',
    files: [
      { file: files.equifax, bureau: 'Equifax' },
      { file: files.experian, bureau: 'Experian' },
      { file: files.transunion, bureau: 'TransUnion' },
    ],
    clientSelection,
  }, onProgress);
}

export async function runSingleBureauAudit(file, bureau, onProgress, clientSelection) {
  return runAuditJob({ mode: 'single', files: [{ file, bureau }], clientSelection }, onProgress);
}

export async function runMergeBureauAudits(clientSelection, onProgress) {
  return runAuditJob({ mode: 'merge', files: [], clientSelection }, onProgress);
}

export async function getReturnReceiptUrl(lobId) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');

  const res = await fetch('/.netlify/functions/get-return-receipt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ lobId })
  });
  
  if (res.status === 404) return null;
  if (!res.ok) {
    let msg = 'Failed to fetch return receipt';
    try { const body = await res.json(); msg = body.error || msg; } catch(e) {}
    throw new Error(msg);
  }
  
  const data = await res.json();
  return data.return_receipt_url;
}
