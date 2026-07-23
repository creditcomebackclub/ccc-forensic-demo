exports.handler = async (event, context) => {
  const { createClient } = require('@supabase/supabase-js');
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: aff } = await supabase.from('affiliates').select('*').ilike('name', '%Alex%');
  const { data: clients } = await supabase.from('clients').select('id, name, referred_by').not('referred_by', 'is', null);
  
  return { statusCode: 200, body: JSON.stringify({ affiliates: aff, clients: clients }) };
};
