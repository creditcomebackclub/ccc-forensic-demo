/**
 * Fieldwork furnisher-response analysis (+ optional Pro/Campaign follow-up draft).
 * FIELDWORK_ANTHROPIC_API_KEY only — never CCC Anthropic keys.
 */
import Anthropic from '@anthropic-ai/sdk';
import {
  FIELDWORK_RESPONSE_SCHEMA,
  getFieldworkFollowUpLetterPrompt,
  getFieldworkResponseSystemPrompt,
} from '../../src/prompts/fieldworkResponsePrompt.js';
import { DEMO_RESPONSE_ANALYSIS } from '../../src/diy/adapters/demoResponseAnalysis.js';
import { buildFieldworkLetter } from '../../src/diy/adapters/buildFieldworkLetter.js';
import {
  FIELDWORK_LETTER_CSS,
  wrapFieldworkLetterHtml,
  isFieldworkLetterHtml,
} from '../../src/diy/adapters/fieldworkLetterCss.js';

const MODEL = 'claude-sonnet-5';

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

function stripProductChrome(html) {
  return String(html || '')
    .replace(/<p[^>]*class=["'][^"']*fw-letter-mark[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<p[^>]*class=["'][^"']*fw-phase[^"']*["'][^>]*>[\s\S]*?<\/p>/gi, '')
    .replace(/<[^>]*>\s*Fieldwork\s*\.?\s*<\/[^>]*>/gi, '')
    .replace(/PHASE\s*[12]\s*[—\-].*?(?=<\/|$)/gi, '');
}

function injectSignature(html, signatureData) {
  if (!html || !signatureData) return html;
  const safe = String(signatureData).replace(/"/g, '&quot;');
  const img = `<img src="${safe}" alt="Signature" style="max-height:56px;max-width:220px;display:block;" />`;
  if (/class=["'][^"']*sig-line[^"']*["'][^>]*>\s*</i.test(html)) {
    return html.replace(/(class=["'][^"']*sig-line[^"']*["'][^>]*>)(\s*)</i, `$1${img}<`);
  }
  if (/_{3,}/.test(html)) return html.replace(/_{3,}/, img);
  return html;
}

function injectFieldworkCss(html) {
  if (!html) return html;
  let out = stripProductChrome(html.trim());
  out = out.replace(/<style[\s\S]*?<\/style>/gi, '');
  if (out.includes('</head>')) {
    out = out.replace('</head>', `<style>${FIELDWORK_LETTER_CSS}</style></head>`);
  } else if (out.includes('<body>')) {
    out = out.replace('<body>', `<head><meta charset="UTF-8"><style>${FIELDWORK_LETTER_CSS}</style></head><body>`);
  } else if (isFieldworkLetterHtml(out) || /<table/i.test(out)) {
    out = wrapFieldworkLetterHtml(out);
  } else {
    return null;
  }
  return out;
}

function responseFileBlock(file) {
  const mediaType = file.mediaType || file.type || 'application/pdf';
  const data = file.base64 || file.data;
  if (!data) return null;
  if (String(mediaType).startsWith('image/')) {
    return {
      type: 'image',
      source: { type: 'base64', media_type: mediaType, data },
    };
  }
  return {
    type: 'document',
    source: { type: 'base64', media_type: mediaType === 'application/pdf' ? 'application/pdf' : mediaType, data },
  };
}

function canDraft(planId) {
  return planId === 'pro' || planId === 'unlimited';
}

function normalizeAnalysis(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEMO_RESPONSE_ANALYSIS };
  return {
    classification: raw.classification || DEMO_RESPONSE_ANALYSIS.classification,
    summary: raw.summary || DEMO_RESPONSE_ANALYSIS.summary,
    demandAnalysis: Array.isArray(raw.demandAnalysis) ? raw.demandAnalysis : DEMO_RESPONSE_ANALYSIS.demandAnalysis,
    admissions: Array.isArray(raw.admissions) ? raw.admissions : [],
    talkingPoints: Array.isArray(raw.talkingPoints) && raw.talkingPoints.length
      ? raw.talkingPoints
      : DEMO_RESPONSE_ANALYSIS.talkingPoints,
    followUpLeverage: raw.followUpLeverage || DEMO_RESPONSE_ANALYSIS.followUpLeverage,
    documentQuality: raw.documentQuality || { enclosureLegible: true, issues: [] },
  };
}

async function resolvePlanId(event, bodyPlanId) {
  if (bodyPlanId && ['starter', 'pro', 'unlimited'].includes(bodyPlanId)) {
    return bodyPlanId;
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.FIELDWORK_SUPABASE_URL;
    const anon = process.env.FIELDWORK_SUPABASE_ANON_KEY;
    const service = process.env.FIELDWORK_SUPABASE_SERVICE_ROLE_KEY;
    const auth = event.headers?.authorization || event.headers?.Authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!url || !anon || !token) return bodyPlanId || 'pro';

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user || !service) return bodyPlanId || 'pro';

    const admin = createClient(url, service, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: sub } = await admin
      .from('fieldwork_subscribers')
      .select('plan_id')
      .eq('user_id', userData.user.id)
      .maybeSingle();
    return sub?.plan_id || bodyPlanId || 'pro';
  } catch {
    return bodyPlanId || 'pro';
  }
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' } };
  }
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let payload;
  try {
    let raw = event.body || '{}';
    if (event.isBase64Encoded) raw = Buffer.from(raw, 'base64').toString('utf8');
    payload = JSON.parse(raw);
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const {
    user,
    account,
    priorLetterHtml,
    files = [],
    nonResponse = false,
    draft = false,
    planId: bodyPlanId,
    tone = 'Standard',
  } = payload || {};

  if (!user?.name || !account?.furnisher) {
    return json(400, { error: 'user + account required' });
  }

  const planId = await resolvePlanId(event, bodyPlanId);
  const wantDraft = Boolean(draft);
  if (wantDraft && !canDraft(planId)) {
    return json(403, {
      error: 'Auto-drafted follow-up letters are on Pro and Campaign. Starter includes analysis + talking points.',
      plan_id: planId,
      upgrade: true,
    });
  }

  const anthropicKey = process.env.FIELDWORK_ANTHROPIC_API_KEY;
  let analysis = { ...DEMO_RESPONSE_ANALYSIS };
  let mode = 'demo';

  if (nonResponse) {
    analysis = {
      ...DEMO_RESPONSE_ANALYSIS,
      classification: 'NON_RESPONSE',
      summary:
        'No furnisher response arrived within the 30-day window. The failure to respond is itself evidence of an inadequate investigation trail for your follow-up.',
      demandAnalysis: (account.violations || []).map((v) => ({
        demand: `Correct Metro 2 Field ${v.field} (${v.fieldName})`,
        outcome: 'IGNORED',
        notes: 'No response received addressing this demand.',
      })),
      talkingPoints: [
        'State the prior certified mail date and that no substantive response arrived in 30 days.',
        'Restate every Metro 2 field demand from the opening letter.',
        'Cite Johnson v. MBNA — silence is not a reasonable investigation.',
        'Enclose the prior letter and return receipt in the follow-up packet.',
        'Set a new 30-day deadline in writing.',
      ],
      followUpLeverage:
        'Your failure to respond within thirty days to a direct furnisher dispute is itself a record of inadequate investigation.',
      admissions: [],
    };
    mode = 'non-response';
  } else if (anthropicKey && (files.length || priorLetterHtml)) {
    try {
      const anthropic = new Anthropic({
        apiKey: anthropicKey,
        maxRetries: 2,
        timeout: 3 * 60 * 1000,
      });

      const content = [
        {
          type: 'text',
          text: [
            `Today is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
            'Analyze the furnisher response against the prior dispute. Fill the JSON schema.',
            '',
            'Consumer:',
            JSON.stringify({ name: user.name, address: user.address }, null, 2),
            '',
            'Account + violations:',
            JSON.stringify(account, null, 2),
            '',
            priorLetterHtml
              ? `Prior letter HTML (Exhibit A excerpt follows):\n${String(priorLetterHtml).slice(0, 24000)}`
              : 'Prior letter HTML not provided — use account violations as the demand list.',
          ].join('\n'),
        },
      ];

      for (const file of files.slice(0, 8)) {
        const block = responseFileBlock(file);
        if (block) content.push(block);
      }
      if (!files.length) {
        content.push({
          type: 'text',
          text: 'No response file attached — classify from context if the user indicated a form-letter reply, otherwise use FORM_LETTER with low confidence notes.',
        });
      }

      const msg = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: getFieldworkResponseSystemPrompt(),
        messages: [{ role: 'user', content }],
        output_config: {
          format: {
            type: 'json_schema',
            schema: FIELDWORK_RESPONSE_SCHEMA,
          },
        },
      });

      const text = (msg.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      const parsed = JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
      analysis = normalizeAnalysis(parsed);
      mode = 'engine';
    } catch (err) {
      console.error('fieldwork-analyze-response analysis failed', err);
      analysis = normalizeAnalysis(DEMO_RESPONSE_ANALYSIS);
      mode = 'demo-fallback';
    }
  }

  let followUpLetter = null;
  let draftMode = null;

  if (wantDraft) {
    const fallbackLetter = buildFieldworkLetter(user, account, 'phase2', analysis);
    followUpLetter = fallbackLetter;
    draftMode = 'local';

    if (anthropicKey) {
      try {
        const anthropic = new Anthropic({
          apiKey: anthropicKey,
          maxRetries: 2,
          timeout: 3 * 60 * 1000,
        });
        const instructions = [
          `Today is ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
          'Generate ONE plain consumer HTML follow-up dispute letter.',
          'Do NOT include Fieldwork branding or phase banners.',
          '',
          'Consumer:',
          JSON.stringify(user, null, 2),
          '',
          'Account:',
          JSON.stringify(account, null, 2),
          '',
          'Response analysis JSON:',
          JSON.stringify(analysis, null, 2),
        ].join('\n');

        const msg = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 10000,
          system: getFieldworkFollowUpLetterPrompt(tone),
          messages: [{ role: 'user', content: instructions }],
        });

        let letter = (msg.content || [])
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        letter = letter.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
        letter = injectFieldworkCss(letter);
        letter = injectSignature(letter, user.signatureData);

        if (letter && letter.length >= 400 && /id-table/i.test(letter)) {
          followUpLetter = letter;
          draftMode = 'engine';
        } else {
          followUpLetter = injectSignature(fallbackLetter, user.signatureData) || fallbackLetter;
          draftMode = 'local-fallback';
        }
      } catch (err) {
        console.error('fieldwork-analyze-response draft failed', err);
        followUpLetter = injectSignature(fallbackLetter, user.signatureData) || fallbackLetter;
        draftMode = 'local-fallback';
      }
    } else {
      followUpLetter = injectSignature(fallbackLetter, user.signatureData) || fallbackLetter;
    }
  }

  return json(200, {
    product: 'fieldwork',
    isolated: true,
    mode,
    plan_id: planId,
    canDraft: canDraft(planId),
    analysis,
    followUpLetter: wantDraft ? followUpLetter : null,
    draftMode: wantDraft ? draftMode : null,
    format: wantDraft ? 'html' : null,
  });
};
