import { PACKET_MAX_ACCOUNTS } from './campaignBlueprint.js';
import {
  disputeItemsText,
  extractTemplateTokens,
  renderDisputeTemplate,
} from './disputeTemplateEngine.js';

export const ROUND_REASON_SELECTION_VERSION = 1;
export const INTERNAL_STAFF_INSTRUCTIONS_MAX = 1200;
export const MAX_REASONS_PER_ACCOUNT = 20;
export const ROUND_REASON_SNAPSHOT_MAX_BYTES = 256 * 1024;

const BUREAU_ALIASES = Object.freeze({
  EQ: 'EQ', EQUIFAX: 'EQ',
  EXP: 'EXP', EXPERIAN: 'EXP',
  TU: 'TU', TRANSUNION: 'TU', 'TRANS UNION': 'TU',
});

function clean(value, limit = 8000) {
  const text = String(value ?? '').trim();
  if (text.length > limit) throw new Error(`Reviewed dispute evidence exceeds the ${limit.toLocaleString()} character limit.`);
  return text;
}

function exactAccountId(account) {
  return clean(account?.clientAccountId ?? account?.client_account_id, 100).toLowerCase();
}

function maskedAccountNumber(value) {
  const normalized = String(value || '').replace(/[^a-zA-Z0-9]/g, '');
  return normalized.length >= 4 ? `****${normalized.slice(-4)}` : null;
}

function normalizeBureau(value) {
  return BUREAU_ALIASES[clean(value, 100).toUpperCase()] || null;
}

function isAuthorized(violation) {
  const outcome = clean(violation?.outcome, 100).toUpperCase();
  const adjudication = clean(violation?.adjudication?.status, 100).toLowerCase();
  return outcome === 'FLAG' && (!adjudication || adjudication === 'authorized');
}

function normalizeEvidenceRef(ref) {
  const bureauCode = normalizeBureau(ref?.bureau);
  const pageValue = ref?.page;
  const page = Number.isFinite(Number(pageValue)) && Number(pageValue) > 0 ? Number(pageValue) : null;
  const rawValue = ref?.rawValue === null || ref?.rawValue === undefined
    ? null
    : clean(ref.rawValue, 2000);
  return {
    bureauCode,
    page,
    field: clean(ref?.field, 300) || null,
    label: clean(ref?.label, 500) || null,
    rawValue,
  };
}

function hasSourceSupport(ref) {
  return Boolean(ref?.bureauCode && (ref?.page || (ref?.rawValue !== null && ref?.rawValue !== '')));
}

function reasonIdentity(violation, index) {
  const ruleId = clean(violation?.ruleId, 300);
  return `${ruleId}::${index}`;
}

/**
 * Only deterministic, staff-authorized findings with exact report evidence for
 * the target bureau can appear as selectable reasons. There is deliberately no
 * free-form fallback: unsupported allegations stay outside the letter.
 */
export function evidenceReasonsForAccount(account, bureauCode) {
  const targetBureau = normalizeBureau(bureauCode);
  if (!targetBureau) return [];
  const violations = Array.isArray(account?.violations) ? account.violations : [];
  return violations.flatMap((violation, index) => {
    const ruleId = clean(violation?.ruleId, 300);
    const issue = clean(violation?.issue, 8000);
    const refs = (Array.isArray(violation?.evidenceRefs) ? violation.evidenceRefs : [])
      .map(normalizeEvidenceRef)
      .filter(hasSourceSupport);
    if (!ruleId || !issue || !isAuthorized(violation) || !refs.some((ref) => ref.bureauCode === targetBureau)) return [];
    return [{
      reasonId: reasonIdentity(violation, index),
      ruleId,
      field: clean(violation?.field, 500) || 'Reporting issue',
      issue,
      currentlyReports: clean(violation?.currentlyReports, 8000),
      shouldReport: clean(violation?.shouldReport, 8000),
      statute: clean(violation?.statute, 1000),
      severity: clean(violation?.severity, 100),
      challengeStatement: clean(violation?.challengeStatement, 8000),
      evidenceRefs: refs,
    }];
  });
}

export function blankRoundReasonSelection(accounts = []) {
  return Object.fromEntries(accounts.map((account) => [exactAccountId(account), {
    included: false,
    reasonIds: [],
    internalStaffInstructions: '',
  }]));
}

export function selectedAccountIds(selection = {}) {
  return Object.entries(selection)
    .filter(([, item]) => item?.included)
    .map(([accountId]) => accountId)
    .sort();
}

export function buildRoundReasonSnapshots({ accounts = [], bureauCode, selection = {} } = {}) {
  const selected = [];
  const seenAccountIds = new Set();
  for (const account of accounts) {
    const clientAccountId = exactAccountId(account);
    if (!clientAccountId || seenAccountIds.has(clientAccountId)) throw new Error('Round selection contains a missing or duplicated canonical account.');
    seenAccountIds.add(clientAccountId);
    const choice = selection[clientAccountId];
    if (!choice?.included) continue;
    const available = evidenceReasonsForAccount(account, bureauCode);
    const availableById = new Map(available.map((reason) => [reason.reasonId, reason]));
    const reasonIds = [...new Set(Array.isArray(choice.reasonIds) ? choice.reasonIds.map((value) => clean(value, 500)) : [])];
    if (!reasonIds.length) throw new Error(`${clean(account?.furnisher, 500) || 'An included account'} needs at least one evidence-backed dispute reason.`);
    if (reasonIds.length > MAX_REASONS_PER_ACCOUNT) throw new Error('Use no more than 20 evidence-backed reasons for one account.');
    if (reasonIds.some((reasonId) => !availableById.has(reasonId))) {
      throw new Error('A selected dispute reason is no longer authorized by the frozen audit evidence.');
    }
    const selectedReasonIds = new Set(reasonIds);
    const selectedReasons = available.filter((reason) => selectedReasonIds.has(reason.reasonId));
    const internalStaffInstructions = clean(choice.internalStaffInstructions, INTERNAL_STAFF_INSTRUCTIONS_MAX);
    if (internalStaffInstructions && internalStaffInstructions.length < 8) {
      throw new Error('Private staff instructions must be at least 8 characters or left blank.');
    }
    selected.push({
      reasonSelectionVersion: ROUND_REASON_SELECTION_VERSION,
      accountKey: `client-account:${clientAccountId}`,
      clientAccountId,
      furnisher: clean(account?.furnisher || 'Unknown furnisher', 500),
      accountNumberMasked: maskedAccountNumber(account?.accountNumberMasked || account?.accountNumber),
      selectedReasons,
      internalStaffInstructions,
    });
  }
  if (!selected.length) throw new Error('Select at least one account to include in this round.');
  if (selected.length > PACKET_MAX_ACCOUNTS) throw new Error(`A physical letter can include no more than ${PACKET_MAX_ACCOUNTS} accounts.`);
  if (new TextEncoder().encode(JSON.stringify(selected)).byteLength > ROUND_REASON_SNAPSHOT_MAX_BYTES) {
    throw new Error('The selected reason evidence exceeds the 256 KB letter snapshot limit. Use fewer reasons in this physical letter.');
  }
  return selected;
}

function comparableReason(reason) {
  return {
    reasonId: reason.reasonId,
    ruleId: reason.ruleId,
    field: reason.field,
    issue: reason.issue,
    currentlyReports: reason.currentlyReports,
    shouldReport: reason.shouldReport,
    statute: reason.statute,
    severity: reason.severity,
    challengeStatement: reason.challengeStatement,
    // Postgres jsonb does not preserve object-key insertion order. Remap each
    // nested reference into one canonical field order before exact comparison
    // so a legitimate database round-trip cannot look like evidence tampering.
    evidenceRefs: (Array.isArray(reason?.evidenceRefs) ? reason.evidenceRefs : []).map((ref) => ({
      bureauCode: ref?.bureauCode ?? null,
      page: ref?.page ?? null,
      field: ref?.field ?? null,
      label: ref?.label ?? null,
      rawValue: ref?.rawValue ?? null,
    })),
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Stable save identity for one selected account/track revision set. The
 * account-reason snapshot (including private notes) and fixed template are
 * included, while browser upload paths are deliberately excluded. Exact
 * retries therefore resolve to the same draft instead of creating parallel
 * mail-capable records.
 */
export async function roundSelectionDraftSuffix({
  accountSnapshots,
  trackSnapshots,
  template,
  automaticValues,
  editableSections,
  screenshotManifest,
} = {}) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) throw new Error('Secure draft identity is unavailable in this browser.');
  const canonical = stableJson({
    version: ROUND_REASON_SELECTION_VERSION,
    accounts: [...(Array.isArray(accountSnapshots) ? accountSnapshots : [])]
      .sort((left, right) => exactAccountId(left).localeCompare(exactAccountId(right))),
    tracks: [...(Array.isArray(trackSnapshots) ? trackSnapshots : [])]
      .sort((left, right) => String(left?.trackId || '').localeCompare(String(right?.trackId || ''))),
    template: {
      id: template?.id ?? null,
      version: template?.version ?? null,
      body: template?.body ?? null,
    },
    automaticValues: automaticValues ?? null,
    editableSections: editableSections ?? null,
    screenshots: (Array.isArray(screenshotManifest) ? screenshotManifest : [])
      .map((item) => ({
        accountKey: item?.accountKey ?? null,
        clientAccountId: item?.clientAccountId ?? null,
        mediaType: item?.mediaType ?? null,
        size: item?.size ?? null,
        sha256: item?.sha256 ?? null,
      }))
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right))),
  });
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `__selection-${hex}`;
}

/** Re-proves every saved reason against each track's immutable source audit. */
export function validateRoundReasonSnapshots({ accountSnapshots, tracks, bureauCode } = {}) {
  const issues = [];
  const snapshots = Array.isArray(accountSnapshots) ? accountSnapshots : [];
  const trackRows = Array.isArray(tracks) ? tracks : [];
  if (!snapshots.length || snapshots.length > PACKET_MAX_ACCOUNTS) {
    issues.push(`A CCC letter must freeze between 1 and ${PACKET_MAX_ACCOUNTS} selected accounts.`);
    return issues;
  }
  if (new TextEncoder().encode(JSON.stringify(snapshots)).byteLength > ROUND_REASON_SNAPSHOT_MAX_BYTES) {
    issues.push('The frozen account/reason evidence exceeds the letter snapshot size limit.');
  }
  const tracksByAccount = new Map(trackRows.map((track) => [exactAccountId(track), track]));
  const seen = new Set();
  for (const snapshot of snapshots) {
    const accountId = exactAccountId(snapshot);
    if (!accountId || seen.has(accountId)) {
      issues.push('The reason snapshot contains a missing or duplicated canonical account.');
      continue;
    }
    seen.add(accountId);
    if (Number(snapshot?.reasonSelectionVersion) !== ROUND_REASON_SELECTION_VERSION) {
      issues.push(`Account ${accountId} lacks the current reason-selection snapshot version.`);
      continue;
    }
    const instructions = String(snapshot?.internalStaffInstructions ?? '');
    if (instructions.trim() !== instructions || instructions.length > INTERNAL_STAFF_INSTRUCTIONS_MAX
      || (instructions.length > 0 && instructions.length < 8)) {
      issues.push(`Account ${accountId} has invalid private staff instructions.`);
    }
    const track = tracksByAccount.get(accountId);
    if (!track) {
      issues.push(`Account ${accountId} is not bound to the reloaded letter tracks.`);
      continue;
    }
    const frozenAccount = track?.source_audit_snapshot ?? track?.sourceAuditSnapshot;
    const expectedAccountKey = `client-account:${accountId}`;
    const expectedFurnisher = clean(frozenAccount?.furnisher || 'Unknown furnisher', 500);
    const expectedMaskedAccountNumber = maskedAccountNumber(
      frozenAccount?.accountNumberMasked ?? frozenAccount?.account_number_masked
      ?? frozenAccount?.accountNumber ?? frozenAccount?.account_number,
    );
    if (snapshot?.accountKey !== expectedAccountKey
      || snapshot?.furnisher !== expectedFurnisher
      || (snapshot?.accountNumberMasked ?? null) !== expectedMaskedAccountNumber) {
      issues.push(`Account ${accountId} metadata does not exactly match its frozen audit evidence.`);
    }
    const allowed = new Map(evidenceReasonsForAccount(frozenAccount, bureauCode).map((reason) => [reason.reasonId, reason]));
    const selectedReasons = Array.isArray(snapshot?.selectedReasons) ? snapshot.selectedReasons : [];
    if (!selectedReasons.length || selectedReasons.length > MAX_REASONS_PER_ACCOUNT) {
      issues.push(`Account ${accountId} must contain between 1 and ${MAX_REASONS_PER_ACCOUNT} selected reasons.`);
      continue;
    }
    const seenReasonIds = new Set();
    for (const savedReason of selectedReasons) {
      const reasonId = clean(savedReason?.reasonId, 500);
      const current = allowed.get(reasonId);
      if (!reasonId || seenReasonIds.has(reasonId) || !current
        || JSON.stringify(comparableReason(savedReason)) !== JSON.stringify(comparableReason(current))) {
        issues.push(`Account ${accountId} contains a reason that does not exactly match its frozen audit evidence.`);
        break;
      }
      seenReasonIds.add(reasonId);
    }
  }
  if (trackRows.length !== snapshots.length || tracksByAccount.size !== snapshots.length) {
    issues.push('Selected account reasons do not exactly cover the letter track snapshot.');
  }
  return issues;
}

export function privateInstructionLeakIssues(accountSnapshots = [], renderedHtml = '') {
  const rendered = String(renderedHtml || '');
  return accountSnapshots.flatMap((snapshot) => {
    const instruction = String(snapshot?.internalStaffInstructions || '').trim();
    return instruction && rendered.includes(instruction)
      ? [`Private staff instructions for ${snapshot?.furnisher || 'an account'} appeared in the letter body.`]
      : [];
  });
}

/**
 * Proves that the selected facts still own the account-specific curlys and
 * that the stored HTML contains the exact render of the immutable template,
 * automatic values, and separately editable human sections.
 */
export function roundReasonRenderIssues({
  accountSnapshots,
  automaticValues,
  editableSections,
  templateText,
  renderedHtml,
} = {}) {
  const issues = [];
  const automatic = automaticValues && typeof automaticValues === 'object' && !Array.isArray(automaticValues)
    ? automaticValues : null;
  const editable = editableSections && typeof editableSections === 'object' && !Array.isArray(editableSections)
    ? editableSections : null;
  if (!automatic || !editable || typeof templateText !== 'string' || !templateText.trim()) {
    return ['The saved template merge inputs are incomplete.'];
  }
  const tokens = new Set(extractTemplateTokens(templateText));
  const accountTokens = ['account_list', 'dispute_item_and_explanation'].filter((token) => tokens.has(token));
  if (!accountTokens.length) {
    issues.push('The CRA template has no account-specific issue curly.');
  }
  const expectedIssues = disputeItemsText(accountSnapshots);
  if (!expectedIssues) issues.push('The selected account reasons do not produce a printable issue block.');
  for (const token of accountTokens) {
    if (automatic[token] !== expectedIssues) {
      issues.push(`The frozen {${token}} value does not exactly match the selected account reasons.`);
    }
    const expectedIssueHtml = renderDisputeTemplate(`{${token}}`, { [token]: expectedIssues });
    if (!String(renderedHtml || '').includes(expectedIssueHtml)) {
      issues.push(`The saved letter HTML no longer contains the exact selected {${token}} issue block.`);
    }
  }
  const expectedBody = renderDisputeTemplate(templateText, { ...automatic, ...editable }, ['screenshots']);
  const source = String(renderedHtml || '').trim();
  const wrappedBody = source.match(/<body><main class="letter-content">([\s\S]*)<\/main><\/body><\/html>$/i);
  if (!wrappedBody || wrappedBody[1] !== expectedBody) {
    issues.push('The saved letter HTML is not the exact frozen template merge.');
  }
  return issues;
}
