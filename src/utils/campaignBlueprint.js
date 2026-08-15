import { buildCleanupRouteGroups, getCampaignItemBureaus } from './campaignItems.js';

export const PACKET_MAX_ACCOUNTS = 5;
export const ROUTE_CLASSIFICATIONS = Object.freeze({
  BUREAU_ONLY: 'BUREAU_ONLY',
  DIRECT_ELIGIBLE: 'DIRECT_ELIGIBLE',
  FDCPA_ELIGIBLE: 'FDCPA_ELIGIBLE',
  CLIENT_CONFIRMATION_REQUIRED: 'CLIENT_CONFIRMATION_REQUIRED',
  FRESH_REPORT_REQUIRED: 'FRESH_REPORT_REQUIRED',
  NO_DISPUTE: 'NO_DISPUTE',
});

const normalizeKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
const asTime = (value) => {
  const time = value ? new Date(value).getTime() : NaN;
  return Number.isFinite(time) ? time : null;
};

export function auditFreshness(reportDate, { now = new Date(), maxAgeDays = 45 } = {}) {
  const reportTime = asTime(reportDate);
  if (reportTime === null) return { current: false, ageDays: null, reason: 'The frozen audit has no reliable report date.' };
  const ageDays = Math.max(0, Math.floor((new Date(now).getTime() - reportTime) / 86400000));
  return {
    current: ageDays <= maxAgeDays,
    ageDays,
    reason: ageDays <= maxAgeDays ? null : `The frozen report is ${ageDays} days old; refresh it before generating.`,
  };
}

export function authorizedFindings(item) {
  const snapshot = item?.snapshot || {};
  const findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
  if (findings.length) return findings.filter((finding) => finding?.outcome === 'FLAG');
  return (snapshot.violations || []).filter((finding) => !finding?.outcome || finding.outcome === 'FLAG');
}

const hasClientFactGate = (item) => (item?.snapshot?.findings || []).some((finding) =>
  finding?.outcome === 'REVIEW_REQUIRED'
  && (finding?.ruleId === 'ACCOUNT_MATCH_AMBIGUOUS' || finding?.verificationStatus));

const hasDirectFinding = (item) => authorizedFindings(item).some((finding) => {
  const id = String(finding?.ruleId || '');
  return !id.startsWith('CROSS_BUREAU_') && id !== 'ACCOUNT_MATCH_AMBIGUOUS';
});

export function classifyAccountRoute(item, options = {}) {
  const snapshot = item?.snapshot || {};
  const findings = authorizedFindings(item);
  if (!findings.length) {
    return { classification: ROUTE_CLASSIFICATIONS.NO_DISPUTE, findings, reason: 'No authorized deterministic finding is frozen for this account.' };
  }
  if (hasClientFactGate(item)) {
    return { classification: ROUTE_CLASSIFICATIONS.CLIENT_CONFIRMATION_REQUIRED, findings, reason: 'Account identity or a required client fact still needs staff confirmation.' };
  }
  const freshness = auditFreshness(snapshot.auditReportDate, options);
  if (!freshness.current) {
    return { classification: ROUTE_CLASSIFICATIONS.FRESH_REPORT_REQUIRED, findings, reason: freshness.reason, freshness };
  }
  const addressVerified = String(snapshot.addressStatus || '').toUpperCase() === 'YES'
    && Boolean(String(snapshot.furnisherAddress || '').trim());
  if (!addressVerified || !hasDirectFinding(item)) {
    return {
      classification: ROUTE_CLASSIFICATIONS.BUREAU_ONLY,
      findings,
      reason: addressVerified
        ? 'The authorized findings are bureau-comparison findings and do not independently support a direct route.'
        : 'No verified direct-dispute address is frozen for this furnisher.',
      freshness,
    };
  }
  if (item?.routeReview?.fdcpaValidationEligible === true || snapshot.fdcpaValidationEligible === true) {
    return { classification: ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE, findings, reason: null, freshness };
  }
  return { classification: ROUTE_CLASSIFICATIONS.DIRECT_ELIGIBLE, findings, reason: null, freshness };
}

export function furnisherRecipientKey(item, disputeBasis = 'FCRA_DIRECT') {
  const snapshot = item?.snapshot || {};
  return `furnisher:${normalizeKey(snapshot.furnisher || item?.label)}:${normalizeKey(snapshot.furnisherAddress)}:${disputeBasis}`;
}

const chunks = (values, size = PACKET_MAX_ACCOUNTS) => {
  const out = [];
  for (let index = 0; index < values.length; index += size) out.push(values.slice(index, index + size));
  return out;
};

function packetSpec(items, spec, sequence) {
  return {
    key: `${spec.recipientKey}:${sequence}`,
    itemId: items[0].id,
    itemIds: items.map((item) => item.id),
    targetType: spec.targetType,
    targetBureau: spec.targetBureau || null,
    disputeBasis: spec.disputeBasis || null,
    recipientKey: spec.recipientKey,
    letterStyle: spec.letterStyle || (spec.targetType === 'furnisher' ? 'direct_furnisher' : 'forensic'),
    classification: spec.classification || null,
    customInstructions: '',
  };
}

export function buildCampaignBlueprint(items = [], options = {}) {
  const selected = items.filter((item) => item?.selectionState === 'selected');
  const cleanup = buildCleanupRouteGroups(selected).map((group) => ({
    key: `cleanup:${group.targetBureau}`,
    itemId: group.itemIds[0],
    itemIds: group.itemIds,
    targetType: 'bureau',
    targetBureau: group.targetBureau,
    disputeBasis: null,
    recipientKey: `bureau:${group.targetBureau}:cleanup`,
    letterStyle: 'personal_information',
    classification: 'CLEANUP',
    customInstructions: '',
  }));

  const accountItems = selected.filter((item) => item.kind === 'account')
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || String(a.id).localeCompare(String(b.id)));
  const decisions = accountItems.map((item) => ({ item, ...classifyAccountRoute(item, options) }));
  const blocked = decisions.filter(({ classification }) => [
    ROUTE_CLASSIFICATIONS.CLIENT_CONFIRMATION_REQUIRED,
    ROUTE_CLASSIFICATIONS.FRESH_REPORT_REQUIRED,
    ROUTE_CLASSIFICATIONS.NO_DISPUTE,
  ].includes(classification));
  const blockedIds = new Set(blocked.map((entry) => entry.item.id));
  const eligible = decisions.filter((decision) => !blockedIds.has(decision.item.id));

  const bureauGroups = new Map();
  for (const decision of eligible) {
    for (const bureau of getCampaignItemBureaus(decision.item)) {
      const key = `bureau:${bureau}:account`;
      if (!bureauGroups.has(key)) bureauGroups.set(key, []);
      bureauGroups.get(key).push(decision.item);
    }
  }
  const bureauPackets = [];
  for (const [key, groupItems] of bureauGroups) {
    const targetBureau = key.split(':')[1];
    chunks(groupItems).forEach((group, index) => bureauPackets.push(packetSpec(group, {
      targetType: 'bureau', targetBureau, recipientKey: `bureau:${targetBureau}`,
      letterStyle: 'forensic', classification: 'BUREAU_PACKET',
    }, index + 1)));
  }

  const directGroups = new Map();
  for (const decision of eligible) {
    if (![ROUTE_CLASSIFICATIONS.DIRECT_ELIGIBLE, ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE].includes(decision.classification)) continue;
    const bases = decision.classification === ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE
      ? ['FCRA_DIRECT', 'FDCPA'] : ['FCRA_DIRECT'];
    for (const disputeBasis of bases) {
      const key = furnisherRecipientKey(decision.item, disputeBasis);
      if (!directGroups.has(key)) directGroups.set(key, { items: [], disputeBasis, classification: decision.classification });
      directGroups.get(key).items.push(decision.item);
    }
  }
  const directPackets = [];
  for (const [recipientKey, group] of directGroups) {
    chunks(group.items).forEach((packetItems, index) => directPackets.push(packetSpec(packetItems, {
      targetType: 'furnisher', recipientKey, disputeBasis: group.disputeBasis,
      letterStyle: group.disputeBasis === 'FDCPA' ? 'debt_validation' : 'direct_furnisher',
      classification: group.classification,
    }, index + 1)));
  }

  return {
    cleanupPackets: cleanup,
    accountPackets: [...bureauPackets, ...directPackets],
    packets: [...cleanup, ...bureauPackets, ...directPackets],
    decisions: decisions.map(({ item, ...decision }) => ({ itemId: item.id, ...decision })),
    blocked: blocked.map(({ item, ...decision }) => ({ itemId: item.id, ...decision })),
  };
}

export function splitPacketSpec(packet, afterCount) {
  const count = Number(afterCount);
  if (!Number.isInteger(count) || count < 1 || count >= packet.itemIds.length) {
    throw new Error('Choose a split point inside the packet.');
  }
  const sides = [packet.itemIds.slice(0, count), packet.itemIds.slice(count)];
  return sides.map((itemIds, index) => ({
    ...packet,
    key: `${packet.key}:split:${index + 1}`,
    itemId: itemIds[0],
    itemIds,
  }));
}

export function validatePacketSpec(spec, itemMap, options = {}) {
  const ids = [...new Set(spec?.itemIds?.length ? spec.itemIds : [spec?.itemId])].filter(Boolean);
  if (!ids.length || ids.length > PACKET_MAX_ACCOUNTS) throw new Error('Account packets must contain one to five accounts.');
  const items = ids.map((id) => itemMap.get(id));
  if (items.some((item) => !item || item.kind !== 'account' || item.selectionState !== 'selected')) {
    throw new Error('An account packet contains an unavailable or unselected item.');
  }
  if (spec.targetType === 'bureau') {
    if (!spec.targetBureau || items.some((item) => !getCampaignItemBureaus(item).includes(spec.targetBureau))) {
      throw new Error('Every packet account must be reported by the selected bureau.');
    }
    return { items, recipientKey: `bureau:${spec.targetBureau}` };
  }
  if (spec.targetType !== 'furnisher' || !['FCRA_DIRECT', 'FDCPA'].includes(spec.disputeBasis)) {
    throw new Error('A direct packet requires an explicit FCRA or FDCPA path.');
  }
  const expectedKeys = items.map((item) => {
    const decision = classifyAccountRoute(item, options);
    if (![ROUTE_CLASSIFICATIONS.DIRECT_ELIGIBLE, ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE].includes(decision.classification)) {
      throw new Error(`${item.label} is not eligible for a direct packet: ${decision.reason}`);
    }
    if (spec.disputeBasis === 'FDCPA' && decision.classification !== ROUTE_CLASSIFICATIONS.FDCPA_ELIGIBLE) {
      throw new Error(`${item.label} does not have verified FDCPA eligibility.`);
    }
    return furnisherRecipientKey(item, spec.disputeBasis);
  });
  if (new Set(expectedKeys).size !== 1) throw new Error('Direct packet accounts must share the same furnisher, verified address, and legal path.');
  return { items, recipientKey: expectedKeys[0] };
}
