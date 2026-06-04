import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cvxkukmrbbctbijchole.supabase.co';
const supabaseAnonKey = 'sb_publishable_lSgBxemLZDhAuIyjicvTvQ_lAN-5rNW';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
