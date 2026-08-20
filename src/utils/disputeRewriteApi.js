import { supabase } from './supabase.js';
import { normalizeDisputeRewriteRequest } from './disputeRewriteRules.js';

export async function requestDisputeRewrite(input) {
  const payload = normalizeDisputeRewriteRequest(input);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Not signed in.');

  const response = await fetch('/.netlify/functions/rewrite-dispute-selection', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || 'Claude could not rewrite that selection.');
  if (!body.replacement || typeof body.replacement !== 'string') {
    throw new Error('Claude returned an empty rewrite. Keep the original text and try again.');
  }
  return { replacement: body.replacement, warning: body.warning || null };
}
