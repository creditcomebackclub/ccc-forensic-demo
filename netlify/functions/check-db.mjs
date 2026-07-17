import { createClient } from '@supabase/supabase-js';

export const handler = async (event) => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) return { statusCode: 500, body: 'Missing env' };

  const db = createClient(supabaseUrl, serviceKey);

  const { data, error } = await db
    .from('letters')
    .select('id, client_name, furnisher, phase, saved_at, html')
    .order('saved_at', { ascending: false })
    .limit(3);

  if (error) return { statusCode: 500, body: JSON.stringify(error) };
  return { statusCode: 200, body: JSON.stringify(data.map(d => ({ ...d, html: d.html.substring(0, 150) })), null, 2) };
};
