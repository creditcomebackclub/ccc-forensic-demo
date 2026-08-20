import { supabase } from './supabase';

/**
 * Fire-and-forget partner email for staff/system events.
 * Failures must never block CRM or billing saves.
 */
export async function notifyAffiliate(event, extra = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/.netlify/functions/notify-affiliate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event, ...extra }),
    });
  } catch (e) {
    console.warn('notifyAffiliate failed (non-fatal):', e?.message || e);
  }
}
