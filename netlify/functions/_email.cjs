// Shared transactional email transport (Resend).
// All CCC Netlify mailers should send through this helper so From, auth,
// attachments, and tags stay consistent. Do not call api.sendgrid.com.

const DEFAULT_FROM = 'Credit Comeback Club <chris@cccpartners.co>';
const RESEND_API = 'https://api.resend.com/emails';

function requireApiKey() {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY is not configured — add it to Netlify env vars.');
  return key;
}

function normalizeTo(to) {
  if (Array.isArray(to)) return to.map((v) => String(v).trim()).filter(Boolean);
  const one = String(to || '').trim();
  return one ? [one] : [];
}

function normalizeAttachments(attachments) {
  if (!attachments || !attachments.length) return undefined;
  return attachments.map((item) => {
    const filename = item.filename || item.name || 'attachment.bin';
    const content = item.content;
    if (!content) throw new Error('Email attachment is missing content.');
    const out = { filename, content: String(content) };
    if (item.type || item.content_type || item.contentType) {
      out.content_type = item.type || item.content_type || item.contentType;
    }
    return out;
  });
}

function normalizeTags(tags) {
  if (!tags) return undefined;
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => {
        if (!tag) return null;
        if (typeof tag === 'string') return null;
        const name = String(tag.name || '').trim();
        const value = String(tag.value ?? '').trim();
        if (!name || !value) return null;
        return { name, value };
      })
      .filter(Boolean);
  }
  // Object map → Resend tag array
  return Object.entries(tags)
    .map(([name, value]) => ({ name: String(name), value: String(value) }))
    .filter((t) => t.name && t.value);
}

/**
 * Send one transactional email via Resend.
 * @param {{
 *   to: string|string[],
 *   subject: string,
 *   html: string,
 *   text?: string,
 *   cc?: string|string[],
 *   bcc?: string|string[],
 *   from?: string,
 *   replyTo?: string|string[],
 *   attachments?: Array<{ filename: string, content: string, type?: string }>,
 *   tags?: Array<{ name: string, value: string }>|Record<string,string>,
 * }} opts
 * @returns {Promise<string>} Resend email id
 */
async function sendEmail(opts) {
  const apiKey = requireApiKey();
  const to = normalizeTo(opts.to);
  if (!to.length) throw new Error('A recipient email is required.');
  if (!String(opts.subject || '').trim()) throw new Error('Email subject is required.');
  if (!String(opts.html || '').trim()) throw new Error('Email html is required.');

  const body = {
    from: opts.from || DEFAULT_FROM,
    to,
    subject: String(opts.subject).trim(),
    html: String(opts.html),
  };
  if (opts.text != null) body.text = String(opts.text);
  const cc = normalizeTo(opts.cc);
  if (cc.length) body.cc = cc;
  const bcc = normalizeTo(opts.bcc);
  if (bcc.length) body.bcc = bcc;
  const replyTo = normalizeTo(opts.replyTo || opts.reply_to);
  if (replyTo.length) body.reply_to = replyTo.length === 1 ? replyTo[0] : replyTo;
  const attachments = normalizeAttachments(opts.attachments);
  if (attachments) body.attachments = attachments;
  const tags = normalizeTags(opts.tags);
  if (tags && tags.length) body.tags = tags;

  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = (parsed && (parsed.message || parsed.error)) || raw || res.statusText;
    throw new Error(`Resend error ${res.status}: ${detail}`);
  }
  const id = parsed && parsed.id;
  if (!id) throw new Error('Resend response did not include an email id.');
  return id;
}

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

module.exports = {
  sendEmail,
  isConfigured,
  DEFAULT_FROM,
};
