const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { DOCUMENTS_BUCKET, lpoaSignaturePath, lpoaDocumentPath, serviceAgreementDocumentPath, buildLpoaSignatureRecord } = require('./_storagePaths.cjs');
const { loadAttorneySignatureDataUrl, attorneySignatureImgTag } = require('./_attorneySig.cjs');
const { escapeHtml, sha256, LPOA_TEXT, ELECTRONIC_ACKNOWLEDGEMENT_TEXT, renderPacket, renderLpoaOnly } = require('./_serviceAgreement.cjs');
const { sendEmail, isConfigured, wrapClientEmail } = require('./_email.cjs');

const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });

async function rest(path, method, body, url, key, prefer = 'return=representation') {
  const res = await fetch(url + path, { method, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: prefer }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const raw = await res.text(); let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = raw; }
  if (!res.ok) throw new Error(typeof data === 'object' && data?.message ? data.message : `Database request failed (${res.status})`);
  return data;
}

async function upload(path, bytes, contentType, url, key) {
  const res = await fetch(url + '/storage/v1/object/' + DOCUMENTS_BUCKET + '/' + path.split('/').map(encodeURIComponent).join('/'), {
    method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': contentType, 'Content-Length': String(bytes.length), 'x-upsert': 'false' }, body: bytes,
  });
  if (!res.ok) throw new Error(`Secure document upload failed (${res.status}).`);
}

async function event(agreementId, type, actorType, data, url, key, ip, userAgent) {
  await rest('/rest/v1/client_service_agreement_events', 'POST', {
    agreement_id: agreementId, event_type: type, actor_type: actorType, event_data: data || {}, ip_address: ip || null, user_agent: userAgent || null,
  }, url, key, 'return=minimal');
}

function plainText(html) {
  return String(html || '').replace(/<\/(p|div|h[1-6]|li|br|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
}

function displayText(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n\n');
}

function wrapText(text, max = 92) {
  const words = String(text || '').split(/\s+/); const lines = []; let line = '';
  for (const word of words) { if ((line + ' ' + word).trim().length > max && line) { lines.push(line); line = word; } else line = (line + ' ' + word).trim(); }
  if (line) lines.push(line); return lines;
}

async function buildFinalPdf({ client, plan, signedAt, termsHtml, signatureData, attorneyData }) {
  const pdf = await PDFDocument.create(); const regular = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const clientSignature = await pdf.embedPng(Buffer.from(signatureData.replace(/^data:image\/png;base64,/, ''), 'base64'));
  const attorneySignature = await pdf.embedPng(Buffer.from(attorneyData.replace(/^data:image\/png;base64,/, ''), 'base64'));
  let page = pdf.addPage([612, 792]); let y = 752;
  const nextPage = () => { page = pdf.addPage([612, 792]); y = 752; };
  const line = (text, opts = {}) => { const size = opts.size || 10; if (y < 52) nextPage(); page.drawText(String(text), { x: opts.x || 48, y, size, font: opts.bold ? bold : regular, color: opts.color || rgb(0.08, 0.1, 0.16), maxWidth: opts.width || 516 }); y -= opts.leading || (size + 4); };
  const paragraph = (text) => { for (const row of wrapText(text)) line(row); y -= 5; };
  page.drawRectangle({ x: 0, y: 720, width: 612, height: 72, color: rgb(0.106, 0.165, 0.29) });
  page.drawText('Credit Comeback Club', { x: 48, y: 758, size: 18, font: bold, color: rgb(0.79, 0.66, 0.3) });
  page.drawText('Client Service Agreement & Limited Power of Attorney', { x: 48, y: 738, size: 10, font: regular, color: rgb(1, 1, 1) }); y = 700;
  line(`Client: ${client.name}`, { bold: true }); line(`Packet signed: ${new Date(signedAt).toLocaleString('en-US')}`); line(`Selected plan: ${plan.label}`, { bold: true }); paragraph(`Plan terms snapshot: ${plan.feeText}. No payment is created or collected by this signing packet.`);
  line('SERVICE AGREEMENT', { bold: true, size: 11, color: rgb(0.106, 0.165, 0.29) }); paragraph(plainText(termsHtml));
  line('LIMITED POWER OF ATTORNEY', { bold: true, size: 11, color: rgb(0.106, 0.165, 0.29) }); paragraph(LPOA_TEXT);
  line('ELECTRONIC RECORDS AND ACKNOWLEDGEMENTS', { bold: true, size: 11, color: rgb(0.106, 0.165, 0.29) }); paragraph(ELECTRONIC_ACKNOWLEDGEMENT_TEXT);
  if (y < 150) nextPage();
  page.drawLine({ start: { x: 48, y: y - 54 }, end: { x: 280, y: y - 54 }, thickness: 0.7, color: rgb(0, 0, 0) }); page.drawLine({ start: { x: 330, y: y - 54 }, end: { x: 564, y: y - 54 }, thickness: 0.7, color: rgb(0, 0, 0) });
  page.drawImage(clientSignature, { x: 52, y: y - 48, width: 150, height: Math.min(44, (clientSignature.height / clientSignature.width) * 150) }); page.drawImage(attorneySignature, { x: 334, y: y - 48, width: 150, height: Math.min(44, (attorneySignature.height / attorneySignature.width) * 150) });
  page.drawText(`${client.signerName || client.name} — Client`, { x: 48, y: y - 68, size: 9, font: regular }); page.drawText('Christopher Holland — Credit Comeback Club', { x: 330, y: y - 68, size: 9, font: regular });
  page.drawText('Credit Comeback Club · Grand Junction, CO 81504 · 970-644-0063 · creditcomebackclub.com', { x: 48, y: 28, size: 8, font: regular, color: rgb(0.35, 0.38, 0.43) });
  return Buffer.from(await pdf.save());
}

async function inviteClientPortal({ client, url, key, origin }) {
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = String(client.email || '').trim().toLowerCase();
  if (!email) throw new Error('Client has no email address for the portal invite.');
  const { error: createError } = await sb.auth.admin.createUser({ email, email_confirm: true, user_metadata: { full_name: client.name } });
  if (createError && !/already\s+(been\s+)?(registered|exists)|email[_ ]exists/i.test(createError.message || '')) throw new Error(createError.message);
  const { data: linkData, error: linkError } = await sb.auth.admin.generateLink({ type: 'magiclink', email, options: { redirectTo: `${origin.replace(/\/$/, '')}/login` } });
  if (linkError || !linkData?.user?.id || !linkData?.properties?.action_link) throw new Error(linkError?.message || 'Could not generate portal link.');
  const profiles = await rest('/rest/v1/client_profiles?email=eq.' + encodeURIComponent(email) + '&select=id,client_id&limit=1', 'GET', undefined, url, key);
  const profile = profiles?.[0];
  if (profile?.client_id && profile.client_id !== client.id) throw new Error('This email is already linked to another client portal.');
  const patch = { user_id: linkData.user.id, client_id: client.id, full_name: client.name, agreement_signed_at: new Date().toISOString() };
  if (profile) await rest('/rest/v1/client_profiles?id=eq.' + encodeURIComponent(profile.id), 'PATCH', patch, url, key, 'return=minimal');
  else await rest('/rest/v1/client_profiles', 'POST', { ...patch, email, onboarding_complete: false }, url, key, 'return=minimal');
  if (isConfigured()) {
    await sendEmail({
      to: email, subject: 'Your Credit Comeback Club portal is ready',
      html: wrapClientEmail({ eyebrow: 'Welcome to Your Client Portal', bodyHtml: `<p>Hi ${escapeHtml(client.name)},</p><p>Your agreement has been completed. Your secure client portal is now ready for enrollment documents, updates, and your agreement record.</p>`, cta: { href: linkData.properties.action_link, label: 'Access your portal →' } }),
      tags: { kind: 'portal_invite_after_agreement' },
    });
  }
  return { invitationSent: isConfigured() };
}

async function findAgreement(token, url, key) {
  if (!token || token.length < 40) return null;
  const rows = await rest('/rest/v1/client_service_agreements?signing_token_hash=eq.' + encodeURIComponent(sha256(token))
    + '&select=id,user_id,client_id,template_id,template_version,status,plan_snapshot,client_snapshot,signing_expires_at,sent_at', 'GET', undefined, url, key);
  return rows?.[0] || null;
}

exports.handler = async (eventReq) => {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return json(500, { error: 'Server not configured' });
  let payload;
  try { payload = eventReq.body ? JSON.parse(eventReq.body) : {}; } catch { return json(400, { error: 'Invalid JSON' }); }
  const action = payload.action || 'load';
  const token = String(payload.token || '');
  if (!['load', 'sign'].includes(action)) return json(400, { error: 'Unknown signing action.' });
  try {
    const agreement = await findAgreement(token, url, key);
    if (!agreement) return json(404, { error: 'This signing link is invalid.' });
    const expires = agreement.signing_expires_at && new Date(agreement.signing_expires_at).getTime();
    if (agreement.status !== 'sent' || !expires || expires <= Date.now()) {
      if (agreement.status === 'sent' && expires && expires <= Date.now()) {
        await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(agreement.id) + '&status=eq.sent', 'PATCH', { status: 'expired' }, url, key, 'return=minimal');
        await event(agreement.id, 'expired', 'system', {}, url, key);
      }
      return json(410, { error: agreement.status === 'signed' ? 'This agreement has already been signed.' : 'This signing link has expired or was replaced.' });
    }
    const templates = await rest('/rest/v1/service_agreement_templates?id=eq.' + encodeURIComponent(agreement.template_id) + '&select=legal_status,body_html&limit=1', 'GET', undefined, url, key);
    const template = templates?.[0];
    if (template?.legal_status !== 'approved' || !String(template.body_html || '').trim()) return json(409, { error: 'This agreement is awaiting counsel approval and cannot be signed.' });
    if (action === 'load') {
      const ip = eventReq.headers['x-forwarded-for'] || null;
      const userAgent = eventReq.headers['user-agent'] || null;
      await event(agreement.id, 'viewed', 'client', {}, url, key, ip, userAgent).catch((viewError) => console.error('agreement-sign viewed event:', viewError.message));
      return json(200, { agreement: {
        clientName: agreement.client_snapshot.name,
        plan: agreement.plan_snapshot,
        expiresAt: agreement.signing_expires_at,
        templateVersion: agreement.template_version,
        serviceAgreementText: displayText(template.body_html),
        lpoaText: LPOA_TEXT,
        electronicAcknowledgementText: ELECTRONIC_ACKNOWLEDGEMENT_TEXT,
        acknowledgementRequired: ['service_agreement', 'limited_power_of_attorney', 'electronic_records'],
      } });
    }
    if (!payload.acknowledgements?.service_agreement || !payload.acknowledgements?.limited_power_of_attorney || !payload.acknowledgements?.electronic_records) return json(400, { error: 'All agreement acknowledgements are required.' });
    const signatureData = String(payload.signatureData || '');
    if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(signatureData) || signatureData.length > 1_100_000) return json(400, { error: 'A valid drawn PNG signature is required.' });
    const signedAt = new Date().toISOString();
    const client = { ...agreement.client_snapshot, signerName: String(payload.signerName || agreement.client_snapshot.name).trim() || agreement.client_snapshot.name };
    const sigHtml = `<img src="${signatureData}" style="max-height:56px;max-width:220px;" alt="Client signature">`;
    const attorneySig = attorneySignatureImgTag(await loadAttorneySignatureDataUrl(url, key));
    const packetHtml = renderPacket({ client, plan: agreement.plan_snapshot, signedAt, clientSignatureHtml: sigHtml, attorneySignatureHtml: attorneySig, approved: true, approvedTermsHtml: template.body_html });
    const lpoaHtml = renderLpoaOnly({ client, plan: agreement.plan_snapshot, signedAt, clientSignatureHtml: sigHtml, attorneySignatureHtml: attorneySig });
    const packetBytes = Buffer.from(packetHtml, 'utf8');
    const packetPdf = await buildFinalPdf({ client, plan: agreement.plan_snapshot, signedAt, termsHtml: template.body_html, signatureData, attorneyData: await loadAttorneySignatureDataUrl(url, key) });
    const lpoaBytes = Buffer.from(lpoaHtml, 'utf8');
    const sigBytes = Buffer.from(signatureData.replace(/^data:image\/png;base64,/, ''), 'base64');
    const documentHash = crypto.createHash('sha256').update(packetPdf).digest('hex');
    const packetPath = serviceAgreementDocumentPath(agreement.user_id, agreement.client_id, agreement.id, 'pdf');
    const packetHtmlPath = serviceAgreementDocumentPath(agreement.user_id, agreement.client_id, agreement.id, 'html');
    await upload(packetPath, packetPdf, 'application/pdf', url, key);
    await upload(packetHtmlPath, packetBytes, 'text/html', url, key);
    await upload(lpoaSignaturePath(agreement.user_id, agreement.client_id), sigBytes, 'image/png', url, key);
    await upload(lpoaDocumentPath(agreement.user_id, agreement.client_id), lpoaBytes, 'text/html', url, key);
    const signed = await rest('/rest/v1/client_service_agreements?id=eq.' + encodeURIComponent(agreement.id) + '&status=eq.sent', 'PATCH', {
      status: 'signed', signed_at: signedAt, signed_document_path: packetPath, signed_document_hash: documentHash,
    }, url, key);
    if (!signed?.[0]) return json(409, { error: 'This agreement was already completed or replaced.' });
    const ip = eventReq.headers['x-forwarded-for'] || null;
    const userAgent = eventReq.headers['user-agent'] || null;
    await event(agreement.id, 'signed', 'client', { acknowledgements: payload.acknowledgements, documentHash, packetHtmlPath }, url, key, ip, userAgent);
    const lpoaRecord = buildLpoaSignatureRecord({ firmUserId: agreement.user_id, clientId: agreement.client_id, signedAt, method: 'Canvas signature — agreement signing packet', documentHash, ip, lpoaType: 'standard' });
    await rest('/rest/v1/clients?id=eq.' + encodeURIComponent(agreement.client_id), 'PATCH', {
      engagement_status: 'active', engagement_status_changed_at: signedAt, lpoa_signed: true, lpoa_signed_at: signedAt, lpoa_signature_data: lpoaRecord,
    }, url, key, 'return=minimal');
    try {
      const invite = await inviteClientPortal({ client: { id: agreement.client_id, ...agreement.client_snapshot }, url, key, origin: process.env.APP_URL || eventReq.headers.origin || 'https://ccc-forensic-demo.netlify.app' });
      await event(agreement.id, 'portal_invited', 'system', invite, url, key);
    } catch (inviteError) {
      await event(agreement.id, 'portal_invited', 'system', { invitationSent: false, error: inviteError.message }, url, key);
      console.error('agreement-sign portal invite:', inviteError.message);
    }
    return json(200, { signed: true });
  } catch (error) {
    console.error('agreement-sign:', error.message);
    return json(500, { error: error.message || 'Could not complete agreement signing.' });
  }
};
