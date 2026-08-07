import { supabase } from './supabase';

/**
 * Fire-and-forget staff alert for verified client portal events.
 * Failures must never block enrollment or uploads.
 */
export async function notifyStaff(event, extra = {}) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return;
    await fetch('/.netlify/functions/notify-staff', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ event, ...extra }),
    });
  } catch (e) {
    console.warn('notifyStaff failed (non-fatal):', e?.message || e);
  }
}
