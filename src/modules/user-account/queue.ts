import type { FastifyBaseLogger } from 'fastify';

import { pgboss } from '../../lib/pgboss.js';
import { buildUserDataExport } from './service.js';
import { logSecurityEvent } from './security-events.js';

const QUEUE_NAME = 'user-data-export';

async function safeCreateQueue(name: string): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (n: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') {
    await boss.createQueue(name).catch(() => undefined);
  }
}

export async function registerUserDataExportWorker(
  logger: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  await safeCreateQueue(QUEUE_NAME);

  await pgboss.work(
    QUEUE_NAME,
    { teamSize: 1, teamConcurrency: 1 } as never,
    (async (job: { data?: { user_id?: string }; id?: string }) => {
      const userId = job.data?.user_id;
      if (!userId) {
        throw new Error('user-data-export job missing user_id');
      }

      const data = await buildUserDataExport(userId);
      const sizeBytes = Buffer.byteLength(JSON.stringify(data), 'utf8');

      logger.info(
        { jobId: job.id, userId, sizeBytes },
        'User data export generated; storage/email delivery integration pending',
      );
      await logSecurityEvent(userId, 'data_export_requested', 'Account data export generated', undefined, {
        job_id: job.id ?? null,
        size_bytes: sizeBytes,
        delivery: 'pending_storage_integration',
      });
    }) as never,
  );

  logger.info({ queue: QUEUE_NAME }, 'User data export worker registered');
  return {
    stop: async () => undefined,
  };
}
