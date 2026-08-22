import { buildCccInitializationRpcArgs } from './disputeFlow.js';

function explicitSavedAuditId(audit) {
  return audit?.id || audit?.auditId || null;
}

function auditWithExplicitId(audit) {
  const auditId = explicitSavedAuditId(audit);
  return auditId ? { ...audit, id: auditId } : audit;
}

/**
 * Pure, fail-closed readiness check for the fresh CRA initialization boundary.
 * Direct tracks are deliberately excluded until the owner confirms that choice.
 */
export function buildCraTrackInitializationArgs(audit) {
  if (!explicitSavedAuditId(audit)) {
    throw new Error('Confirm and save this classification review before opening Campaign Studio. CCC needs the exact saved audit record.');
  }
  try {
    return buildCccInitializationRpcArgs(auditWithExplicitId(audit), {
      directAccountIds: [],
    });
  } catch (error) {
    if (/exact clientAccountId/.test(error?.message || '')) {
      throw new Error('Every routed account needs a reconciled clientAccountId before Campaign Studio can open. Reconcile the flagged account identity, then reopen this saved audit.');
    }
    throw error;
  }
}

export function craTrackInitializationBlocker(audit) {
  try {
    buildCraTrackInitializationArgs(audit);
    return null;
  } catch (error) {
    return error?.message || 'CCC cannot initialize this audit safely.';
  }
}

function trackScope(track) {
  return track?.track_scope || track?.trackScope || null;
}

function accountId(track) {
  return track?.client_account_id || track?.clientAccountId || null;
}

function bureauCode(track) {
  return track?.bureau_code || track?.bureauCode || null;
}

function trackField(track, snakeCase, camelCase) {
  return track?.[snakeCase] ?? track?.[camelCase] ?? null;
}

/**
 * Authenticated, idempotent RPC call. The database owns conflict handling and
 * returns the already-created rows on a retry. Only the exact CRA rows requested
 * by this reviewed audit are handed to Campaign Studio.
 */
export async function initializeCraAccountTracks(audit, client = null) {
  const args = buildCraTrackInitializationArgs(audit);
  const db = client || (await import('./supabase.js')).supabase;
  const { data: sessionData, error: sessionError } = await db.auth.getSession();
  if (sessionError) throw new Error(`CCC could not verify your staff session: ${sessionError.message}`);
  if (!sessionData?.session?.access_token) {
    throw new Error('Your staff session has expired. Sign in again before opening Campaign Studio.');
  }

  const { data, error } = await db.rpc('initialize_ccc_account_tracks', args);
  if (error) throw new Error(`CCC could not initialize the CRA account tracks: ${error.message}`);
  if (!Array.isArray(data)) throw new Error('CCC did not return the initialized CRA account tracks. Retry before building letters.');

  const expectedKeys = new Set(args.p_classifications.flatMap((classification) => (
    classification.bureaus.map((bureau) => `${classification.client_account_id}:${bureau}`)
  )));
  const classificationByRoute = new Map(args.p_classifications.map((classification) => [
    `${classification.client_account_id}:${classification.bureaus[0]}`,
    classification,
  ]));
  const tracksByKey = new Map();
  for (const track of data) {
    if (trackScope(track) !== 'cra') continue;
    const key = `${accountId(track)}:${bureauCode(track)}`;
    if (expectedKeys.has(key)) {
      if (tracksByKey.has(key)) throw new Error(`CCC returned more than one CRA track for ${key}. Campaign Studio stayed closed.`);
      tracksByKey.set(key, track);
    }
  }
  const missing = [...expectedKeys].filter((key) => !tracksByKey.has(key));
  if (missing.length) {
    throw new Error(`CCC did not return ${missing.length} required CRA account track${missing.length === 1 ? '' : 's'}. Retry before building letters.`);
  }
  const tracks = [...expectedKeys].map((key) => tracksByKey.get(key));
  const mismatched = tracks.filter((track) => {
    const classification = classificationByRoute.get(`${accountId(track)}:${bureauCode(track)}`);
    const frozen = trackField(track, 'classification_snapshot', 'classificationSnapshot') || {};
    return !track?.id
      || trackField(track, 'client_id', 'clientId') !== args.p_client_id
      || trackField(track, 'source_audit_id', 'sourceAuditId') !== args.p_audit_id
      || trackField(track, 'method_version', 'methodVersion') !== args.p_method_version
      || trackField(track, 'account_kind', 'accountKind') !== classification?.account_kind
      || trackField(track, 'native_flow', 'nativeFlow') !== classification?.native_flow
      || Number(frozen.reviewVersion) !== Number(args.p_review_version)
      || frozen.reviewSnapshotSha256 !== args.p_review_snapshot_sha256;
  });
  if (mismatched.length) {
    throw new Error('The existing CRA track state does not match this exact saved classification review. Campaign Studio stayed closed so CCC cannot overwrite or misroute immutable account history.');
  }
  return tracks;
}
