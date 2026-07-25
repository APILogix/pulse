import { pgboss } from '../../lib/pgboss.js';
import { buildUserDataExport } from './service.js';
import { logSecurityEvent } from './security-events.js';
const QUEUE_NAME = 'user-data-export';
async function safeCreateQueue(name) {
    const boss = pgboss;
    if (typeof boss.createQueue === 'function') {
        await boss.createQueue(name).catch(() => undefined);
    }
}
export async function registerUserDataExportWorker(logger) {
    await safeCreateQueue(QUEUE_NAME);
    await pgboss.work(QUEUE_NAME, { teamSize: 1, teamConcurrency: 1 }, (async (job) => {
        const userId = job.data?.user_id;
        if (!userId) {
            throw new Error('user-data-export job missing user_id');
        }
        const data = await buildUserDataExport(userId);
        const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
        logger.info({ jobId: job.id, userId, sizeBytes }, 'User data export generated; storage/email delivery integration pending');
        await logSecurityEvent(userId, 'data_export_requested', 'Account data export generated', undefined, {
            job_id: job.id ?? null,
            size_bytes: sizeBytes,
            delivery: 'pending_storage_integration',
        });
    }));
    logger.info({ queue: QUEUE_NAME }, 'User data export worker registered');
    return {
        stop: async () => undefined,
    };
}
//# sourceMappingURL=queue.js.map