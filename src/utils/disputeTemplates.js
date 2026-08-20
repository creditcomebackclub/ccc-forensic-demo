import { supabase } from './supabase.js';

function normalizeTemplate(row) {
  return {
    id: row.id,
    createdBy: row.created_by,
    name: row.name,
    flow: row.flow_code,
    round: row.round_number,
    bureau: row.bureau_code,
    version: row.version_label,
    body: row.body_text,
    notes: row.notes || '',
    active: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDisputeTemplates({ activeOnly = false } = {}) {
  let query = supabase
    .from('dispute_templates')
    .select('*')
    .order('flow_code')
    .order('round_number')
    .order('bureau_code')
    .order('updated_at', { ascending: false });
  if (activeOnly) query = query.eq('is_active', true);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(normalizeTemplate);
}

export async function saveDisputeTemplate(template) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const row = {
    name: String(template.name || '').trim(),
    flow_code: template.flow,
    round_number: Number(template.round),
    bureau_code: template.bureau || 'ALL',
    version_label: String(template.version || 'v1').trim(),
    body_text: String(template.body || '').trim(),
    notes: String(template.notes || '').trim() || null,
    is_active: template.active !== false,
    updated_at: new Date().toISOString(),
  };
  if (!row.name || !row.body_text) throw new Error('Template name and body are required.');

  let query;
  if (template.id) {
    query = supabase.from('dispute_templates').update(row).eq('id', template.id).select().single();
  } else {
    query = supabase.from('dispute_templates').insert({ ...row, created_by: userId }).select().single();
  }
  const { data, error } = await query;
  if (error) throw error;
  return normalizeTemplate(data);
}

export async function retireDisputeTemplate(id) {
  const { data, error } = await supabase
    .from('dispute_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return normalizeTemplate(data);
}

export function templatesForRecommendation(templates, recommendation, bureauCode) {
  return (templates || [])
    .filter((template) => template.active
      && template.flow === recommendation?.flow
      && Number(template.round) === Number(recommendation?.round || 1)
      && (template.bureau === bureauCode || template.bureau === 'ALL'))
    .sort((a, b) => {
      const bureauDelta = Number(b.bureau === bureauCode) - Number(a.bureau === bureauCode);
      if (bureauDelta) return bureauDelta;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
}
