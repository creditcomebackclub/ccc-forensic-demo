// Client half of the server-side Phase 4 (CFPB/AG narrative) pipeline:
// create a phase4_jobs row, kick the background function, then poll the
// row for progress until it lands on done/error. Mirrors phase2Jobs.js.
import { supabase } from './supabase';

const POLL_MS = 1500;
const QUEUE_STALL_MS = 60 * 1000;
const RUN_STALL_MS = 3 * 60 * 1000;
const MAX_READ_FAILURES = 15;

export async function runPhase4Job({ escalationId }, onProgress) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const jobId = crypto.randomUUID();
  onProgress && onProgress(0);

  const { error: insErr } = await supabase.from('phase4_jobs').insert({
    id: jobId, user_id: user.id, escalation_id: escalationId,
  });
  if (insErr) throw new Error('Could not create generation job: ' + insErr.message);

  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch('/.netlify/functions/phase4-generate-background', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {})
    },
    body: JSON.stringify({ jobId }),
  });
  if (res.status >= 400) {
    throw new Error('Could not start generation on the server (HTTP ' + res.status + '). Check that the phase4-generate function is deployed.');
  }

  return pollPhase4Job(jobId, onProgress);
}

export async function pollPhase4Job(jobId, onProgress) {
  let readFailures = 0;
  while (true) {
    await new Promise((r) => setTimeout(r, POLL_MS));

    const { data, error } = await supabase.from('phase4_jobs').select('*').eq('id', jobId).single();
    if (error || !data) {
      readFailures += 1;
      if (readFailures >= MAX_READ_FAILURES) {
        throw new Error('Lost contact with the generation job — check your connection and try again.');
      }
      continue;
    }
    readFailures = 0;

    if (data.status === 'done') {
      onProgress && onProgress(data.tokens || 0);
      return data.result;
    }
    if (data.status === 'error') {
      throw new Error(data.error || 'Generation failed on the server.');
    }

    const age = Date.now() - new Date(data.updated_at).getTime();
    if (data.status === 'queued' && age > QUEUE_STALL_MS) {
      throw new Error('The generation job was never picked up by the server — check that the phase4-generate function is deployed, then try again.');
    }
    if (data.status === 'running' && age > RUN_STALL_MS) {
      throw new Error('The generation stalled on the server (no progress for 3 minutes). Try again.');
    }

    onProgress && onProgress(data.tokens || 0);
  }
}
