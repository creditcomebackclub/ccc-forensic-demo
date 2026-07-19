export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://mlsbdmewxocgweotcdud.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/letters?id=eq.webhook-debug`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const data = await res.json();
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
