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
    .select('id,bureau,client_id,client_name,report_date,page_count,chunk_count,updated_at')
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
  const byBureau = {};
  for (const row of rows || []) {
    const key = normalizeBureauKey(row.bureau);
    if (!key || byBureau[key]) continue;
    byBureau[key] = row;
  }
  const ready = BUREAU_PARSE_KEYS.filter((key) => !!byBureau[key]);
  return {
    byBureau,
    ready,
    missing: BUREAU_PARSE_KEYS.filter((key) => !byBureau[key]),
    canMerge: ready.length === 3,
  };
}
