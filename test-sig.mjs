import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data: cp } = await supabase.from('client_profiles').select('*').eq('full_name', 'Karl J Elliott').limit(1);
  console.log('Client Profile:', cp);
  const { data: c } = await supabase.from('clients').select('*').eq('name', 'Karl J Elliott').limit(1);
  console.log('Client:', c);
}
run();
