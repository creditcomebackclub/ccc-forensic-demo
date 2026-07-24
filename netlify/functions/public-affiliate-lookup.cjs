// Public, unauthenticated lookup used by /join.html to brand the landing
// page for whichever affiliate's ref link brought the visitor in (e.g.
// "FundHub × Credit Comeback Club", their logo next to ours). Deliberately
// returns only the display fields a landing page needs (name, company,
// brand_name, brand_logo_url) — never anything else on the affiliates row
// (email, commission_rate, payout history, etc).
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      }
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server not configured' }) };
  }

  try {
    const { ref } = JSON.parse(event.body || '{}');
    if (!ref || !/^[0-9a-f]{6,36}$/i.test(String(ref).trim())) {
      return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ affiliate: null }) };
    }

    // Same prefix-match approach as public-intake.cjs and for the same
    // reason: PostgREST/Postgres has no `~~` (LIKE) operator for `uuid`
    // columns, and this instance doesn't honor the `column::text`
    // cast-in-filter-name workaround either — confirmed live. The
    // affiliates table is tiny, so fetching all rows and prefix-matching
    // client-side (here, server-side in this function) is simple and correct.
    const refPrefix = String(ref).trim().toLowerCase();
    const affRes = await fetch(`${supabaseUrl}/rest/v1/affiliates?select=id,name,company,brand_name,brand_logo_url`, {
      headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` }
    });
    const allAffs = await affRes.json();
    const matches = Array.isArray(allAffs) ? allAffs.filter((a) => a.id.toLowerCase().startsWith(refPrefix)) : [];

    // Only brand the page on an unambiguous single match — same rule as
    // attribution itself. An ambiguous or missing ref just means a generic
    // (unbranded) landing page, never a guess.
    const affiliate = matches.length === 1 ? matches[0] : null;

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({
        affiliate: affiliate ? {
          name: affiliate.name,
          company: affiliate.company || null,
          brandName: affiliate.brand_name || null,
          logoUrl: affiliate.brand_logo_url || null,
        } : null
      })
    };
  } catch (err) {
    console.error('Affiliate lookup error:', err);
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ affiliate: null }) };
  }
};
