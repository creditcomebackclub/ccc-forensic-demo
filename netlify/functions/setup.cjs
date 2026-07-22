const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

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

  let result = 'Success';
  
  // run_sql must exist, it's a standard supabase function or maybe not? 
  // Let's try it. If it doesn't exist, we will use a different approach.
  const { data, error } = await supabase.rpc('run_sql', { sql });
  
  if (error) {
    result = 'RPC Error: ' + error.message;
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ result, data })
  };
};
