// Retention Build 1b — Netlify BACKGROUND function (fire-and-forget).
// Triggered from saveAudit() (src/utils/storage.js) whenever a client picks
// up a 2nd+ audit. Never blocks the audit save: the caller POSTs and does
// not await completion; Netlify ACKs background functions with 202
// immediately and runs this detached.
//
// Re-verifies rather than trusting any client-supplied diff: this function
// recomputes the diff itself from the two most recent audits, using the
// exact same shared module the frontend's manual "run progress diff" uses
// (src/utils/diffEngine.js) — never a re-implementation.
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { requireAuth } from './_requireAuth.cjs';
import { diffAuditAccounts, normalizeFurnisher } from '../../src/utils/diffEngine.js';
import { buildPhaseProgress } from '../../src/utils/phaseProgress.js';
import { PROGRESS_NARRATIVE_SYSTEM_PROMPT } from '../../src/prompts/progressNarrativePrompt.js';
import { operationalAudits } from '../../src/utils/auditOperational.js';

const MODEL = 'claude-sonnet-5';

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

// The admin dashboard's entire "Deletions" surface (win rate, funnel stage,
// avg days to deletion) is keyed off letters.response_outcome === 'deleted'
// — a flag nobody was setting when a deletion was only ever confirmed by
// this automated report-diff, not by a staff member manually flagging a
// letter. Only Phase 1 letters get marked: a Phase 3 row can cover several
// furnishers via covered_furnishers, so flipping its single response_outcome
// off just one of them being deleted would misrepresent the others. Uses
// diffEngine's own normalizeFurnisher — the audit's furnisher string and
// the letter's furnisher string aren't always byte-identical. Never
// overwrites a response_outcome that's already set (e.g. a staff member
// already logged a real response) — a diff-detected deletion only fills in
// the gap, it doesn't override a human's own record.
async function markDeletedLetters(db, { userId, clientName, clientId, deletedFurnishers, confirmedDate }) {
  if (!deletedFurnishers || deletedFurnishers.length === 0) return;
  try {
    const normalizedDeleted = deletedFurnishers.map(normalizeFurnisher);
    const lettersQuery = clientId
      ? db.from('letters').select('id,furnisher,response_outcome').eq('user_id', userId).eq('client_id', clientId).ilike('phase', 'Phase 1%')
      : db.from('letters').select('id,furnisher,response_outcome').eq('user_id', userId).eq('client_name', clientName).ilike('phase', 'Phase 1%');
    const { data: letters } = await lettersQuery;
    for (const l of letters || []) {
      if (l.response_outcome) continue; // never overwrite an existing outcome
      if (normalizedDeleted.includes(normalizeFurnisher(l.furnisher))) {
        await db.from('letters').update({ response_outcome: 'deleted', response_date: confirmedDate }).eq('id', l.id);
      }
    }
  } catch (e) {
    console.error('progress-narrative: marking deleted letters failed (non-fatal)', e.message);
  }
}

// Keep the report comparison, admin dashboard, and client portal on one
// lifecycle snapshot. Only safe state fields are selected; raw response
// evidence, model analysis, staff notes, and escalation narrative never
// enter progress_updates.
async function loadPhaseProgress(db, { userId, clientName, clientId, diff }) {
  const lettersQuery = clientId
    ? db.from('letters').select('id,client_id,client_account_id,furnisher,account_id,phase,round_number,target_type,saved_at,date,mailed_date,delivered_at,response_outcome,response_date,phase2_analyzed_at,bureau_response_status,bureau_response_received_at,bureau_response_analyzed_at,bureau_review_status,bureau_reviewed_at').eq('user_id', userId).eq('client_id', clientId)
    : db.from('letters').select('id,client_id,client_account_id,furnisher,account_id,phase,round_number,target_type,saved_at,date,mailed_date,delivered_at,response_outcome,response_date,phase2_analyzed_at,bureau_response_status,bureau_response_received_at,bureau_response_analyzed_at,bureau_review_status,bureau_reviewed_at').eq('user_id', userId).eq('client_name', clientName);
  const { data: letters, error: lettersError } = await lettersQuery;
  if (lettersError) throw lettersError;

  const phase3Ids = (letters || [])
    .filter((letter) => String(letter.phase || '').startsWith('Phase 3'))
    .map((letter) => letter.id);
  let escalations = [];
  if (phase3Ids.length > 0) {
    const { data, error } = await db
      .from('escalations')
      .select('phase3_letter_id,status,updated_at')
      .eq('user_id', userId)
      .in('phase3_letter_id', phase3Ids);
    if (error) throw error;
    escalations = data || [];
  }
  return buildPhaseProgress(diff, letters || [], escalations);
}

export const handler = async (event) => {
  let clientName = null;
  let clientId = null;
  try {
    const body = JSON.parse(event.body || '{}');
    clientName = body.clientName;
    clientId = body.clientId || null;
  } catch (e) { /* handled below */ }
  if (!clientName) return { statusCode: 400, body: 'clientName required' };

  let caller;
  try { caller = await requireAuth(event); }
  catch (e) { if (e.statusCode) return e; throw e; }
  const userId = caller.userId;

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!supabaseUrl || !serviceKey || !anthropicKey) {
    console.error('progress-narrative: missing env (supabase or ANTHROPIC_API_KEY)');
    return { statusCode: 500, body: 'server not configured' };
  }

  // See audit-run-background.mjs for why `realtime: { transport: ws }` is
  // required even for a REST-only function under Netlify's Node runtime.
  const db = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
    realtime: { transport: ws },
  });

  // Audit-run calls this internally with the service key. Browser callers
  // must be actual staff; a portal client must never be able to spend model
  // tokens or write a progress narrative merely by knowing a client name.
  if (!caller.isSystem) {
    const { data: profiles, error: profileError } = await db
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .limit(1);
    const role = profiles && profiles[0] && profiles[0].role;
    if (profileError || !['admin', 'auditor'].includes(role)) {
      return { statusCode: 403, body: 'staff access required' };
    }
  }

  // clientId is preferred over clientName when the caller has it — see the
  // client_id migration plan; clients.name has no unique constraint. Older
  // callers/queued jobs that only ever knew clientName still work via the
  // fallback.
  const auditsQuery = clientId
    ? db.from('audits').select('id,report_date,audit').eq('user_id', userId).eq('client_id', clientId).order('report_date', { ascending: false }).limit(25)
    : db.from('audits').select('id,report_date,audit').eq('user_id', userId).eq('client_name', clientName).order('report_date', { ascending: false }).limit(25);
  const { data: auditRows, error: auditsErr } = await auditsQuery;
  if (auditsErr) {
    console.error('progress-narrative: audits fetch failed', auditsErr.message);
    return { statusCode: 500, body: 'audits fetch failed' };
  }
  const audits = operationalAudits(auditRows).slice(0, 2);
  if (audits.length < 2) {
    return { statusCode: 200, body: 'not enough audits yet — no-op' };
  }

  const [newer, older] = audits; // already ordered desc
  // Must match storage.js's runProgressDiff id format exactly — this
  // function's idempotency check (below) looks up that same row by id, so
  // a mismatched format here would silently create a duplicate instead of
  // finding the manually-triggered "Compare Latest Reports" row.
  const id = clientId
    ? slug(clientName) + '__' + clientId + '__diff__' + older.report_date + '__' + newer.report_date
    : slug(clientName) + '__diff__' + older.report_date + '__' + newer.report_date;

  const diff = diffAuditAccounts(older.audit, newer.audit);
  let phaseProgress;
  try {
    phaseProgress = await loadPhaseProgress(db, { userId, clientName, clientId, diff });
  } catch (e) {
    console.error('progress-narrative: phase progress load failed', e.message);
    return { statusCode: 500, body: 'phase progress load failed' };
  }

  // Idempotent: a narrative already generated for this exact audit pair is
  // not regenerated by the automatic trigger (manual regen is a separate,
  // deliberate admin action, not this function's job). Email is staff-gated
  // via Progress Update Studio / progress-update.mjs — never auto-sent here.
  const { data: existingRows } = await db.from('progress_updates').select('narrative,diff').eq('id', id).limit(1);
  if (existingRows && existingRows.length > 0 && existingRows[0].narrative) {
    await db.from('progress_updates').update({ phase_progress: phaseProgress }).eq('id', id);
    const existingDeleted = ((existingRows[0].diff && existingRows[0].diff.deleted) || []).map((a) => a.furnisher).filter(Boolean);
    await markDeletedLetters(db, { userId, clientName, clientId, deletedFurnishers: existingDeleted, confirmedDate: newer.report_date });
    return { statusCode: 200, body: 'narrative already generated' };
  }

  // Persist the re-verified diff — overwrites whatever the client-side
  // "run progress diff" may have already written for this same pair.
  const { error: upsertErr } = await db.from('progress_updates').upsert({
    id,
    user_id: userId,
    client_id: clientId || null,
    client_name: clientName,
    from_audit_id: older.id,
    to_audit_id: newer.id,
    from_report_date: older.report_date,
    to_report_date: newer.report_date,
    diff,
    phase_progress: phaseProgress,
    status: 'draft',
  });
  if (upsertErr) {
    console.error('progress-narrative: diff upsert failed', upsertErr.message);
    return { statusCode: 500, body: 'diff upsert failed' };
  }

  // Deliberately excludes diff.unmatched — the model is never given
  // low-confidence accounts, so it structurally cannot mention one.
  const narrationInput = {
    fromDate: older.report_date,
    toDate: newer.report_date,
    scoreDeltas: diff.scoreDeltas,
    deletedAccounts: diff.deleted,
    newAccounts: diff.new,
    changedAccounts: diff.changed,
    negativeAccountCounts: diff.negativeCounts,
    totalDebtRemoved: diff.totalDebtRemoved,
  };

  let narrative;
  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: PROGRESS_NARRATIVE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: JSON.stringify(narrationInput) }],
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    narrative = textBlock ? textBlock.text.trim() : '';
  } catch (e) {
    console.error('progress-narrative: Claude call failed', e.message);
    return { statusCode: 500, body: 'narrative generation failed' };
  }
  if (!narrative) return { statusCode: 500, body: 'empty narrative' };

  const { error: narrErr } = await db.from('progress_updates').update({
    narrative,
    narrative_generated_at: new Date().toISOString(),
    narrative_model: MODEL,
  }).eq('id', id);
  if (narrErr) {
    console.error('progress-narrative: narrative save failed', narrErr.message);
    return { statusCode: 500, body: 'narrative save failed' };
  }

  const deletedFurnishers = (diff.deleted || []).map((a) => a.furnisher).filter(Boolean);
  await markDeletedLetters(db, { userId, clientName, clientId, deletedFurnishers, confirmedDate: newer.report_date });

  return { statusCode: 200, body: JSON.stringify({ id }) };
};
