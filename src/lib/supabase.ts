import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const log = logger.child({ component: 'supabase' });

let supabaseClient: SupabaseClient | null = null;
let supabaseAdminClient: SupabaseClient | null = null;

/**
 * Returns the public / anon Supabase client.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    return null;
  }
  if (!supabaseClient) {
    supabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    log.info('Supabase public client initialized');
  }
  return supabaseClient;
}

/**
 * Returns the admin / service_role Supabase client.
 */
export function getSupabaseAdminClient(): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
    return null;
  }
  if (!supabaseAdminClient) {
    supabaseAdminClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
    log.info('Supabase admin client initialized');
  }
  return supabaseAdminClient;
}
