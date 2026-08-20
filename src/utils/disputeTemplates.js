import { supabase } from './supabase.js';
import { dateAfterDays } from './disputeTemplateSelection.js';
export { templatesForRecommendation } from './disputeTemplateSelection.js';

function normalizeTemplate(row) {
  const performance = row.performance || {};
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
    familyKey: row.template_family_key || `${String(row.flow_code || '').toUpperCase()}:R${row.round_number}:${row.bureau_code}`,
    publishedOn: row.published_on || null,
    reviewDueOn: row.review_due_on || null,
    supersedesTemplateId: row.supersedes_template_id || null,
    retiredAt: row.retired_at || null,
    retirementReason: row.retirement_reason || '',
    timesMailed: Number(performance.times_mailed || 0),
    resultsRecorded: Number(performance.results_recorded || 0),
    wins: Number(performance.wins || 0),
    nonDeletionResults: Number(performance.non_deletion_results || 0),
    winRate: performance.win_rate == null ? null : Number(performance.win_rate),
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
  const [{ data, error }, { data: performanceRows, error: performanceError }] = await Promise.all([
    query,
    supabase.from('dispute_template_performance').select('*'),
  ]);
  if (error) throw error;
  if (performanceError) throw performanceError;
  const performanceById = new Map((performanceRows || []).map((row) => [row.template_id, row]));
  return (data || []).map((row) => normalizeTemplate({ ...row, performance: performanceById.get(row.id) }));
}

export async function saveDisputeTemplate(template) {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) throw new Error('Not signed in.');

  const publishedOn = template.publishedOn || new Date().toISOString().slice(0, 10);
  const row = {
    name: String(template.name || '').trim(),
    flow_code: template.flow,
    round_number: Number(template.round),
    bureau_code: template.bureau || 'ALL',
    version_label: String(template.version || 'v1').trim(),
    body_text: String(template.body || '').trim(),
    notes: String(template.notes || '').trim() || null,
    is_active: template.active !== false,
    template_family_key: String(template.familyKey || `${String(template.flow || '').toUpperCase()}:R${Number(template.round)}:${template.bureau || 'ALL'}`).trim(),
    published_on: publishedOn,
    review_due_on: template.reviewDueOn || dateAfterDays(publishedOn, 90),
    supersedes_template_id: template.supersedesTemplateId || null,
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
    .update({
      is_active: false,
      retired_at: new Date().toISOString(),
      retirement_reason: 'Quarterly version review',
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return normalizeTemplate(data);
}
