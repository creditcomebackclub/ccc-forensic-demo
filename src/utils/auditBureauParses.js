// Client helpers for the Single→Merge audit workflow.

export const BUREAU_PARSE_KEYS = ['equifax', 'experian', 'transunion'];

export function normalizeBureauKey(bureau) {
  const key = String(bureau || '').trim().toLowerCase();
  if (key === 'eq' || key === 'equifax') return 'equifax';
  if (key === 'exp' || key === 'experian') return 'experian';
  if (key === 'tu' || key === 'transunion') return 'transunion';
  return null;
}

export function bureauDisplayName(key) {
  if (key === 'equifax') return 'Equifax';
  if (key === 'experian') return 'Experian';
  if (key === 'transunion') return 'TransUnion';
  return key || 'Bureau';
}

export async function listBureauParsesForClient(clientSelection) {
  const { supabase } = await import('./supabase.js');
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');
  if (!clientSelection) return [];

  let query = supabase
    .from('audit_bureau_parses')
    .select('id,bureau,client_id,client_name,report_date,page_count,chunk_count,cohort_key,source_sha256,parse_sha256,created_at,updated_at')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });

  if (clientSelection.type === 'existing' && clientSelection.id) {
    query = query.eq('client_id', clientSelection.id);
  } else if (clientSelection.name) {
    query = query.is('client_id', null).ilike('client_name', clientSelection.name);
  } else {
    return [];
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message || 'Could not load bureau parses');
  return data || [];
}

export function summarizeBureauParses(rows) {
  const cohorts = new Map();
  for (const row of rows || []) {
    if (!/^[0-9a-f]{64}$/i.test(String(row?.cohort_key || ''))) continue;
    if (!cohorts.has(row.cohort_key)) cohorts.set(row.cohort_key, { rows: [], byBureau: {} });
    const cohort = cohorts.get(row.cohort_key);
    cohort.rows.push(row);
    const key = normalizeBureauKey(row.bureau);
    if (key) {
      if (!cohort.versionsByBureau) cohort.versionsByBureau = {};
      if (!cohort.versionsByBureau[key]) cohort.versionsByBureau[key] = [];
      cohort.versionsByBureau[key].push(row);
      if (!cohort.byBureau[key]) cohort.byBureau[key] = row;
    }
  }
  const ranked = [...cohorts.entries()].sort(([, a], [, b]) => {
    const aTime = Math.max(...a.rows.map((row) => new Date(row.created_at || row.updated_at || 0).getTime()));
    const bTime = Math.max(...b.rows.map((row) => new Date(row.created_at || row.updated_at || 0).getTime()));
    const aComplete = BUREAU_PARSE_KEYS.every((key) => !!a.byBureau[key]);
    const bComplete = BUREAU_PARSE_KEYS.every((key) => !!b.byBureau[key]);
    const aExact = aComplete && a.rows.length === 3
      && BUREAU_PARSE_KEYS.every((key) => a.versionsByBureau?.[key]?.length === 1);
    const bExact = bComplete && b.rows.length === 3
      && BUREAU_PARSE_KEYS.every((key) => b.versionsByBureau?.[key]?.length === 1);
    // Never let an older complete cohort silently beat a newer in-progress
    // report date. The operator must see and finish (or abandon) the newest
    // staged cycle explicitly.
    return bTime - aTime
      || Number(bExact) - Number(aExact)
      || Number(bComplete) - Number(aComplete);
  });
  const [cohortKey = null, selected = { rows: [], byBureau: {}, versionsByBureau: {} }] = ranked[0] || [];
  const byBureau = selected.byBureau || {};
  const versionCounts = Object.fromEntries(BUREAU_PARSE_KEYS.map((key) => [
    key, selected.versionsByBureau?.[key]?.length || 0,
  ]));
  const ready = BUREAU_PARSE_KEYS.filter((key) => !!byBureau[key]);
  const exactVersionSet = ready.length === 3
    && BUREAU_PARSE_KEYS.every((key) => versionCounts[key] === 1)
    && selected.rows.length === 3;
  return {
    byBureau,
    ready,
    missing: BUREAU_PARSE_KEYS.filter((key) => !byBureau[key]),
    canMerge: exactVersionSet,
    cohortKey,
    reportDate: (selected.rows || []).find((row) => row?.report_date)?.report_date || null,
    mergeSelection: exactVersionSet ? {
      cohortKey,
      parseIds: BUREAU_PARSE_KEYS.map((key) => byBureau[key].id),
    } : null,
    versionCounts,
    ambiguousVersionCount: Object.values(versionCounts).reduce((sum, count) => sum + Math.max(0, count - 1), 0),
    incompatibleLegacyCount: (rows || []).filter((row) => !row?.cohort_key).length,
  };
}
