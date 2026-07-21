import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env', 'utf8').split('\n').reduce((acc, line) => {
  const [key, ...val] = line.split('=');
  if (key) acc[key] = val.join('=');
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('clients').select('*').ilike('name', '%Karl%');
  console.log("Karl clients:", data);
  
  if (data && data[0]) {
      const { data: accounts } = await supabase.from('accounts').select('*').eq('client_name', data[0].name);
      console.log("Karl accounts:", accounts);
  }
}
run();
