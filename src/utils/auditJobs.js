// Client half of the server-side audit pipeline: upload report files, create
// an audit_jobs row, kick the background function, then poll the row for
// progress ({stage, pct, tokens} — same shape AuditProgress always used)
// until the job lands on done/error.
import { supabase } from './supabase';
import { MAX_REPORT_CHARS, htmlToText } from './reportText.js';
import {
  RESUMABLE_AUDIT_VERSION,
  auditJobCanDispatch,
  buildAuditSourceMeta,
} from './auditResume.js';

const POLL_MS = 2000;
const QUEUE_STALL_MS = 2 * 60 * 1000;  // never picked up by the function
const QUEUE_VISIBLE_FAILURE_MS = 5 * 60 * 1000;
const RUN_STALL_MS = 10 * 60 * 1000;   // running but no row updates
const MAX_READ_FAILURES = 15;          // consecutive poll read errors
const START_RETRIES = 2;               // same job ID: safe with server claim
const REDISPATCH_MS = 15 * 1000;        // checkpoint chains normally beat this

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

export async function runAuditJob({ mode, files = [], clientSelection, mergeSelection = null }, onProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  if (clientSelection?.type !== 'existing' || !clientSelection.id) {
    throw new Error('Select or create the exact CRM lead before running an audit.');
  }

  if (mode === 'merge') {
    if (clientSelection?.type !== 'existing' || !clientSelection.id) {
      throw new Error('Merge requires an existing client with three saved bureau parses.');
    }
    if (!mergeSelection?.cohortKey || !Array.isArray(mergeSelection?.parseIds) || mergeSelection.parseIds.length !== 3) {
      throw new Error('Merge requires the exact three source-bound parses from one report cohort.');
    }
  } else {
    if (!files.length) throw new Error('No report files attached.');
    for (const f of files) await preflightSize(f.file);
  }

  const candidateJobId = crypto.randomUUID();
  onProgress && onProgress({
    stage: mode === 'merge' ? 'Starting bureau merge' : ('Uploading report' + (files.length > 1 ? 's' : '')),
    pct: null,
    tokens: 0,
  });

  const fileMeta = [];
  const removeCandidateUploads = async () => {
    if (!fileMeta.length) return;
    const { error: removeError } = await supabase.storage.from('documents')
      .remove(fileMeta.map((file) => file.path));
    if (removeError) throw new Error('Could not securely remove unused report upload: ' + removeError.message);
  };

  let jobId;
  let rpcAttempted = false;
  try {
    for (const f of files) {
      const safeName = ((f.bureau || 'report').toLowerCase() + '-' + f.file.name).replace(/[^a-zA-Z0-9._-]+/g, '_');
      const path = user.id + '/audit-jobs/' + candidateJobId + '/' + safeName;
      const source = await buildAuditSourceMeta(f.file, f.bureau || null);
      const { error } = await supabase.storage.from('documents').upload(path, f.file, { upsert: false });
      if (error) throw new Error('Could not upload report: ' + error.message);
      fileMeta.push({ path, ...source });
    }

    rpcAttempted = true;
    const { data: createdRows, error: insErr } = await supabase.rpc('ccc_create_or_resume_audit_job', {
      p_candidate_id: candidateJobId,
      p_mode: mode,
      p_files: fileMeta,
      p_selected_client_id: clientSelection.id,
      p_merge_selection: mode === 'merge' ? mergeSelection : null,
    });
    if (insErr) throw new Error('Could not create audit job: ' + insErr.message);
    const created = Array.isArray(createdRows) ? createdRows[0] : createdRows;
    jobId = created?.job_id;
    if (!jobId) throw new Error('The audit server did not return a durable job id.');
  } catch (error) {
    let durableCandidate = null;
    if (rpcAttempted) {
      const { data: candidateRows, error: reconcileError } = await supabase
        .from('audit_jobs')
        .select('id,workflow_version,selected_client_id,status')
        .eq('id', candidateJobId)
        .eq('user_id', user.id)
        .limit(2);

      if (reconcileError || (candidateRows || []).length > 1) {
        throw new Error(
          `${error.message} CCC could not verify whether the durable audit job was created, so the source upload was preserved. Check Operations before retrying.`
        );
      }
      const candidate = candidateRows?.[0] || null;
      if (candidate
        && candidate.workflow_version === RESUMABLE_AUDIT_VERSION
        && candidate.selected_client_id === clientSelection.id) {
        durableCandidate = candidate;
      }
    }

    if (durableCandidate) {
      // The RPC transaction committed but its HTTP response was lost. Keep
      // the now-authoritative source object and resume the exact durable job.
      jobId = durableCandidate.id;
    } else {
      try { await removeCandidateUploads(); } catch (cleanupError) {
        throw new Error(`${error.message} ${cleanupError.message}`);
      }
      throw error;
    }
  }

  // A byte-identical logical audit may already be queued, running, or done.
  // Remove only this caller's unused candidate uploads and continue polling
  // the canonical job; never instruct the operator to create a duplicate.
  if (jobId !== candidateJobId && fileMeta.length) {
    await removeCandidateUploads();
  }

  const { data: { session } } = await supabase.auth.getSession();
  await dispatchAuditJob(jobId, session?.access_token);

  return pollAuditJob(jobId, onProgress, session?.access_token);
}

async function dispatchAuditJob(jobId, accessToken) {
  let startResponse = null;
  for (let attempt = 0; attempt <= START_RETRIES; attempt += 1) {
    try {
      startResponse = await fetch('/.netlify/functions/audit-run-background', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
        },
        body: JSON.stringify({ jobId }),
      });
      // Netlify background functions ACK with 202 and run detached. A 409 on
      // a retry normally means the first request already claimed this exact
      // job, so polling is the correct idempotent recovery path.
      if (startResponse.ok || startResponse.status === 409) break;
      if (startResponse.status < 500 || attempt === START_RETRIES) {
        const startError = new Error('Could not start the audit on the server (HTTP ' + startResponse.status + '). Check that the audit function is deployed.');
        startError.nonRetryable = startResponse.status < 500;
        throw startError;
      }
    } catch (error) {
      if (error?.nonRetryable || attempt === START_RETRIES) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
  }
  return startResponse;
}

export async function pollAuditJob(jobId, onProgress, accessToken = null) {
  let readFailures = 0;
  let lastDispatchAt = 0;
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
      if (data.retryable) {
        onProgress && onProgress({
          stage: data.stage || 'Resuming safely from the last saved checkpoint',
          pct: data.pct,
          tokens: data.tokens || 0,
        });
        if (Date.now() - lastDispatchAt >= REDISPATCH_MS) {
          lastDispatchAt = Date.now();
          await dispatchAuditJob(jobId, accessToken).catch(() => {});
        }
        continue;
      }
      throw new Error(data.error || 'Audit failed on the server.');
    }
    if (data.status === 'expired') {
      throw new Error(data.error || 'This saved audit expired before completion. Its attempt history is still available for review.');
    }

    const age = Date.now() - new Date(data.updated_at).getTime();
    if (data.status === 'queued' && Number(data.attempt_count || 0) === 0
        && age > QUEUE_VISIBLE_FAILURE_MS) {
      throw new Error('The audit server has not claimed this saved job after 5 minutes. Do not upload it again—the same job remains queued for Operations review.');
    }
    const stalled = (data.status === 'queued' && age > QUEUE_STALL_MS)
      || ((data.status === 'running' || data.status === 'finalizing') && age > RUN_STALL_MS);
    if ((stalled || auditJobCanDispatch(data)) && Date.now() - lastDispatchAt >= REDISPATCH_MS) {
      lastDispatchAt = Date.now();
      await dispatchAuditJob(jobId, accessToken).catch(() => {});
    }

    onProgress && onProgress({
      stage: data.stage || (
        ['waiting', 'retryable'].includes(data.status)
          ? 'Resuming safely from the last saved checkpoint'
          : data.status === 'queued' ? 'Waiting for server' : 'Working'
      ),
      pct: data.pct,
      tokens: data.tokens || 0,
    });
  }
}
