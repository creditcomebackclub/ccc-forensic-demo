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
  const { data, error } = await supabase.from('letters')
    .update({ tracking_status: 'Delivered', delivered_at: '2026-07-06T18:20:21Z' })
    .eq('lob_id', 'ltr_07e4b0df590880ee');
  console.log("Error:", error);
  console.log("Updated!");
}
run();
