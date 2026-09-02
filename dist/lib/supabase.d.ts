import { type SupabaseClient } from '@supabase/supabase-js';
/**
 * Returns the public / anon Supabase client.
 */
export declare function getSupabaseClient(): SupabaseClient | null;
/**
 * Returns the admin / service_role Supabase client.
 */
export declare function getSupabaseAdminClient(): SupabaseClient | null;
//# sourceMappingURL=supabase.d.ts.map