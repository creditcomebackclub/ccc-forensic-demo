const { verifyGuideDownloadToken } = require('./_guideDownloadToken.cjs');

const GUIDE_PATH = '/downloads/7-Metro2-Dispute-Templates.pdf';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const leadId = verifyGuideDownloadToken(event.queryStringParameters?.token, serviceKey);
  if (!leadId || !supabaseUrl || !serviceKey) {
    return { statusCode: 400, headers: { 'Cache-Control': 'no-store' }, body: 'This guide link is invalid or expired.' };
  }

  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey, 'Content-Type': 'application/json' };
  try {
    const lookup = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}&select=id,tags&limit=1`, { headers });
    const rows = lookup.ok ? await lookup.json() : [];
    const lead = Array.isArray(rows) ? rows[0] : null;
    if (lead) {
      const tags = Array.isArray(lead.tags) ? lead.tags.map(String) : [];
      if (!tags.includes('guide:downloaded')) {
        const update = await fetch(`${supabaseUrl}/rest/v1/clients?id=eq.${encodeURIComponent(leadId)}`, {
          method: 'PATCH',
          headers: { ...headers, Prefer: 'return=minimal' },
          body: JSON.stringify({ tags: [...tags, 'guide:downloaded'] }),
        });
        if (!update.ok) console.error('Could not record guide download:', await update.text());
      }
    }
  } catch (error) {
    // The guide is public. A transient analytics write must not withhold it.
    console.error('Guide download tracking failed:', error.message || error);
  }

  return {
    statusCode: 302,
    headers: { Location: GUIDE_PATH, 'Cache-Control': 'no-store' },
    body: '',
  };
};
