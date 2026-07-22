const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
// fallback to standard env if not local
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

async function run() {
  const { data, error } = await supabase.from('client_profiles').select('full_name, signature_data').ilike('full_name', '%Karl%');
  if (error) console.error(error);
  console.log(data);
}
run();
