/**
 * Fieldwork Campaign expert chat — isolated from CCC Concierge / agents API.
 * Uses FIELDWORK_ANTHROPIC_API_KEY + fieldwork_* tables only.
 *
 * POST JSON: { message, history?, context? }
 * Gates: Campaign plan, business hours (America/Denver weekdays 9–17), message cap.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const MODEL = 'claude-haiku-4-5';
const MAX_MESSAGE = 2000;
const TZ = 'America/Denver';

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization,content-type',
    },
    body: JSON.stringify(body),
  };
}

function fwAdmin() {
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const key = process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function requireUser(event) {
  const headers = event.headers || {};
  const authHeader = headers.authorization || headers.Authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  const url = process.env.FIELDWORK_SUPABASE_URL;
  const anon = process.env.FIELDWORK_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

/** Weekdays 9:00–17:00 America/Denver. */
export function isExpertBusinessHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  // hour12:false can yield "24" at midnight in some engines
  const h = hour === 24 ? 0 : hour;
  return h >= 9 && h < 17;
}

function summarizeClientContext(subscriber, campaigns, clientContext = {}) {
  const parts = [];
  parts.push('=== SUBSCRIBER ===');
  parts.push(`Name: ${subscriber.full_name || 'Subscriber'}`);
  parts.push(`Plan: ${subscriber.plan_id}`);
  parts.push(`Mail credits: ${subscriber.mail_credits}`);
  parts.push(`Audit credits: ${subscriber.audit_credits}`);

  const audit = clientContext.audit;
  if (audit?.summary || audit?.accounts?.length) {
    parts.push('\n=== CURRENT AUDIT (sanitized) ===');
    if (audit.summary) parts.push(JSON.stringify(audit.summary));
    const accounts = (audit.accounts || []).slice(0, 12).map((a) => ({
      furnisher: a.furnisher || a.creditor,
      priority: a.priority,
      status: a.status,
      balance: a.balance,
      issueCount: (a.issues || a.violations || []).length,
      topIssues: (a.issues || a.violations || []).slice(0, 3).map((v) => v.field || v.title || v.code),
    }));
    parts.push(JSON.stringify(accounts));
  } else {
    parts.push('\n=== NO AUDIT LOADED IN SESSION ===');
  }

  if (Array.isArray(campaigns) && campaigns.length) {
    parts.push(`\n=== CAMPAIGNS (${campaigns.length}) ===`);
    parts.push(JSON.stringify(campaigns.slice(0, 5).map((c) => ({
      name: c.name,
      status: c.status,
      selected: (c.selected_account_ids || []).length,
      created_at: c.created_at,
    }))));
  }

  if (Array.isArray(clientContext.documents) && clientContext.documents.length) {
    parts.push('\n=== DOCUMENTS ON FILE ===');
    parts.push(JSON.stringify(clientContext.documents.slice(0, 12).map((d) => ({
      name: d.name,
      kind: d.kind,
    }))));
  }

  return parts.join('\n');
}

function demoReply(message, fileContext) {
  const q = String(message || '').toLowerCase();
  if (q.includes('credit') && (q.includes('left') || q.includes('remain') || q.includes('how many'))) {
    return 'On Campaign you get 8 expert-chat messages per month (this one counts), plus your mail and audit caps. Check the sidebar for remaining balances.';
  }
  if (q.includes('follow') || q.includes('response') || q.includes('reply')) {
    return 'When a furnisher or bureau answers, upload the letter in Documents. Campaign can analyze the reply and draft the next certified packet — open a new campaign wave when you’re ready.';
  }
  if (q.includes('clock') || q.includes('30') || q.includes('deadline') || q.includes('when')) {
    return 'Opening packets start a ~30-day investigatory window once delivered. Track status on the campaign page; if nothing useful comes back, escalate with a follow-up or bureau-route packet.';
  }
  if (fileContext.includes('NO AUDIT')) {
    return 'I don’t see a live audit in your workspace yet. Run a forensic audit from New campaign → Upload, then ask me about specific furnishers or next steps.';
  }
  return 'I’m your Fieldwork campaign expert (demo reply). Ask about a furnisher on your audit, mail credits, response windows, or whether to send a follow-up vs bureau-route packet — I’ll answer from your workspace context.';
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST only' });
  }

  let payload = {};
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const message = String(payload.message || '').trim();
  if (!message) return json(400, { error: 'message required' });
  if (message.length > MAX_MESSAGE) {
    return json(400, { error: `Message too long (max ${MAX_MESSAGE} characters)` });
  }

  const admin = fwAdmin();
  const user = await requireUser(event);
  const openHours = isExpertBusinessHours();

  // Local / unauthenticated demo path — no DB burn; hours soft-noted only.
  if (!admin || !user) {
    const fileContext = summarizeClientContext(
      { full_name: 'Demo', plan_id: 'unlimited', mail_credits: 8, audit_credits: 25 },
      [],
      payload.context || {},
    );
    const reply = openHours
      ? demoReply(message, fileContext)
      : `${demoReply(message, fileContext)}\n\n(Note: live Campaign expert chat is weekdays 9am–5pm Mountain — demo replies still work offline.)`;
    return json(200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'demo',
      reply,
      expert_chat_credits: null,
      outsideHours: !openHours,
    });
  }

  const { data: subscriber, error: subErr } = await admin
    .from('fieldwork_subscribers')
    .select('id, full_name, plan_id, mail_credits, audit_credits, expert_chat_credits')
    .eq('user_id', user.id)
    .maybeSingle();

  if (subErr || !subscriber) {
    return json(401, { error: 'No Fieldwork subscriber — finish signup first.' });
  }

  if (subscriber.plan_id !== 'unlimited') {
    return json(403, {
      error: 'Expert chat is included on the Campaign plan. Upgrade to unlock live help.',
      plan_id: subscriber.plan_id,
    });
  }

  // Authenticated Campaign: enforce business hours before burning a credit.
  if (!openHours) {
    return json(403, {
      error: 'Expert chat is available weekdays 9am–5pm Mountain Time. Try again during business hours — this message was not charged.',
      outsideHours: true,
      expert_chat_credits: subscriber.expert_chat_credits,
    });
  }

  const remaining = typeof subscriber.expert_chat_credits === 'number'
    ? subscriber.expert_chat_credits
    : 0;
  if (remaining < 1) {
    return json(402, {
      error: 'You’ve used all 8 expert-chat messages for this billing period.',
      expert_chat_credits: 0,
    });
  }

  const { data: reserved, error: reserveErr } = await admin
    .from('fieldwork_subscribers')
    .update({
      expert_chat_credits: remaining - 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', subscriber.id)
    .eq('expert_chat_credits', remaining)
    .select('expert_chat_credits')
    .maybeSingle();

  if (reserveErr || !reserved) {
    return json(402, {
      error: 'Could not reserve an expert-chat message — none left.',
      expert_chat_credits: remaining,
    });
  }

  const { data: campaigns } = await admin
    .from('fieldwork_campaigns')
    .select('name, status, selected_account_ids, created_at')
    .eq('subscriber_id', subscriber.id)
    .order('created_at', { ascending: false })
    .limit(8);

  const fileContext = summarizeClientContext(subscriber, campaigns || [], payload.context || {});

  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return json(200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'demo',
      reply: demoReply(message, fileContext),
      expert_chat_credits: reserved.expert_chat_credits,
      outsideHours: false,
    });
  }

  const history = Array.isArray(payload.history) ? payload.history : [];
  const mapped = history
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && m.text)
    .slice(-10)
    .map((m) => ({ role: m.role, content: String(m.text).slice(0, MAX_MESSAGE) }));

  // Ensure conversation ends with the current user message.
  if (!mapped.length || mapped[mapped.length - 1].content !== message) {
    mapped.push({ role: 'user', content: message });
  }
  while (mapped.length && mapped[0].role !== 'user') mapped.shift();

  const system = [
    'You are the Fieldwork Campaign Expert — in-app help for DIY credit-dispute subscribers.',
    'Fieldwork is a standalone software product. Never mention Credit Comeback Club, CCC, agencies, or staff case managers.',
    'Answer from the subscriber workspace context below. Be specific about furnishers, mail credits, audit caps, and next dispute steps.',
    'If the subscriber needs a human judgment call, tell them they can tap “Talk to a live expert” — that forwards an AI brief on the account in question and their concerns to a live expert.',
    'Do not promise score increases. Do not give legal advice; frame guidance as software workflow help.',
    'Keep replies under 3 short paragraphs.',
    '',
    '=== WORKSPACE ===',
    fileContext,
    '=== END WORKSPACE ===',
  ].join('\n');

  try {
    const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 2 });
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system,
      messages: mapped,
    });
    const textBlock = response.content.find((b) => b.type === 'text');
    const reply = (textBlock && textBlock.text) || 'I could not draft a reply — try again in a moment.';

    return json(200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'live',
      reply,
      expert_chat_credits: reserved.expert_chat_credits,
      outsideHours: false,
    });
  } catch (err) {
    console.error('fieldwork-expert-chat failed', err);
    // Refund on model failure
    await admin
      .from('fieldwork_subscribers')
      .update({
        expert_chat_credits: remaining,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id);
    return json(500, {
      error: err.message || 'Expert chat unavailable',
      expert_chat_credits: remaining,
    });
  }
};
