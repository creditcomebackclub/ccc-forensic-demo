export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mlsbdmewxocgweotcdud.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/letters?client_name=eq.Stefani%20Bryant&phase2_analyzed_at=is.null`, {
      method: 'PATCH',
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ phase2_analyzed_at: new Date().toISOString() })
    });
    
    return { statusCode: 200, body: `Updated status: ${res.status}` };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
