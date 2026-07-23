const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) return { statusCode: 500, body: 'Missing env' };

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Check clients
  const { data: clients } = await supabase.from('clients').select('*').ilike('name', '%Alexes%');
  for (let c of clients || []) {
    await supabase.from('clients').update({ name: 'Alexes Hamidzadeh' }).eq('id', c.id);
  }

  // 2. Check affiliates
  const { data: affiliates } = await supabase.from('affiliates').select('*').ilike('name', '%Alexes%');
  for (let a of affiliates || []) {
    await supabase.from('affiliates').update({ name: 'Alexes Hamidzadeh' }).eq('id', a.id);
  }

  // 3. Check team members
  const { data: team } = await supabase.from('team_members').select('*').ilike('name', '%Alexes%');
  for (let t of team || []) {
    await supabase.from('team_members').update({ name: 'Alexes Hamidzadeh' }).eq('id', t.id);
  }

  return { statusCode: 200, body: `Updated ${clients?.length || 0} clients, ${affiliates?.length || 0} affiliates, ${team?.length || 0} team members.` };
};
