exports.handler = async () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  
  const fetchWithKey = async (url) => {
    const r = await fetch(url, {
      headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
    });
    return r.json();
  };
  
  const res = await fetchWithKey(`${supabaseUrl}/rest/v1/clients?limit=1`);
  
  return { statusCode: 200, body: JSON.stringify(res) };
};
