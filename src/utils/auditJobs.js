// Client half of the server-side audit pipeline: upload report files, create
// an audit_jobs row, kick the background function, then poll the row for
// progress ({stage, pct, tokens} — same shape AuditProgress always used)
// until the job lands on done/error.
import { supabase } from './supabase';
import { MAX_REPORT_CHARS, htmlToText } from './reportText.js';

const POLL_MS = 2000;
const QUEUE_STALL_MS = 2 * 60 * 1000;  // never picked up by the function
const RUN_STALL_MS = 4 * 60 * 1000;    // running but no row updates
const MAX_READ_FAILURES = 15;          // consecutive poll read errors

// Fast local pre-check so an oversized HTML/text report fails in ~1s with the
// same visible message, before any upload. The server enforces it again.
async function preflightSize(file) {
  const type = file.type || '';
  if (!type.includes('html') && !type.includes('text')) return;
  let text = await file.text();
  if (type.includes('html')) text = htmlToText(text);
  if (text.length > MAX_REPORT_CHARS) {
    throw new Error(
      'This report is still ' + Math.round(text.length / 1000) + 'k characters of text after cleanup — too large to audit in one pass (limit '
      + Math.round(MAX_REPORT_CHARS / 1000) + 'k). Split it into per-bureau files and use Individual mode, or export a smaller report.'
    );
  }
}

export async function runAuditJob({ mode, files }, onProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  for (const f of files) await preflightSize(f.file);

  const jobId = crypto.randomUUID();
  onProgress && onProgress({ stage: 'Uploading report' + (files.length > 1 ? 's' : ''), pct: null, tokens: 0 });

  const fileMeta = [];
  for (const f of files) {
    const safeName = ((f.bureau || 'report').toLowerCase() + '-' + f.file.name).replace(/[^a-zA-Z0-9._-]+/g, '_');
    const path = user.id + '/audit-jobs/' + jobId + '/' + safeName;
    const { error } = await supabase.storage.from('documents').upload(path, f.file, { upsert: true });
    if (error) throw new Error('Could not upload report: ' + error.message);
    fileMeta.push({ path, type: f.file.type || '', bureau: f.bureau || null });
  }

  const { error: insErr } = await supabase.from('audit_jobs').insert({
    id: jobId, user_id: user.id, mode, files: fileMeta,
  });
  if (insErr) throw new Error('Could not create audit job: ' + insErr.message);

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/audit-run-background', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify({ jobId }),
  });
  // Netlify background functions ACK with 202 and run detached
  if (res.status >= 400) {
    throw new Error('Could not start the audit on the server (HTTP ' + res.status + '). Check that the audit function is deployed.');
  }

  return pollAuditJob(jobId, onProgress);
}

export async function pollAuditJob(jobId, onProgress) {
  let readFailures = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const { data, error } = await supabase.from('audit_jobs').select('*').eq('id', jobId).single();
    if (error || !data) {
      readFailures += 1;
      if (readFailures >= MAX_READ_FAILURES) {
        throw new Error('Lost contact with the audit job — check your connection and look for the finished audit in the client record.');
      }
      continue;
    }
    readFailures = 0;

    if (data.status === 'done') {
      if (data.usage && data.usage.totals) {
        console.log('[audit-usage totals]', JSON.stringify(data.usage.totals));
      }
      onProgress && onProgress({ stage: 'Complete', pct: 100, tokens: data.tokens || 0 });
      return { audit: data.result, usage: data.usage };
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'Audit failed on the server.');
    }

    const age = Date.now() - new Date(data.updated_at).getTime();
    if (data.status === 'queued' && age > QUEUE_STALL_MS) {
      throw new Error('The audit job was never picked up by the server — check that the audit function is deployed, then try again.');
    }
    if (data.status === 'running' && age > RUN_STALL_MS) {
      throw new Error('The audit stalled on the server (no progress for 4 minutes). Very large reports can exceed the 15-minute server limit — try Individual mode or a smaller export.');
    }

    onProgress && onProgress({
      stage: data.stage || (data.status === 'queued' ? 'Waiting for server' : 'Working'),
      pct: data.pct,
      tokens: data.tokens || 0,
    });
  }
}
