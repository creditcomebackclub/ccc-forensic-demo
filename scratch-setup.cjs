require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function setup() {
  const sql = `
    CREATE TABLE IF NOT EXISTS app_settings (
      id integer PRIMARY KEY DEFAULT 1,
      pricing jsonb DEFAULT '{"firstWorkFee": 49, "perDeleteTypeA": 125, "perDeleteTypeB": 75, "perDeleteTypeC": 150, "publicRecord": 175}'::jsonb,
      notifications jsonb DEFAULT '{"emailNewLeads": true, "emailClientUploads": true, "emailEscalations": true}'::jsonb,
      affiliates jsonb DEFAULT '{"defaultCommissionRate": 0.20}'::jsonb,
      disputes jsonb DEFAULT '{"defaultAggressiveness": "Standard"}'::jsonb,
      updated_at timestamp with time zone DEFAULT timezone('utc'::text, now())
    );
    INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
  `;
  const { error } = await supabase.rpc('run_sql', { sql });
  if (error) {
    console.error('RPC failed, trying raw insert if table exists...');
    const { data, error: insertError } = await supabase.from('app_settings').upsert({ id: 1 }).select();
    if (insertError) {
      console.error('Failed to create/seed app_settings:', insertError);
    } else {
      console.log('Successfully seeded app_settings via insert:', data);
    }
  } else {
    console.log('Successfully created and seeded app_settings table via RPC.');
  }
}
setup();
