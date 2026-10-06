/**
 * DEPRECATED: pg-boss has been migrated to Supabase PGMQ (src/lib/pgmq.ts).
 * This module is kept as a no-op / compatibility bridge.
 */
import { logger } from '../config/logger.js';
import { pgmq } from './pgmq.js';
const log = logger.child({ component: 'pgboss-deprecated' });
export const pgboss = {
    createQueue: async (name, ..._rest) => pgmq.createQueue(name),
    send: async (name, data, options) => pgmq.send(name, data, options),
    work: async (..._args) => { },
    schedule: async (..._args) => { },
    unschedule: async (..._args) => { },
    start: async (..._args) => { },
    stop: async (..._args) => { },
    on: (..._args) => pgboss,
};
export async function startPgBoss(_timeout) {
    log.debug('startPgBoss called (noop, using Supabase PGMQ)');
}
export async function stopPgBoss(_timeout) {
    log.debug('stopPgBoss called (noop, using Supabase PGMQ)');
}
//# sourceMappingURL=pgboss.js.map