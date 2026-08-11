// Client half of the server-side Phase 2 pipeline: create a phase2_jobs row,
// kick the background function, then poll the row for progress until it
// lands on done/error. Mirrors auditJobs.js — same shape, tuned for Phase 2's
// much shorter typical runtime (one extraction call plus deterministic rules).
import { supabase } from './supabase';

const POLL_MS = 1500;
const QUEUE_STALL_MS = 3 * 60 * 1000;    // Netlify queue/cold-start allowance
const RUN_STALL_MS = 12 * 60 * 1000;     // background function limit is 15m
const MAX_READ_FAILURES = 15;       // consecutive poll read errors

// A follow-up can finish model generation and then fail during local
// persistence (for example, while reconciling a legacy source letter).
// Reuse that immutable, completed result for a short window instead of
// charging for the same model work again.
export async function getRecentCompletedPhase2Result({
  letterId,
  kind,
  evidenceId,
  maxAgeMs = 60 * 60 * 1000,
}) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();

  let query = supabase
    .from('phase2_jobs')
    .select('id,result,tokens,finished_at')
    .eq('user_id', user.id)
    .eq('letter_id', letterId)
    .eq('kind', kind)
    .eq('status', 'done')
    .gte('finished_at', cutoff)
    .not('result', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1);
  query = evidenceId
    ? query.eq('response_evidence_id', evidenceId)
    : query.is('response_evidence_id', null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error('Could not check the completed analysis job: ' + error.message);
  return data || null;
}

// filePaths: storage paths in the `responses` bucket, in page order. Omit
// (or pass []) for kind: 'non_response'. evidenceId is optional for legacy
// uploads but required by the bureau-response path so the server can verify
// the evidence-to-letter relationship before reading it.
export async function runPhase2Job({ letterId, kind, filePaths, mailedDate, evidenceId }, onProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const jobId = crypto.randomUUID();
  onProgress && onProgress(0);

  const { error: insErr } = await supabase.from('phase2_jobs').insert({
    id: jobId, user_id: user.id, letter_id: letterId, kind,
    files: (filePaths || []).map((path) => ({ path })),
    response_evidence_id: evidenceId || null,
  });
  if (insErr) throw new Error('Could not create analysis job: ' + insErr.message);

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/phase2-analyze-background', {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
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
      throw new Error('The analysis has had no server heartbeat for 12 minutes. Check the Netlify function log before retrying so a still-running job is not duplicated.');
    }

    onProgress && onProgress(data.tokens || 0);
  }
}
