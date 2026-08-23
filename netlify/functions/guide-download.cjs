const fs = require('node:fs');
const path = require('node:path');
const { verifyGuideDownloadToken } = require('./_guideDownloadToken.cjs');

const GUIDE_FILENAME = 'credit-comeback-club-credit-report-field-guide.pdf';
const GUIDE_PATH = path.join(__dirname, 'assets', GUIDE_FILENAME);

const DOWNLOAD_HEADERS = {
  'Content-Type': 'application/pdf',
  'Content-Disposition': `attachment; filename="${GUIDE_FILENAME}"`,
  'Cache-Control': 'no-store, private, max-age=0',
  Pragma: 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
};

function textResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
    body,
  };
}

function serviceHeaders(serviceKey, hasBody = false) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function parseJsonResponse(response) {
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; }
  catch (_error) { return null; }
}

async function recordDownload({ leadId, supabaseUrl, serviceKey }) {
  const lookup = await fetch(
    `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}&select=id,tags&limit=1`,
    { headers: serviceHeaders(serviceKey) },
  );
  const rows = await parseJsonResponse(lookup);
  const lead = lookup.ok && Array.isArray(rows) ? rows[0] : null;
  if (!lead?.id) throw new Error('guide lead unavailable');

  const tags = Array.isArray(lead.tags) ? lead.tags.map(String) : [];
  if (tags.includes('guide:downloaded')) return;

  const update = await fetch(
    `${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}`,
    {
      method: 'PATCH',
      headers: { ...serviceHeaders(serviceKey, true), Prefer: 'return=minimal' },
      body: JSON.stringify({ tags: [...new Set([...tags, 'guide:downloaded'])] }),
    },
  );
  if (!update.ok) throw new Error('guide tracking update failed');
}

function readGuideBase64() {
  const guide = fs.readFileSync(GUIDE_PATH);
  if (!guide.length || guide.subarray(0, 5).toString('ascii') !== '%PDF-') {
    throw new Error('guide asset is invalid');
  }
  return guide.toString('base64');
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return textResponse(405, 'Method Not Allowed');

  const supabaseUrl = String(process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  if (!supabaseUrl || !serviceKey) return textResponse(503, 'Guide download is temporarily unavailable.');

  const leadId = verifyGuideDownloadToken(event.queryStringParameters?.token, serviceKey);
  if (!leadId) return textResponse(400, 'This guide link is invalid or expired.');

  try {
    const body = readGuideBase64();
    await recordDownload({ leadId, supabaseUrl, serviceKey });
    return {
      statusCode: 200,
      headers: DOWNLOAD_HEADERS,
      body,
      isBase64Encoded: true,
    };
  } catch (error) {
    console.error('Guide download unavailable:', error.message || error);
    return textResponse(503, 'Guide download is temporarily unavailable.');
  }
};

exports._test = { GUIDE_FILENAME, GUIDE_PATH, readGuideBase64, recordDownload };
