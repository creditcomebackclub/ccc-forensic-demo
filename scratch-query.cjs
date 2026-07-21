const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const envContent = fs.readFileSync('/Users/chris/Desktop/ccc-demo/.env.local', 'utf8');
const env = envContent.split('\n').reduce((acc, line) => {
  const [k, ...v] = line.split('=');
  if (k && v.length) acc[k] = v.join('=');
  return acc;
}, {});

const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('letters').select('id, client_name, furnisher, tracking_status, tracking_number, lob_id, saved_at').ilike('client_name', '%Pope%').order('saved_at', { ascending: false });
  console.log("Error:", error);
  console.log("William Pope letters:");
  console.dir(data, { depth: null });
}
run();
