/**
 * Optional Fieldwork Supabase client.
 * Uses VITE_FIELDWORK_SUPABASE_* only — never the CCC VITE_SUPABASE_* keys
 * from src/utils/supabase.js.
 */
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_FIELDWORK_SUPABASE_URL;
const anon = import.meta.env.VITE_FIELDWORK_SUPABASE_ANON_KEY;

export const fieldworkCloudEnabled = Boolean(url && anon);

export const fieldworkSupabase = fieldworkCloudEnabled
  ? createClient(url, anon, {
      auth: {
        persistSession: true,
        storageKey: 'fieldwork-auth',
        detectSessionInUrl: true,
      },
    })
  : null;
