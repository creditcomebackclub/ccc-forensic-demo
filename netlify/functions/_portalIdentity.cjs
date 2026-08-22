const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCESS_MODES = new Set(['canonical', 'pre_sign_v3', 'active']);

function normalizePortalIdentity(data) {
  const value = Array.isArray(data) && data.length === 1 ? data[0] : data;
  if (!value || typeof value !== 'object'
    || !UUID_RE.test(String(value.profileId || ''))
    || !UUID_RE.test(String(value.clientId || ''))
    || !UUID_RE.test(String(value.firmUserId || ''))) {
    const error = new Error('The client portal identity could not be verified.');
    error.status = 403;
    throw error;
  }
  return {
    profileId: String(value.profileId),
    clientId: String(value.clientId),
    firmUserId: String(value.firmUserId),
  };
}

function assertMode(mode) {
  if (!ACCESS_MODES.has(mode)) throw new Error('Invalid portal identity access mode.');
}

async function resolvePortalIdentityWithRest(rest, userId, mode, url, key) {
  assertMode(mode);
  const data = await rest('/rest/v1/rpc/ccc_resolve_canonical_portal_identity', 'POST', {
    p_portal_user_id: userId,
    p_access_mode: mode,
  }, url, key);
  return normalizePortalIdentity(data);
}

async function resolvePortalIdentityWithAdmin(admin, userId, mode) {
  assertMode(mode);
  const { data, error } = await admin.rpc('ccc_resolve_canonical_portal_identity', {
    p_portal_user_id: userId,
    p_access_mode: mode,
  });
  if (error) {
    const identityError = new Error('The client portal identity could not be verified.');
    identityError.status = error.code === '42501' ? 403 : 503;
    throw identityError;
  }
  return normalizePortalIdentity(data);
}

module.exports = {
  ACCESS_MODES,
  normalizePortalIdentity,
  resolvePortalIdentityWithAdmin,
  resolvePortalIdentityWithRest,
};
