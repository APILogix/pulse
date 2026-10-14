/**
 * DEPRECATED: pg-boss has been migrated to Supabase PGMQ (src/lib/pgmq.ts).
 * This module is kept as a no-op / compatibility bridge.
 */
import { logger } from '../config/logger.js';
import { pgmq } from './pgmq.js';

const log = logger.child({ component: 'pgboss-deprecated' });

export const pgboss: any = {
  createQueue: async (name: string, ..._rest: any[]) => pgmq.createQueue(name),
  send: async (name: string, data: any, options?: any) => pgmq.send(name, data, options),
  work: async (..._args: any[]) => {},
  schedule: async (..._args: any[]) => {},
  unschedule: async (..._args: any[]) => {},
  start: async (..._args: any[]) => {},
  stop: async (..._args: any[]) => {},
  on: (..._args: any[]) => pgboss,
};

export async function startPgBoss(_timeout?: number): Promise<void> {
  log.debug('startPgBoss called (noop, using Supabase PGMQ)');
}

export async function stopPgBoss(_timeout?: number): Promise<void> {
  log.debug('stopPgBoss called (noop, using Supabase PGMQ)');
}
