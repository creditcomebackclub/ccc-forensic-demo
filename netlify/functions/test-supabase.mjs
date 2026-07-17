export const handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/letters?id=eq.karl-j-elliott__experian__personal-info-cleanup__2026-07-17&select=html`, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`
      }
    });
    const data = await res.json();
    return { statusCode: 200, body: JSON.stringify({ html: data[0]?.html }) };
  } catch (e) {
    return { statusCode: 500, body: e.message };
  }
};
