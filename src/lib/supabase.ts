import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY (copy .env.example to .env)');

// Publishable key only: everything here ships inside the app. Access is enforced by the database rules.
export const supabase = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } });
