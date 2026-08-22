function serviceHeaders(key, extra = {}) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function readJson(res, fallback) {
  const raw = await res.text();
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

async function loadAffiliateForUser({ url, key, userId, affiliateId = null }) {
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`];
  if (affiliateId) filters.push(`id=eq.${encodeURIComponent(affiliateId)}`);
  const res = await fetch(`${url}/rest/v1/affiliates?${filters.join('&')}&select=id,user_id,owner_user_id,name,email,company,commission_rate,brand_name,brand_color,brand_logo_url,program_status,current_agreement_id&limit=2`, {
    headers: serviceHeaders(key),
  });
  const rows = await readJson(res, []);
  if (!res.ok) throw new Error('Could not validate affiliate access');
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  return rows[0];
}

function hasPortalAccess(affiliate) {
  return Boolean(affiliate && ['legacy_active', 'active'].includes(affiliate.program_status));
}

async function requireAffiliatePortalAccess(options) {
  const affiliate = await loadAffiliateForUser(options);
  if (!affiliate) {
    const error = new Error('Your partner identity is not linked. Contact Credit Comeback Club.');
    error.statusCode = 403;
    throw error;
  }
  if (!hasPortalAccess(affiliate)) {
    const error = new Error('Partner portal access remains locked until the signed agreement is owner-activated.');
    error.statusCode = 403;
    error.code = 'AFFILIATE_ACTIVATION_REQUIRED';
    error.programStatus = affiliate.program_status;
    throw error;
  }
  return affiliate;
}

module.exports = { serviceHeaders, readJson, loadAffiliateForUser, hasPortalAccess, requireAffiliatePortalAccess };
