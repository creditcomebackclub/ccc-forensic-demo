/**
 * Fieldwork Campaign → live expert handoff.
 *
 * Builds an AI brief (account in question + subscriber concerns + workspace
 * snapshot) and queues it for a live agent. Isolated from CCC Concierge.
 *
 * POST JSON: { message?, history?, context?, concern? }
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

function isExpertBusinessHours(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value;
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  if (['Sat', 'Sun'].includes(weekday)) return false;
  const h = hour === 24 ? 0 : hour;
  return h >= 9 && h < 17;
}

function pickAccountFocus(context = {}, history = [], concern = '') {
  const accounts = context.audit?.accounts || [];
  const blob = `${concern}\n${history.map((m) => m.text || '').join('\n')}`.toLowerCase();
  const hit = accounts.find((a) => {
    const name = String(a.furnisher || a.creditor || '').toLowerCase();
    return name && blob.includes(name);
  });
  const top = hit || accounts.find((a) => a.priority === 'high') || accounts[0] || null;
  if (!top) return { label: '', account: null };
  const label = top.furnisher || top.creditor || 'Account on file';
  return {
    label,
    account: {
      furnisher: label,
      priority: top.priority || null,
      status: top.status || null,
      balance: top.balance || null,
      accountMasked: top.accountNumberMasked || top.masked || null,
      issues: (top.issues || top.violations || []).slice(0, 5).map((v) => ({
        field: v.field || v.title || v.code || null,
        severity: v.severity || v.priority || null,
        summary: v.summary || v.detail || v.message || null,
      })),
    },
  };
}

function extractConcerns(history = [], concern = '') {
  const userLines = history
    .filter((m) => m.role === 'user' && m.text)
    .map((m) => String(m.text).trim())
    .filter(Boolean);
  if (concern) userLines.push(String(concern).trim());
  // Prefer the latest distinct user intents (skip pure handoff phrases)
  const filtered = userLines.filter((t) => !/^(talk to|connect|live expert|human)/i.test(t));
  const unique = [];
  for (const line of filtered.reverse()) {
    if (!unique.some((u) => u.toLowerCase() === line.toLowerCase())) unique.push(line);
    if (unique.length >= 4) break;
  }
  return unique.reverse();
}

function demoBrief({ subscriber, accountFocus, concerns, context }) {
  const account = accountFocus.account;
  return {
    product: 'fieldwork',
    for_live_agent: true,
    subscriber: {
      name: subscriber.full_name || 'Subscriber',
      email: subscriber.email || '',
      plan_id: subscriber.plan_id,
      mail_credits: subscriber.mail_credits,
      audit_credits: subscriber.audit_credits,
    },
    account_in_question: account,
    concerns: concerns.length ? concerns : ['General campaign guidance'],
    conversation_summary: concerns.length
      ? `Subscriber asked about: ${concerns.join(' · ')}`
      : 'Subscriber requested a live expert without a prior typed concern.',
    workspace_snapshot: {
      audit_summary: context.audit?.summary || null,
      documents: (context.documents || []).slice(0, 8),
      account_count: (context.audit?.accounts || []).length,
    },
    recommended_focus: account
      ? `Review ${account.furnisher} findings and advise next certified packet (opening vs follow-up vs bureau-route).`
      : 'Help subscriber choose next campaign action from their current workspace.',
    urgency: account?.priority === 'high' ? 'high' : 'normal',
  };
}

async function generateAiBrief({ anthropicKey, subscriber, accountFocus, concerns, context, history }) {
  const fallback = demoBrief({ subscriber, accountFocus, concerns, context });
  if (!anthropicKey) return fallback;

  const anthropic = new Anthropic({ apiKey: anthropicKey, maxRetries: 2 });
  const prompt = [
    'You prepare a SHORT handoff brief for a live Fieldwork campaign expert (human).',
    'Return ONLY valid JSON with keys:',
    'account_in_question (object|null), concerns (string[]), conversation_summary (string),',
    'recommended_focus (string), urgency ("normal"|"high"), subscriber_facing_summary (string).',
    'subscriber_facing_summary: 1-2 sentences the subscriber can read confirming what was forwarded.',
    'Never mention CCC or Credit Comeback Club. No legal advice. No score promises.',
    '',
    `Subscriber: ${subscriber.full_name} <${subscriber.email || 'n/a'}> plan=${subscriber.plan_id}`,
    `Detected account focus: ${JSON.stringify(accountFocus.account)}`,
    `Concern lines: ${JSON.stringify(concerns)}`,
    `Audit summary: ${JSON.stringify(context.audit?.summary || null)}`,
    `Recent transcript: ${JSON.stringify((history || []).slice(-8))}`,
  ].join('\n');

  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content.find((b) => b.type === 'text')?.text || '';
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return fallback;
    const parsed = JSON.parse(text.slice(start, end + 1));
    return {
      ...fallback,
      account_in_question: parsed.account_in_question || fallback.account_in_question,
      concerns: Array.isArray(parsed.concerns) && parsed.concerns.length ? parsed.concerns : fallback.concerns,
      conversation_summary: parsed.conversation_summary || fallback.conversation_summary,
      recommended_focus: parsed.recommended_focus || fallback.recommended_focus,
      urgency: parsed.urgency === 'high' ? 'high' : 'normal',
      subscriber_facing_summary: parsed.subscriber_facing_summary || null,
    };
  } catch (err) {
    console.error('fieldwork-expert-handoff brief gen failed', err);
    return fallback;
  }
}

async function notifyWebhook(briefRow) {
  const url = process.env.FIELDWORK_EXPERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'fieldwork.expert_request',
        id: briefRow.id,
        status: briefRow.status,
        account_focus: briefRow.account_focus,
        concern: briefRow.concern,
        subscriber_summary: briefRow.subscriber_summary,
        ai_brief: briefRow.ai_brief,
        created_at: briefRow.created_at,
      }),
    });
  } catch (err) {
    console.error('FIELDWORK_EXPERT_WEBHOOK_URL notify failed', err);
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  let payload = {};
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const history = Array.isArray(payload.history) ? payload.history : [];
  const context = payload.context || {};
  const concern = String(payload.concern || payload.message || '').trim().slice(0, MAX_MESSAGE);
  const openHours = isExpertBusinessHours();

  const accountFocus = pickAccountFocus(context, history, concern);
  const concerns = extractConcerns(history, concern);

  const admin = fwAdmin();
  const user = await requireUser(event);

  // Demo / no auth — still produce a brief so the UI can show the handoff pattern.
  if (!admin || !user) {
    const demoSub = {
      full_name: 'Demo Subscriber',
      email: '',
      plan_id: 'unlimited',
      mail_credits: 8,
      audit_credits: 25,
    };
    const brief = await generateAiBrief({
      anthropicKey: process.env.FIELDWORK_ANTHROPIC_API_KEY,
      subscriber: demoSub,
      accountFocus,
      concerns,
      context,
      history,
    });
    const subscriberSummary = brief.subscriber_facing_summary
      || (accountFocus.label
        ? `I’ve queued a live expert with a brief on ${accountFocus.label} and your concerns.`
        : 'I’ve queued a live expert with a brief on your campaign and concerns.');
    return json(200, {
      product: 'fieldwork',
      isolated: true,
      mode: 'demo',
      handoff: true,
      requestId: `demo_${Date.now()}`,
      status: 'queued',
      account_focus: accountFocus.label,
      concerns: brief.concerns,
      subscriber_summary: subscriberSummary,
      ai_brief: brief,
      outsideHours: !openHours,
      expert_chat_credits: null,
      reply: openHours
        ? `${subscriberSummary} A live expert will pick this up shortly during business hours.`
        : `${subscriberSummary} We’re outside 9am–5pm Mountain right now — your brief is queued for the next open window.`,
    });
  }

  const { data: subscriber, error: subErr } = await admin
    .from('fieldwork_subscribers')
    .select('id, full_name, email, plan_id, mail_credits, audit_credits, expert_chat_credits')
    .eq('user_id', user.id)
    .maybeSingle();

  if (subErr || !subscriber) {
    return json(401, { error: 'No Fieldwork subscriber — finish signup first.' });
  }
  if (subscriber.plan_id !== 'unlimited') {
    return json(403, {
      error: 'Live expert handoff is included on the Campaign plan.',
      plan_id: subscriber.plan_id,
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
      error: 'Could not reserve an expert-chat credit for this handoff.',
      expert_chat_credits: remaining,
    });
  }

  const brief = await generateAiBrief({
    anthropicKey: process.env.FIELDWORK_ANTHROPIC_API_KEY,
    subscriber,
    accountFocus,
    concerns,
    context,
    history,
  });

  const subscriberSummary = brief.subscriber_facing_summary
    || (accountFocus.label
      ? `I’ve sent a live expert a brief on ${accountFocus.label} covering your concerns.`
      : 'I’ve sent a live expert a brief on your campaign covering your concerns.');

  const row = {
    subscriber_id: subscriber.id,
    status: 'queued',
    concern: concerns.join(' · ') || concern || 'Live expert requested',
    account_focus: accountFocus.label || '',
    subscriber_summary: subscriberSummary,
    ai_brief: brief,
    transcript_json: history.slice(-20),
  };

  const { data: created, error: insErr } = await admin
    .from('fieldwork_expert_requests')
    .insert(row)
    .select('id, status, account_focus, concern, subscriber_summary, ai_brief, created_at')
    .single();

  if (insErr || !created) {
    await admin
      .from('fieldwork_subscribers')
      .update({
        expert_chat_credits: remaining,
        updated_at: new Date().toISOString(),
      })
      .eq('id', subscriber.id);
    return json(500, {
      error: insErr?.message || 'Could not queue live expert request',
      expert_chat_credits: remaining,
    });
  }

  await notifyWebhook(created);

  const reply = openHours
    ? `${subscriberSummary} A live expert will pick this up shortly.`
    : `${subscriberSummary} We’re outside 9am–5pm Mountain — your brief is already in the queue for the next open window.`;

  return json(200, {
    product: 'fieldwork',
    isolated: true,
    mode: 'queued',
    handoff: true,
    requestId: created.id,
    status: created.status,
    account_focus: created.account_focus,
    concerns: brief.concerns,
    subscriber_summary: subscriberSummary,
    // Subscriber sees confirmation; full ai_brief is for agents / webhook.
    ai_brief: brief,
    outsideHours: !openHours,
    expert_chat_credits: reserved.expert_chat_credits,
    reply,
  });
};
