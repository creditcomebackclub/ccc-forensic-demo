export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mlsbdmewxocgweotcdud.supabase.co';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!supabaseKey) return { statusCode: 500, body: 'Missing supabase key' };

  const letters = [
    { lob_id: 'ltr_aa0064da2055504b', delivered_at: new Date('July 20, 2026 09:44:00').toISOString() },
    { lob_id: 'ltr_398e538c1716442b', delivered_at: new Date('July 18, 2026 05:27:00').toISOString() },
    { lob_id: 'ltr_089c606aea960aed', delivered_at: new Date('July 18, 2026 05:27:00').toISOString() },
  ];

  const results = [];
  for (const letter of letters) {
    const patch = {
      tracking_status: 'Delivered',
      delivered_at: letter.delivered_at
    };
    try {
      const res = await fetch(`${supabaseUrl}/rest/v1/letters?lob_id=eq.${letter.lob_id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(patch)
      });
      const data = await res.json();
      results.push({ id: letter.lob_id, status: res.status, data });
    } catch(e) {
      results.push({ id: letter.lob_id, error: e.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify(results) };
};
