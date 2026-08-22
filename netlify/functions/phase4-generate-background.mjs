// RETIRED: the former Setup & Spike Phase 4 CFPB/state-AG generator.
//
// Existing escalation rows remain available as read-only history. This
// endpoint performs only caller authentication and record authorization, then
// closes the queued job without invoking a model or changing the escalation.
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { requireStaff } from './_requireAuth.cjs';

const RETIRED_PHASE4_ERROR = 'LEGACY PHASE 4 GENERATION RETIRED — existing escalation records are read-only.';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  let caller;
  try {
    caller = await requireStaff(event);
  } catch (error) {
    if (error?.statusCode) return error;
    console.error('phase4-generate: could not authenticate caller', error);
    return { statusCode: 500, body: 'authentication failed' };
  }

  let jobId = null;
  try {
    const body = JSON.parse(event.body || '{}');
    jobId = body.jobId;
  } catch {
    // The validation response below is intentionally uniform.
  }
  if (typeof jobId !== 'string' || !jobId) return { statusCode: 400, body: 'jobId required' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error('phase4-generate: missing Supabase server configuration');
    return { statusCode: 500, body: 'server not configured' };
  }

  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // Resolve the queued job within the authenticated caller's scope before
  // disclosing retirement status or mutating the job, then authorize the
  // linked escalation record as the former generator did.
  const { data: queuedJob, error: queuedJobError } = await db
    .from('phase4_jobs')
    .select('id, escalation_id')
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued')
    .maybeSingle();
  if (queuedJobError || !queuedJob) {
    console.warn('phase4-generate: job not available to caller', jobId, queuedJobError?.message);
    return { statusCode: 409, body: 'job not claimable' };
  }
  if (typeof queuedJob.escalation_id !== 'string' || !queuedJob.escalation_id) {
    return { statusCode: 400, body: 'job contains invalid escalation data' };
  }

  const { data: targetEscalation, error: escalationError } = await db
    .from('escalations')
    .select('id, user_id')
    .eq('id', queuedJob.escalation_id)
    .maybeSingle();
  if (escalationError || !targetEscalation) return { statusCode: 404, body: 'escalation not found' };
  if (caller.role !== 'admin' && targetEscalation.user_id !== caller.userId) {
    return { statusCode: 403, body: 'not authorized for this escalation' };
  }

  const finishedAt = new Date().toISOString();
  const { error: retirementError } = await db
    .from('phase4_jobs')
    .update({
      status: 'error',
      stage: 'Retired workflow',
      error: RETIRED_PHASE4_ERROR,
      finished_at: finishedAt,
      updated_at: finishedAt,
    })
    .eq('id', jobId)
    .eq('user_id', caller.userId)
    .eq('status', 'queued');
  if (retirementError) {
    console.error('phase4-generate: could not close retired job', jobId, retirementError.message);
    return { statusCode: 500, body: 'could not close retired job' };
  }

  return { statusCode: 410, body: RETIRED_PHASE4_ERROR };
};
