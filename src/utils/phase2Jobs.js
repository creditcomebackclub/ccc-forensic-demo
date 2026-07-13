// Client half of the server-side Phase 2 pipeline: create a phase2_jobs row,
// kick the background function, then poll the row for progress until it
// lands on done/error. Mirrors auditJobs.js — same shape, tuned for Phase 2's
// much shorter typical runtime (one Claude call vs. a full audit).
import { supabase } from './supabase';

const POLL_MS = 1500;
const QUEUE_STALL_MS = 60 * 1000;   // never picked up by the function
const RUN_STALL_MS = 3 * 60 * 1000; // running but no row updates
const MAX_READ_FAILURES = 15;       // consecutive poll read errors

// filePaths: storage paths in the `responses` bucket, in page order. Omit
// (or pass []) for kind: 'non_response'.
export async function runPhase2Job({ letterId, kind, filePaths, mailedDate }, onProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const jobId = crypto.randomUUID();
  onProgress && onProgress(0);

  const { error: insErr } = await supabase.from('phase2_jobs').insert({
    id: jobId, user_id: user.id, letter_id: letterId, kind,
    files: (filePaths || []).map((path) => ({ path })),
  });
  if (insErr) throw new Error('Could not create analysis job: ' + insErr.message);

  const res = await fetch('/.netlify/functions/phase2-analyze-background', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId, mailedDate: mailedDate || null }),
  });
  // Netlify background functions ACK with 202 and run detached
  if (res.status >= 400) {
    throw new Error('Could not start analysis on the server (HTTP ' + res.status + '). Check that the phase2-analyze function is deployed.');
  }

  return pollPhase2Job(jobId, onProgress);
}

export async function pollPhase2Job(jobId, onProgress) {
  let readFailures = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const { data, error } = await supabase.from('phase2_jobs').select('*').eq('id', jobId).single();
    if (error || !data) {
      readFailures += 1;
      if (readFailures >= MAX_READ_FAILURES) {
        throw new Error('Lost contact with the analysis job — check your connection and try again.');
      }
      continue;
    }
    readFailures = 0;

    if (data.status === 'done') {
      onProgress && onProgress(data.tokens || 0);
      return data.result;
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'Analysis failed on the server.');
    }

    const age = Date.now() - new Date(data.updated_at).getTime();
    if (data.status === 'queued' && age > QUEUE_STALL_MS) {
      throw new Error('The analysis job was never picked up by the server — check that the phase2-analyze function is deployed, then try again.');
    }
    if (data.status === 'running' && age > RUN_STALL_MS) {
      throw new Error('The analysis stalled on the server (no progress for 3 minutes). Try again.');
    }

    onProgress && onProgress(data.tokens || 0);
  }
}
