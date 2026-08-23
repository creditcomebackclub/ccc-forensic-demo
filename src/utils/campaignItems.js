const bureauCode = (value) => {
  const v = String(value || '').toLowerCase();
  if (v === 'eq' || v.includes('equifax')) return 'equifax';
  if (v === 'exp' || v.includes('experian')) return 'experian';
  if (v === 'tu' || v.includes('transunion')) return 'transunion';
  return null;
};

export function getCampaignItemBureaus(item) {
  const raw = item?.snapshot?.bureaus || [];
  return [...new Set(raw.map(bureauCode).filter(Boolean))];
}

export function buildCleanupRouteGroups(items = []) {
  const groups = new Map();
  for (const item of items) {
    const kind = item.kind || item.item_kind;
    if (!['personal_info', 'inquiry'].includes(kind) || !item.id) continue;
    for (const targetBureau of getCampaignItemBureaus(item)) {
      const group = groups.get(targetBureau) || {
        targetBureau, itemIds: [], personalInfoCount: 0, inquiryCount: 0,
      };
      group.itemIds.push(item.id);
      if (kind === 'personal_info') group.personalInfoCount += 1;
      else group.inquiryCount += 1;
      groups.set(targetBureau, group);
    }
  }
  return ['equifax', 'experian', 'transunion']
    .map((bureau) => groups.get(bureau))
    .filter(Boolean);
}

const stableKey = (value) => String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

export function buildCampaignItems(auditRecord) {
  const audit = auditRecord?.audit || {};
  const sourceBoundV4 = audit.schemaVersion === 'deterministic-audit-v4'
    && audit.evaluationMode === 'deterministic';
  const items = [];
  let sort = 0;
  for (const account of audit.accounts || []) {
    if (!account.clientAccountId) continue;
    // New deterministic audits retain all extracted accounts for provenance,
    // including accounts with review-only observations. Those are not valid
    // dispute targets until a rule emits at least one authorized FLAG. Legacy
    // audit snapshots remain unchanged for backward compatibility.
    if (Array.isArray(account.findings) && !(account.violations || []).length) continue;
    items.push({
      item_kind: 'account',
      source_key: `account:${account.clientAccountId}`,
      client_account_id: account.clientAccountId,
      label: account.furnisher || 'Unknown account',
      snapshot: { ...account, auditReportDate: audit.client?.reportDate || auditRecord?.date || null },
      sort_order: sort++,
    });
  }
  const personal = audit.personalInfo || {};
  const protectedNames = new Set([audit.client?.name, personal.keepOnFile?.name].map(stableKey).filter(Boolean));
  const sourceBoundObservations = Array.isArray(personal.observations) ? personal.observations : [];
  const personalGroups = sourceBoundV4 ? [
    ['former_address', sourceBoundObservations.filter((entry) => entry?.category === 'former_address'), 'Former address'],
    ['name_variant', sourceBoundObservations.filter((entry) => entry?.category === 'name_variant'), 'Name variation'],
    ['former_employer', sourceBoundObservations.filter((entry) => entry?.category === 'former_employer'), 'Former employer'],
  ] : [
    ['former_address', personal.formerAddresses || personal.addresses || [], 'Former address'],
    ['name_variant', personal.nameVariants || personal.names || [], 'Name variation'],
    ['former_employer', personal.formerEmployers || personal.employers || [], 'Former employer'],
  ];
  for (const [category, values, prefix] of personalGroups) {
    for (const value of values) {
      const label = typeof value === 'string' ? value : (value?.value || value?.address || value?.name || value?.employer || JSON.stringify(value));
      if (!label) continue;
      if (category === 'name_variant' && protectedNames.has(stableKey(label))) continue;
      const reportedBureaus = typeof value === 'object' && value !== null
        ? [...new Set([...(value.bureaus || []), value.bureau].map(bureauCode).filter(Boolean))]
        : [];
      if (sourceBoundV4 && (!Number.isInteger(Number(value?.page)) || Number(value.page) < 1 || !reportedBureaus.length)) continue;
      items.push({
        item_kind: 'personal_info', source_key: `personal:${category}:${stableKey(label)}`,
        client_account_id: null, label: `${prefix}: ${label}`,
        snapshot: {
          category, value: label,
          sourcePage: sourceBoundV4 ? Number(value.page) : null,
          sourceEvidence: sourceBoundV4 ? [{
            bureau: ({ equifax: 'EQ', experian: 'EXP', transunion: 'TU' }[reportedBureaus[0]]),
            page: Number(value.page),
          }] : [],
          bureaus: (reportedBureaus.length ? reportedBureaus : ['equifax', 'experian', 'transunion'])
            .map((b) => ({ equifax: 'EQ', experian: 'EXP', transunion: 'TU' }[b])),
          personalInfo: personal,
        },
        sort_order: sort++,
      });
    }
  }
  for (const inquiry of audit.inquiries || []) {
    if (inquiry.category === 'linked_to_open_account') continue;
    const bureaus = [...new Set((inquiry.bureaus || []).map(bureauCode).filter(Boolean))];
    if (sourceBoundV4 && (!Number.isInteger(Number(inquiry.sourcePage)) || Number(inquiry.sourcePage) < 1 || !bureaus.length)) continue;
    items.push({
      item_kind: 'inquiry',
      source_key: `inquiry:${stableKey(inquiry.furnisher)}:${stableKey(inquiry.date)}:${bureaus.join('-')}`,
      client_account_id: null,
      label: `${inquiry.furnisher || 'Inquiry'}${inquiry.date ? ` · ${inquiry.date}` : ''}`,
      snapshot: { ...inquiry, bureaus: bureaus.map((b) => ({ equifax: 'EQ', experian: 'EXP', transunion: 'TU' }[b])) },
      sort_order: sort++,
    });
  }
  const unique = new Map();
  for (const item of items) {
    const existing = unique.get(item.source_key);
    if (!existing) {
      unique.set(item.source_key, item);
      continue;
    }
    if (item.item_kind === 'personal_info') {
      existing.snapshot.bureaus = [...new Set([...(existing.snapshot.bureaus || []), ...(item.snapshot.bureaus || [])])];
      existing.snapshot.sourceEvidence = [
        ...(existing.snapshot.sourceEvidence || []),
        ...(item.snapshot.sourceEvidence || []),
      ].filter((entry, index, all) => all.findIndex((candidate) => (
        candidate.bureau === entry.bureau && Number(candidate.page) === Number(entry.page)
      )) === index);
    }
  }
  return [...unique.values()];
}
