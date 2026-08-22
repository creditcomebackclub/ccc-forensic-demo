const { hasPortalAccess, loadAffiliateForUser } = require('./_affiliateAccess.cjs');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { affiliateId } = JSON.parse(event.body || '{}');
    if (!UUID_RE.test(String(affiliateId || ''))) {
      return { statusCode: 400, body: JSON.stringify({ error: 'A valid affiliate ID is required' }) };
    }

    // Get the auth token from header
    const authHeader = event.headers?.authorization || event.headers?.Authorization;
    if (!authHeader) return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) throw new Error('Affiliate portal data service is not configured');

    // Validate the user's token using the normal anon key
    // We can just verify the token with the admin auth api
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'apikey': process.env.VITE_SUPABASE_ANON_KEY || supabaseKey,
        'Authorization': authHeader
      }
    });

    const user = await res.json().catch(() => null);
    if (!res.ok || !user || !user.id) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Invalid token' }) };
    }

    // Now use REST API to bypass RLS and fetch data using service key
    const fetchWithKey = async (url) => {
      const r = await fetch(url, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const raw = await r.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
      if (!r.ok) throw new Error(`Affiliate data source unavailable (${r.status})`);
      return data;
    };

    // 1. Resolve the caller's complete affiliate identity first. Filtering by
    // the requested ID would hide an ambiguous duplicate mapping; limit 2 in
    // the shared loader makes that ambiguity fail closed.
    const affiliate = await loadAffiliateForUser({ url: supabaseUrl, key: supabaseKey, userId: user.id });
    if (!affiliate || String(affiliate.id).toLowerCase() !== String(affiliateId).toLowerCase()) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }
    if (!hasPortalAccess(affiliate)) {
      return {
        statusCode: 403,
        body: JSON.stringify({
          error: 'Partner portal access remains locked until the signed agreement is owner-activated.',
          code: 'AFFILIATE_ACTIVATION_REQUIRED',
          programStatus: affiliate.program_status,
        }),
      };
    }
    const ownerUserId = String(affiliate.owner_user_id || '').trim();
    if (!UUID_RE.test(ownerUserId)) {
      return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
    }

    // 2. Fetch clients — explicit select allowlist. This used to fetch the
    // ENTIRE clients row (address, phone, date_of_birth, monitoring_email,
    // internal notes/lead_notes, full ledger, everything) straight to the
    // affiliate's browser. Only the fields actually needed — either for
    // display, or as raw input to the server-side commission calc below —
    // are fetched, and the raw ledger/referral_fee never leave this
    // function; only the derived numbers do.
    const clientsData = await fetchWithKey(
      `${supabaseUrl}/rest/v1/clients?referred_by=eq.${encodeURIComponent(affiliate.id)}&user_id=eq.${encodeURIComponent(ownerUserId)}&select=id,user_id,referred_by,name,email,phone,created_at,referral_fee,ledger,score_eq_start,score_exp_start,score_tu_start`
    );
    if (!Array.isArray(clientsData)) throw new Error('Affiliate client data was malformed');
    if (clientsData.some((client) => (
      !UUID_RE.test(String(client?.id || ''))
      || String(client?.referred_by || '').toLowerCase() !== String(affiliate.id).toLowerCase()
      || String(client?.user_id || '').toLowerCase() !== ownerUserId.toLowerCase()
    ))) {
      throw new Error('Affiliate client ownership boundary mismatch');
    }
    const rawClients = clientsData;

    // 3. Fetch this affiliate's payout ledger and compute commission
    // server-side via the shared module (same one BillingDashboardPage.jsx,
    // AffiliateProfilePanel.jsx etc. use) — single source of truth, and it
    // means the affiliate's own portal can never drift from what staff see.
    const { computeClientCommission, recognizedTotal } = await import('../../src/utils/affiliateCommission.js');
    const payoutsData = await fetchWithKey(
      `${supabaseUrl}/rest/v1/commission_payouts?affiliate_id=eq.${encodeURIComponent(affiliateId)}&select=client_id,covered_tx_ids,amount`
    );
    if (!Array.isArray(payoutsData)) throw new Error('Affiliate payout data was malformed');
    const payouts = payoutsData;
    const payoutsByClient = new Map();
    for (const p of payouts) {
      if (!payoutsByClient.has(p.client_id)) payoutsByClient.set(p.client_id, []);
      payoutsByClient.get(p.client_id).push(p);
    }

    const clients = rawClients.map((c) => {
      const { earned, paid, owed } = computeClientCommission(
        { referral_fee: c.referral_fee, ledger: c.ledger },
        affiliate,
        payoutsByClient.get(c.id) || []
      );
      const ratePct = c.referral_fee !== null && c.referral_fee !== undefined ? c.referral_fee : Math.round((affiliate.commission_rate || 0.20) * 100);
      const totalPaid = recognizedTotal({ ledger: c.ledger });
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        phone: c.phone,
        created_at: c.created_at,
        totalPaid,
        commissionEarned: earned,
        commissionPaid: paid,
        commissionOwed: owed,
        ratePct,
        scoreEqStart: c.score_eq_start ?? null,
        scoreExpStart: c.score_exp_start ?? null,
        scoreTuStart: c.score_tu_start ?? null,
      };
    });

    // 4. Fetch letters and audits for these clients
    let letters = [];
    let profiles = [];

    if (clients.length > 0) {
      const ids = rawClients.map(c => c.id).filter(Boolean);
      if (ids.length > 0) {
        const idsQuery = ids.join(',');
        const clientIdSet = new Set(ids.map((id) => String(id).toLowerCase()));
        // Exact referred-client UUID is the only portal boundary. Historical
        // letters/audits with no client_id stay quarantined from affiliates
        // until staff reconcile them; names and firm-owner IDs are never a
        // safe identity fallback.
        const lettersData = await fetchWithKey(`${supabaseUrl}/rest/v1/letters?client_id=in.(${idsQuery})&user_id=eq.${encodeURIComponent(ownerUserId)}&select=user_id,client_id,furnisher,phase,mailed_date,mail_service,expected_delivery_date,tracking_status,delivered_at,response_outcome,saved_at`);
        if (!Array.isArray(lettersData)) throw new Error('Affiliate letter data was malformed');
        if (lettersData.some((letter) => (
          String(letter?.user_id || '').toLowerCase() !== ownerUserId.toLowerCase()
          || !clientIdSet.has(String(letter?.client_id || '').toLowerCase())
        ))) throw new Error('Affiliate letter ownership boundary mismatch');
        letters = lettersData.map((letter) => {
          const { user_id: _ownerUserId, ...safeLetter } = letter;
          const isTrackedCertified = letter.mail_service === 'usps_first_class_certified_return_receipt';
          if (isTrackedCertified) return safeLetter;
          const terminalStatus = ['Returned to Sender', 'Failed', 'Cancelled'].includes(letter.tracking_status)
            ? letter.tracking_status
            : null;
          const isCurrentFirstClass = letter.mail_service === 'usps_first_class';
          return {
            ...safeLetter,
            expected_delivery_date: isCurrentFirstClass
              && letter.mailed_date
              && letter.expected_delivery_date
              && !terminalStatus
              ? letter.expected_delivery_date
              : null,
            tracking_status: terminalStatus || (letter.mailed_date
              ? (isCurrentFirstClass ? 'Mailed First Class' : 'Mailed')
              : null),
            delivered_at: null,
          };
        });

        // Current scores live in the audit blob, not client_profiles (that
        // table has no starting_scores/current columns — the previous
        // version of this query selected fields that don't exist, so
        // scoreIncrease was silently 'N/A' for every affiliate, always).
        // report_date desc: audits[0] per client is the latest.
        const auditsData = await fetchWithKey(`${supabaseUrl}/rest/v1/audits?client_id=in.(${idsQuery})&user_id=eq.${encodeURIComponent(ownerUserId)}&select=id,user_id,client_id,report_date,saved_at,audit&order=report_date.desc.nullslast,saved_at.desc.nullslast,id.desc`);
        if (!Array.isArray(auditsData)) throw new Error('Affiliate audit data was malformed');
        if (auditsData.some((audit) => (
          String(audit?.user_id || '').toLowerCase() !== ownerUserId.toLowerCase()
          || !clientIdSet.has(String(audit?.client_id || '').toLowerCase())
        ))) throw new Error('Affiliate audit ownership boundary mismatch');
        const latestAuditByClient = new Map();
        for (const a of auditsData) {
          if (a.client_id && !latestAuditByClient.has(a.client_id)) latestAuditByClient.set(a.client_id, a);
        }
        profiles = clients.map((c) => {
          const latest = latestAuditByClient.get(c.id);
          const scores = latest?.audit?.scores || latest?.audit?.client?.scores || null;
          return { clientId: c.id, currentScores: scores };
        });
      }
    }

    // Sum-of-all-bureaus score increase (not an average) — each client's
    // scoreIncrease is the total points gained across Equifax + Experian +
    // TransUnion combined, only when both a start and a current score exist
    // for that bureau.
    const clientsWithScoreIncrease = clients.map((c) => {
      const latest = profiles.find((p) => p.clientId === c.id);
      const cur = latest?.currentScores;
      let scoreIncrease = null;
      if (cur) {
        const pairs = [
          [c.scoreEqStart, cur.equifax],
          [c.scoreExpStart, cur.experian],
          [c.scoreTuStart, cur.transunion],
        ];
        let sum = 0, any = false;
        for (const [start, current] of pairs) {
          if (start != null && current != null) { sum += (current - start); any = true; }
        }
        if (any) scoreIncrease = sum;
      }
      return { ...c, scoreIncrease };
    });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clients: clientsWithScoreIncrease, letters })
    };

  } catch (e) {
    console.error('Affiliate portal data failed:', e instanceof Error ? e.message : 'Unknown error');
    return { statusCode: 500, body: JSON.stringify({ error: 'Could not load affiliate portal data.' }) };
  }
};
