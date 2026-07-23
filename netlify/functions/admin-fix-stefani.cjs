const { createClient } = require('@supabase/supabase-js');
exports.handler = async function(event, context) {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data, error } = await supabase.from('letters').update({ mailed_date: '2026-07-20T12:00:00.000Z' }).eq('client_name', 'Stefani Bryant').eq('phase', 'Phase 1 - Round 2');
  return { statusCode: 200, body: JSON.stringify({ success: true, data, error }) };
};