import { pgmq } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { buildUserDataExport } from './service.js';
import { logSecurityEvent } from './security-events.js';
const QUEUE_NAME = 'user_data_export';
export async function enqueueUserDataExport(userId) {
    return pgmq.send(QUEUE_NAME, { user_id: userId });
}
export async function registerUserDataExportWorker(logger) {
    const worker = new PgmqWorker(pgmq, async (msg) => {
        const userId = msg.message?.user_id;
        if (!userId) {
            throw new Error('user_data_export job missing user_id');
        }
        const data = await buildUserDataExport(userId);
        const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
        logger.info({ jobId: msg.msgId, userId, sizeBytes }, 'User data export generated; storage/email delivery integration pending');
        await logSecurityEvent(userId, 'data_export_requested', 'Account data export generated', undefined, {
            job_id: msg.msgId,
            size_bytes: sizeBytes,
            delivery: 'pending_storage_integration',
        });
    }, { queue: QUEUE_NAME, batchSize: 1, concurrency: 1, visibilityTimeoutSeconds: 300 });
    await worker.start();
    logger.info({ queue: QUEUE_NAME }, 'User data export worker registered with PGMQ');
    return {
        stop: async () => {
            await worker.stop();
        },
    };
}
//# sourceMappingURL=queue.js.map