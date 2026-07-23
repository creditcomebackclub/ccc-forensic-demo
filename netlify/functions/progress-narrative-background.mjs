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
import { diffAuditAccounts } from '../../src/utils/diffEngine.js';
import { PROGRESS_NARRATIVE_SYSTEM_PROMPT } from '../../src/prompts/progressNarrativePrompt.js';

const MODEL = 'claude-sonnet-5';

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

function monthLabel(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

// First ~60 words of the narrative as an email teaser — the full update
// lives in the portal's Progress tab, per Build 1d ("no attachments —
// portal link only").
function excerpt(text, wordCount = 60) {
  const words = text.split(/\s+/);
  if (words.length <= wordCount) return text;
  return words.slice(0, wordCount).join(' ') + '…';
}

// Same branded shell as send-lpoa.cjs's send_campaign_update (header/eyebrow/
// footer) — visual consistency with every other client-facing CCC email.
function progressEmailHtml({ firstName, teaser, portalUrl }) {
  return '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>'
    + '<body style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:20px;background:#F8F9FA;">'
    + '<div style="background:#1B2A4A;padding:20px 28px;border-radius:8px 8px 0 0;display:flex;align-items:center;gap:10px;">'
    + '<div style="background:#C9A84C;border-radius:5px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;"><span style="color:#1B2A4A;font-weight:800;font-size:12px;">CC</span></div>'
    + '<div style="color:#C9A84C;font-weight:700;font-size:14px;">Credit Comeback Club</div></div>'
    + '<div style="background:#fff;border:1px solid #E5E7EB;border-top:none;padding:28px;border-radius:0 0 8px 8px;">'
    + '<p style="color:#6B7280;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Progress Update</p>'
    + '<h1 style="font-size:20px;color:#1B2A4A;margin:0 0 16px;">Hi ' + firstName + ',</h1>'
    + '<p style="font-size:13px;color:#374151;margin:0 0 20px;">' + teaser + '</p>'
    + '<div style="text-align:center;margin:0 0 20px;"><a href="' + portalUrl + '" style="background:#1B2A4A;color:#C9A84C;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;display:inline-block;">View your full update &#8594;</a></div>'
    + '<hr style="border:none;border-top:1px solid #E5E7EB;margin:20px 0;">'
    + '<p style="font-size:11px;color:#9CA3AF;margin:0;">Credit Comeback Club | creditcomebackclub.com | 970-644-0063</p>'
    + '</div></body></html>';
}

async function sendProgressEmail(sgKey, to, html, subject) {
  const payload = JSON.stringify({
    personalizations: [{ to: [{ email: to }] }],
    from: { email: 'chris@cccpartners.co', name: 'Credit Comeback Club' },
    subject,
    content: [{ type: 'text/html', value: html }],
  });
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: { Authorization: `Bearer ${sgKey}`, 'Content-Type': 'application/json' },
    body: payload,
  });
  if (!res.ok) throw new Error('SendGrid error ' + res.status + ': ' + (await res.text()));
}

// 1d — gated on its own `emailed_at` stamp (not on whether the narrative was
// just generated), so a retry after a narrative-generation success but
// email-send failure still gets one attempt to send — and a retry after
// both already succeeded sends nothing. Best-effort: a failure here must
// never undo the narrative that's already saved and already visible in the
// portal's Progress tab.
async function maybeSendEmail(db, { id, clientName, narrative, toReportDate, origin }) {
  try {
    const { data: rows } = await db.from('progress_updates').select('emailed_at').eq('id', id).limit(1);
    if (rows && rows[0] && rows[0].emailed_at) return; // already stamped — skip

    const sgKey = process.env.SENDGRID_API_KEY;
    if (!sgKey) return;

    const { data: cpRows } = await db.from('client_profiles').select('email').eq('full_name', clientName).limit(1);
    const clientEmail = cpRows && cpRows[0] && cpRows[0].email;
    if (!clientEmail) return;

    const firstName = clientName.split(' ')[0] || clientName;
    const html = progressEmailHtml({ firstName, teaser: excerpt(narrative), portalUrl: origin });
    const subject = 'Your ' + monthLabel(toReportDate) + ' credit report update';
    await sendProgressEmail(sgKey, clientEmail, html, subject);
    await db.from('progress_updates').update({ emailed_at: new Date().toISOString() }).eq('id', id);
  } catch (e) {
    console.error('progress-narrative: email send failed (non-fatal)', e.message);
  }
}

export const handler = async (event) => {
  let clientName = null;
  try { clientName = JSON.parse(event.body || '{}').clientName; } catch (e) { /* handled below */ }
  if (!clientName) return { statusCode: 400, body: 'clientName required' };

  let userId;
  try { ({ userId } = await requireAuth(event)); }
  catch (e) { if (e.statusCode) return e; throw e; }

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

  const { data: audits, error: auditsErr } = await db
    .from('audits')
    .select('id,report_date,audit')
    .eq('user_id', userId)
    .eq('client_name', clientName)
    .order('report_date', { ascending: false })
    .limit(2);
  if (auditsErr) {
    console.error('progress-narrative: audits fetch failed', auditsErr.message);
    return { statusCode: 500, body: 'audits fetch failed' };
  }
  if (!audits || audits.length < 2) {
    return { statusCode: 200, body: 'not enough audits yet — no-op' };
  }

  const [newer, older] = audits; // already ordered desc
  const id = slug(clientName) + '__diff__' + older.report_date + '__' + newer.report_date;

  const origin = event.headers.origin || 'https://ccc-forensic-demo.netlify.app';

  // Idempotent: a narrative already generated for this exact audit pair is
  // not regenerated by the automatic trigger (manual regen is a separate,
  // deliberate admin action, not this function's job) — but still give the
  // email its own chance to send if an earlier run generated the narrative
  // and then failed before emailing.
  const { data: existingRows } = await db.from('progress_updates').select('narrative').eq('id', id).limit(1);
  if (existingRows && existingRows.length > 0 && existingRows[0].narrative) {
    await maybeSendEmail(db, { id, clientName, narrative: existingRows[0].narrative, toReportDate: newer.report_date, origin });
    return { statusCode: 200, body: 'narrative already generated' };
  }

  const diff = diffAuditAccounts(older.audit, newer.audit);

  // Persist the re-verified diff — overwrites whatever the client-side
  // "run progress diff" may have already written for this same pair.
  const { error: upsertErr } = await db.from('progress_updates').upsert({
    id,
    user_id: userId,
    client_name: clientName,
    from_audit_id: older.id,
    to_audit_id: newer.id,
    from_report_date: older.report_date,
    to_report_date: newer.report_date,
    diff,
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
      max_tokens: 700,
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

  await maybeSendEmail(db, { id, clientName, narrative, toReportDate: newer.report_date, origin });

  return { statusCode: 200, body: JSON.stringify({ id }) };
};
