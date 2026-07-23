exports.handler = async (event, context) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { statusCode: 500, body: 'Missing env' };

  async function updateName(table) {
    const res = await fetch(`${supabaseUrl}/rest/v1/${table}?name=ilike.*Alex%`, {
      method: 'GET',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
    const records = await res.json();
    let count = 0;
    for (let r of records) {
      await fetch(`${supabaseUrl}/rest/v1/${table}?id=eq.${r.id}`, {
        method: 'PATCH',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'Alex Hamidzadeh' })
      });
      count++;
    }
    return count;
  }

  const cCount = await updateName('clients');
  const aCount = await updateName('affiliates');
  const tCount = await updateName('team_members');

  return { statusCode: 200, body: `Updated ${cCount} clients, ${aCount} affiliates, ${tCount} team members.` };
};
