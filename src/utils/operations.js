import { supabase } from './supabase.js';
export { operationArea, summarizeOperations } from './operationsSummary.js';

export async function getOperationsQueue(limit = 200) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 200, 500));
  const { data, error } = await supabase.rpc('get_operations_queue', { p_limit: safeLimit });
  if (error) throw error;
  return (data || []).map((row) => ({
    issueKey: row.issue_key,
    source: row.source,
    sourceId: row.source_id,
    severity: row.severity,
    status: row.status,
    clientId: row.client_id || null,
    clientName: row.client_name || null,
    title: row.title,
    detail: row.detail,
    occurredAt: row.occurred_at,
    updatedAt: row.updated_at,
    destination: row.destination,
  }));
}

export async function listCertificationClients() {
  const { data, error } = await supabase
    .from('clients')
    .select('id,name,status,is_vip')
    .neq('status', 'lead')
    .order('name', { ascending: true })
    .limit(500);
  if (error) throw error;
  return data || [];
}

export async function getClientProductionReadiness(clientId) {
  if (!clientId) return [];
  const { data, error } = await supabase.rpc('get_client_production_readiness', { p_client_id: clientId });
  if (error) throw error;
  return (data || []).map((row) => ({
    sequence: row.sequence,
    key: row.check_key,
    label: row.label,
    status: row.status,
    detail: row.detail,
    evidenceAt: row.evidence_at,
  }));
}
