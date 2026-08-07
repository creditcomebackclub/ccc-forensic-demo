// Shared transactional email transport (Resend).
// All CCC Netlify mailers should send through this helper so From, auth,
// attachments, tags, and branded HTML stay consistent. Do not call api.sendgrid.com.

const DEFAULT_FROM = 'Credit Comeback Club <chris@cccpartners.co>';
const RESEND_API = 'https://api.resend.com/emails';

const BRAND = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  border: '#E5E7EB',
  portalUrl: process.env.APP_ORIGIN || 'https://ccc-forensic-demo.netlify.app',
  phone: '970-644-0063',
  site: 'creditcomebackclub.com',
};

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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Standard CCC branded transactional email shell (navy/gold header + footer).
 * Pass bodyHtml as trusted HTML fragments you build; escape any user text first.
 *
 * @param {{
 *   eyebrow?: string,
 *   bodyHtml: string,
 *   cta?: { href?: string, label: string } | null,
 *   tone?: 'default'|'warning'|'urgent',
 *   preheader?: string,
 * }} opts
 *   cta: omit for default portal button; pass null to hide; or { href, label }
 */
function wrapClientEmail(opts = {}) {
  const eyebrow = escapeHtml(opts.eyebrow || 'Credit Comeback Club');
  const bodyHtml = String(opts.bodyHtml || '');
  const tone = opts.tone || 'default';
  const headerBg = tone === 'urgent' ? '#7F1D1D' : tone === 'warning' ? '#92400E' : BRAND.navy;
  const accent = tone === 'urgent' ? '#FECACA' : tone === 'warning' ? '#FDE68A' : BRAND.gold;
  const cta = opts.cta;
  const showCta = cta !== null;
  const ctaHref = escapeHtml((cta && cta.href) || BRAND.portalUrl);
  const ctaLabel = escapeHtml((cta && cta.label) || 'Open your portal →');
  const ctaBlock = showCta
    ? `<div style="text-align:center;margin:28px 0 8px;">`
      + `<a href="${ctaHref}" style="background:${BRAND.navy};color:${BRAND.gold};padding:14px 28px;text-decoration:none;border-radius:4px;font-weight:bold;font-size:14px;display:inline-block;">${ctaLabel}</a>`
      + `</div>`
    : '';
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(opts.preheader)}</div>`
    : '';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">
      <tr><td style="background:${headerBg};padding:24px 32px;border-radius:6px 6px 0 0;">
        <h1 style="color:${accent};margin:0;font-size:20px;font-weight:700;">Credit Comeback Club</h1>
        <p style="color:#ffffff;margin:6px 0 0;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">${eyebrow}</p>
      </td></tr>
      <tr><td style="background:#ffffff;border:1px solid ${BRAND.border};border-top:none;padding:28px 32px;border-radius:0 0 6px 6px;font-size:14px;line-height:1.65;">
        ${bodyHtml}
        ${ctaBlock}
        <hr style="border:none;border-top:1px solid ${BRAND.border};margin:28px 0 16px;">
        <p style="font-size:11px;color:${BRAND.faint};margin:0;line-height:1.5;">Credit Comeback Club · Grand Junction, CO · ${BRAND.phone} · ${BRAND.site}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

/**
 * Staff/ops alert shell with optional detail rows and CRM CTA.
 * @param {{ eyebrow: string, title: string, rows?: Array<[string,string]>, footer?: string, ctaLabel?: string }} opts
 */
function wrapStaffEmail({ eyebrow, title, rows, footer, ctaLabel } = {}) {
  const rowHtml = (rows || []).map(([k, v]) => (
    `<tr><td style="padding:10px 14px;font-weight:600;width:140px;border-bottom:1px solid #F3F4F6;">${escapeHtml(k)}</td>`
    + `<td style="padding:10px 14px;border-bottom:1px solid #F3F4F6;">${v != null && v !== '' ? escapeHtml(v) : '—'}</td></tr>`
  )).join('');
  return wrapClientEmail({
    eyebrow: eyebrow || 'Staff Alert',
    bodyHtml: `<p style="margin:0 0 8px;"><strong>${escapeHtml(title || '')}</strong></p>`
      + (rowHtml ? `<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:13px;">${rowHtml}</table>` : '')
      + (footer || ''),
    cta: { href: BRAND.portalUrl, label: ctaLabel || 'Open CRM →' },
  });
}

/**
 * Send one transactional email via Resend.
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
  BRAND,
  escapeHtml,
  wrapClientEmail,
  wrapStaffEmail,
};
