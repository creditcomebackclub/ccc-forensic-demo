exports.handler = async function(event, context) {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(url + '/rest/v1/letters?client_name=eq.Stefani%20Bryant&phase=eq.Phase%201%20-%20Round%202', {
    method: 'PATCH',
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ mailed_date: '2026-07-04T12:00:00.000Z' })
  });
  return { statusCode: 200, body: 'Done: ' + res.status };
};