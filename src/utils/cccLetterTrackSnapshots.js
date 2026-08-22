const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TRACK_SCOPES = new Set(['cra', 'direct']);
const BUREAU_CODES = new Set(['EQ', 'EXP', 'TU']);
const ACCOUNT_KINDS = new Set([
  'collection', 'repossession', 'charge_off', 'late_payment',
  'student_loan', 'bankruptcy', 'other',
]);
const NATIVE_FLOWS = new Set(['accuracy', 'collection', 'consent', 'late_pay', 'repo', 'direct']);
const LOGICAL_FLOWS = new Set(['accuracy', 'collection', 'combo', 'consent', 'late_pay', 'repo', 'direct']);
const CONCRETE_FLOWS = new Set(['accuracy', 'collection', 'combo', 'consent', 'late_pay', 'direct']);
const PATH_ROLES = new Set(['standard', 'repo_primary', 'repo_companion']);

const FLOW_MAX_ROUND = Object.freeze({
  accuracy: 12,
  collection: 10,
  combo: 12,
  consent: 3,
  late_pay: 2,
  repo: 3,
  direct: 2,
});

const BUREAU_RECIPIENTS = Object.freeze({
  EQ: Object.freeze({
    slug: 'equifax',
    name: 'Equifax Information Services LLC',
    line1: 'P.O. Box 740256',
    line2: '',
    city: 'Atlanta',
    state: 'GA',
    zip: '30374-0256',
  }),
  EXP: Object.freeze({
    slug: 'experian',
    name: 'Experian Information Solutions Inc.',
    line1: 'P.O. Box 4500',
    line2: '',
    city: 'Allen',
    state: 'TX',
    zip: '75013',
  }),
  TU: Object.freeze({
    slug: 'transunion',
    name: 'TransUnion LLC',
    line1: 'P.O. Box 2000',
    line2: '',
    city: 'Chester',
    state: 'PA',
    zip: '19016',
  }),
});

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function uuid(value) {
  const normalized = lower(value);
  return UUID_RE.test(normalized) ? normalized : null;
}

function integer(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function exactAddressKey(address) {
  return [address?.name, address?.line1, address?.line2, address?.city, address?.state, address?.zip]
    .map((value) => lower(value).replace(/[^a-z0-9]+/g, ''))
    .join('|');
}

function accountSnapshotId(account) {
  return uuid(account?.clientAccountId ?? account?.client_account_id);
}

export function unresolvedCccMissingTokens(html) {
  const source = String(html || '');
  const pattern = /<mark\b[^>]*\bdata-missing-token\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  const tokens = new Set();
  let match;
  while ((match = pattern.exec(source)) !== null) {
    tokens.add(text(match[1] ?? match[2] ?? match[3]) || 'unknown');
  }
  return [...tokens];
}

function trackField(track, camel, snake) {
  return track?.[camel] ?? track?.[snake];
}

function expectedConcreteStep(flow, round) {
  if (flow === 'combo' && round >= 5 && round <= 7) return { flow: 'accuracy', round };
  if (flow === 'late_pay' && round === 2) return { flow: 'consent', round: 2 };
  if (flow === 'repo' && round === 1) return { flow: 'collection', round: 1 };
  if (flow === 'repo' && round === 2) return { flow: 'collection', round: 2 };
  if (flow === 'repo' && round === 3) return { flow: 'collection', round: 6 };
  return { flow, round };
}

function snapshotProblem(snapshot, index) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return `Track snapshot ${index + 1} must be an object.`;
  if (!uuid(snapshot.trackId)) return `Track snapshot ${index + 1} has an invalid trackId.`;
  if (integer(snapshot.revision) === null || integer(snapshot.revision) < 0) return `Track snapshot ${index + 1} has an invalid revision.`;
  if (!text(snapshot.methodVersion) || text(snapshot.methodVersion).length > 100) return `Track snapshot ${index + 1} has an invalid methodVersion.`;
  if (!TRACK_SCOPES.has(snapshot.trackScope)) return `Track snapshot ${index + 1} has an invalid trackScope.`;
  if (!uuid(snapshot.clientAccountId)) return `Track snapshot ${index + 1} has an invalid clientAccountId.`;
  if (snapshot.trackScope === 'cra' && !BUREAU_CODES.has(snapshot.bureauCode)) return `Track snapshot ${index + 1} requires a CRA bureauCode.`;
  if (snapshot.trackScope === 'direct' && snapshot.bureauCode !== null) return `Track snapshot ${index + 1} must not assign a bureau to Direct.`;
  if (!ACCOUNT_KINDS.has(snapshot.accountKind)) return `Track snapshot ${index + 1} has an invalid accountKind.`;
  if (!NATIVE_FLOWS.has(snapshot.nativeFlow)) return `Track snapshot ${index + 1} has an invalid nativeFlow.`;
  if (!LOGICAL_FLOWS.has(snapshot.logicalFlow)) return `Track snapshot ${index + 1} has an invalid logicalFlow.`;
  const logicalRound = integer(snapshot.logicalRound);
  if (!logicalRound || logicalRound > FLOW_MAX_ROUND[snapshot.logicalFlow]) return `Track snapshot ${index + 1} has an invalid logicalRound.`;
  if (!CONCRETE_FLOWS.has(snapshot.concreteFlow)) return `Track snapshot ${index + 1} has an invalid concreteFlow.`;
  const concreteRound = integer(snapshot.concreteRound);
  if (!concreteRound || concreteRound > FLOW_MAX_ROUND[snapshot.concreteFlow]) return `Track snapshot ${index + 1} has an invalid concreteRound.`;
  const expected = expectedConcreteStep(snapshot.logicalFlow, logicalRound);
  if (snapshot.concreteFlow !== expected.flow || concreteRound !== expected.round) {
    return `Track snapshot ${index + 1} does not map its logical step to the required concrete template.`;
  }
  if (integer(snapshot.cycle) === null || integer(snapshot.cycle) < 1) return `Track snapshot ${index + 1} has an invalid cycle.`;
  if (!PATH_ROLES.has(snapshot.pathRole)) return `Track snapshot ${index + 1} has an invalid pathRole.`;
  if (snapshot.trackScope === 'direct' && (snapshot.logicalFlow !== 'direct' || snapshot.concreteFlow !== 'direct' || snapshot.pathRole !== 'standard')) {
    return `Track snapshot ${index + 1} has conflicting Direct coordinates.`;
  }
  return null;
}

/**
 * Validate and canonicalize the browser-to-database snapshot contract.
 * The server still reloads every track before mail; this is only the first,
 * fast failure boundary for letter creation.
 */
export function normalizeCccAccountTrackSnapshots(value, { allowEmpty = false } = {}) {
  if (!Array.isArray(value)) throw new Error('CCC account-track snapshots must be a JSON array.');
  if (!allowEmpty && value.length === 0) throw new Error('CCC letters require an account-track snapshot before they can be saved.');
  if (value.length > 50) throw new Error('A CCC letter cannot bind more than 50 account tracks.');
  const trackIds = new Set();
  const accountIds = new Set();
  return value.map((snapshot, index) => {
    const problem = snapshotProblem(snapshot, index);
    if (problem) throw new Error(problem);
    const normalized = {
      trackId: uuid(snapshot.trackId),
      revision: integer(snapshot.revision),
      methodVersion: text(snapshot.methodVersion),
      trackScope: snapshot.trackScope,
      clientAccountId: uuid(snapshot.clientAccountId),
      bureauCode: snapshot.trackScope === 'direct' ? null : snapshot.bureauCode,
      accountKind: snapshot.accountKind,
      nativeFlow: snapshot.nativeFlow,
      logicalFlow: snapshot.logicalFlow,
      logicalRound: integer(snapshot.logicalRound),
      concreteFlow: snapshot.concreteFlow,
      concreteRound: integer(snapshot.concreteRound),
      cycle: integer(snapshot.cycle),
      pathRole: snapshot.pathRole,
    };
    if (trackIds.has(normalized.trackId)) throw new Error(`CCC track ${normalized.trackId} is duplicated in this letter.`);
    if (accountIds.has(normalized.clientAccountId)) throw new Error(`CCC account ${normalized.clientAccountId} is duplicated in this letter.`);
    trackIds.add(normalized.trackId);
    accountIds.add(normalized.clientAccountId);
    return normalized;
  });
}

// Mirrors diffEngine.normalizeFurnisher, which owns furnisher_addresses keys.
export function cccFurnisherKey(name) {
  const corporateSuffixes = /\b(INC|LLC|LLP|LP|LTD|CO|CORP|CORPORATION|COMPANY|NA|N A|NATIONAL ASSOCIATION)\b/g;
  return text(name)
    .toUpperCase()
    .replace(/[.,]/g, '')
    .replace(corporateSuffixes, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function serverTrackValue(track) {
  return {
    trackId: uuid(track?.id),
    revision: integer(track?.revision),
    methodVersion: text(trackField(track, 'methodVersion', 'method_version')),
    trackScope: trackField(track, 'trackScope', 'track_scope'),
    clientAccountId: uuid(trackField(track, 'clientAccountId', 'client_account_id')),
    bureauCode: trackField(track, 'bureauCode', 'bureau_code') ?? null,
    accountKind: trackField(track, 'accountKind', 'account_kind'),
    nativeFlow: trackField(track, 'nativeFlow', 'native_flow'),
    logicalFlow: trackField(track, 'currentFlow', 'current_flow'),
    logicalRound: integer(trackField(track, 'currentRound', 'current_round')),
    cycle: integer(track?.cycle),
    pathRole: trackField(track, 'pathRole', 'path_role'),
  };
}

function sameValue(left, right) {
  return left === right;
}

function directRecipientFromRow(row) {
  if (!row) return null;
  return {
    name: row.display_name,
    line1: row.address_line1,
    line2: row.address_line2 || '',
    city: row.city,
    state: row.state,
    zip: row.zip,
  };
}

/**
 * Pure server-side comparison after PostgREST has reloaded the letter's exact
 * tracks/template/verified Direct address. Returns every blocking issue so the
 * operator can rebuild one reviewed letter revision instead of trial-and-error.
 */
export function validateCccLetterTrackBinding({
  letter,
  tracks,
  template,
  toAddress,
  verifiedDirectRecipient = null,
}) {
  const issues = [];
  let snapshots;
  try {
    snapshots = normalizeCccAccountTrackSnapshots(letter?.ccc_account_track_snapshots);
  } catch (error) {
    return [error.message];
  }

  const accountSnapshots = Array.isArray(letter?.dispute_account_snapshot) ? letter.dispute_account_snapshot : [];
  const coverageIds = accountSnapshots.map(accountSnapshotId);
  if (!coverageIds.length || coverageIds.some((id) => !id)) {
    issues.push('Every saved CCC account snapshot requires its canonical clientAccountId.');
  } else if (new Set(coverageIds).size !== coverageIds.length) {
    issues.push('The saved CCC account coverage contains a duplicate account.');
  } else {
    const snapshotIds = snapshots.map((snapshot) => snapshot.clientAccountId).sort();
    const exactCoverage = [...coverageIds].sort();
    if (JSON.stringify(snapshotIds) !== JSON.stringify(exactCoverage)) {
      issues.push('The account-track snapshots do not exactly match the saved letter account coverage.');
    }
  }

  const rows = Array.isArray(tracks) ? tracks : [];
  const rowById = new Map(rows.map((row) => [uuid(row?.id), row]));
  if (rows.length !== snapshots.length || rowById.size !== snapshots.length || rowById.has(null)) {
    issues.push('One or more bound CCC account tracks no longer exist or were returned more than once.');
  }

  for (const snapshot of snapshots) {
    const row = rowById.get(snapshot.trackId);
    if (!row) continue;
    const current = serverTrackValue(row);
    if (row.user_id !== letter.user_id || row.client_id !== letter.client_id) {
      issues.push(`CCC track ${snapshot.trackId} belongs to a different staff owner or client.`);
      continue;
    }
    if (row.status !== 'active') issues.push(`CCC track ${snapshot.trackId} is not active.`);
    for (const field of [
      'revision', 'methodVersion', 'trackScope', 'clientAccountId', 'bureauCode',
      'accountKind', 'nativeFlow', 'logicalFlow', 'logicalRound', 'cycle', 'pathRole',
    ]) {
      if (!sameValue(snapshot[field], current[field])) {
        issues.push(`CCC track ${snapshot.trackId} changed its ${field}; rebuild the letter from current account state.`);
      }
    }
    const concrete = expectedConcreteStep(current.logicalFlow, current.logicalRound);
    if (snapshot.concreteFlow !== concrete.flow || snapshot.concreteRound !== concrete.round) {
      issues.push(`CCC track ${snapshot.trackId} no longer maps to the saved concrete template step.`);
    }
  }

  const scopes = new Set(snapshots.map((snapshot) => snapshot.trackScope));
  const bureaus = new Set(snapshots.map((snapshot) => snapshot.bureauCode));
  const logicalSteps = new Set(snapshots.map((snapshot) => `${snapshot.logicalFlow}:${snapshot.logicalRound}`));
  const concreteSteps = new Set(snapshots.map((snapshot) => `${snapshot.concreteFlow}:${snapshot.concreteRound}`));
  if (scopes.size !== 1 || logicalSteps.size !== 1 || concreteSteps.size !== 1) {
    issues.push('One physical CCC letter must bind one scope, logical step, and concrete template step.');
  }

  const first = snapshots[0];
  const concreteFlow = first?.concreteFlow;
  const concreteRound = first?.concreteRound;
  if (!template || template.id !== letter.dispute_template_id
      || template.flow_code !== concreteFlow || Number(template.round_number) !== concreteRound) {
    issues.push('The saved CCC template no longer proves the bound concrete flow and round.');
  }
  if (letter.dispute_flow_code !== concreteFlow || Number(letter.dispute_round_number) !== concreteRound) {
    issues.push('The letter metadata does not match the bound concrete flow and round.');
  }

  if (first?.trackScope === 'cra') {
    if (!['ALL', first.bureauCode].includes(text(template?.bureau_code).toUpperCase())) {
      issues.push('The selected template is not approved for the bound CRA bureau.');
    }
    if (bureaus.size !== 1 || !BUREAU_CODES.has(first.bureauCode)) {
      issues.push('A CRA letter must contain tracks for exactly one bureau.');
    }
    const recipient = BUREAU_RECIPIENTS[first.bureauCode];
    if (!recipient || letter.target_type !== 'bureau' || letter.target_bureau !== recipient.slug
        || letter.dispute_bureau_code !== first.bureauCode
        || exactAddressKey(toAddress) !== exactAddressKey(recipient)) {
      issues.push('The CRA recipient does not match the bound bureau track.');
    }
  } else if (first?.trackScope === 'direct') {
    if (text(template?.bureau_code).toUpperCase() !== 'ALL') {
      issues.push('Direct templates must use the bureau-independent ALL scope.');
    }
    if (snapshots.length !== 1 || first.bureauCode !== null || letter.target_type !== 'furnisher'
        || letter.target_bureau != null || letter.dispute_bureau_code != null
        || letter.client_account_id !== first.clientAccountId) {
      issues.push('A Direct letter must bind exactly one bureau-independent account track and furnisher recipient.');
    }
    const verifiedAddress = directRecipientFromRow(verifiedDirectRecipient);
    if (!verifiedAddress
        || verifiedDirectRecipient?.user_id !== letter.user_id
        || cccFurnisherKey(letter.furnisher) !== verifiedDirectRecipient?.furnisher_key
        || exactAddressKey(toAddress) !== exactAddressKey(verifiedAddress)) {
      issues.push('The Direct recipient does not match the server-verified furnisher address.');
    }
  }

  return [...new Set(issues)];
}

export { BUREAU_RECIPIENTS as CCC_BUREAU_RECIPIENTS };
