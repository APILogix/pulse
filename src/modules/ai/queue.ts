import type { FastifyBaseLogger } from 'fastify';

import { pgboss } from '../../lib/pgboss.js';
import { aiConfig } from '../../config/ai.js';
import { env } from '../../config/env.js';
import { decrypt } from '../../shared/utils/encryption.js';
import { AIRepository } from './repository.js';
import { OpenAIProvider } from './openai-client.js';
import { AIAnalyzer, type AnalysisExecution } from './analyzer.js';
import { aiRequestInputSchema } from './types.js';

const QUEUE_NAME = 'ai-reliability-analysis';
const DEAD_LETTER_QUEUE_NAME = 'ai-reliability-analysis-dlq';
const RECONCILE_QUEUE_NAME = 'ai-credit-reservation-reconcile';
const CHAT_USAGE_RECONCILE_QUEUE_NAME = 'ai-chat-usage-reconcile';

async function safeCreateQueue(name = QUEUE_NAME): Promise<void> {
  const boss = pgboss as unknown as { createQueue?: (name: string) => Promise<void> };
  if (typeof boss.createQueue === 'function') await boss.createQueue(name).catch(() => undefined);
}

export async function enqueueAIJob(jobId: string): Promise<string> {
  await safeCreateQueue();
  await safeCreateQueue(DEAD_LETTER_QUEUE_NAME);
  const queueId = await pgboss.send(QUEUE_NAME, { jobId }, {
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
    deadLetter: DEAD_LETTER_QUEUE_NAME,
  });
  if (!queueId) throw new Error('Failed to enqueue AI analysis job');
  return queueId;
}

export async function registerAIWorkers(
  log: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  await safeCreateQueue();
  await safeCreateQueue(DEAD_LETTER_QUEUE_NAME);
  const repository = new AIRepository();
  const provider = new OpenAIProvider(aiConfig, log);
  const analyzer = new AIAnalyzer(repository, provider, aiConfig, log);
  await safeCreateQueue(RECONCILE_QUEUE_NAME);
  await repository.releaseStaleReservations().catch((error) => {
    log.warn({ err: error }, 'Initial AI reservation reconciliation failed');
  });
  await pgboss.work(
    RECONCILE_QUEUE_NAME,
    {} as never,
    (async () => {
      const released = await repository.releaseStaleReservations();
      if (released > 0) log.warn({ released }, 'Released stale AI credit reservations');
    }) as never,
  );
  await pgboss.schedule(RECONCILE_QUEUE_NAME, '*/5 * * * *', {}, {} as never);

  await safeCreateQueue(CHAT_USAGE_RECONCILE_QUEUE_NAME);
  await pgboss.work(
    CHAT_USAGE_RECONCILE_QUEUE_NAME,
    {} as never,
    (async () => {
      const logged = await repository.reconcilePendingChatUsage();
      if (logged > 0) log.info({ logged }, 'Reconciled completed AI chat usage logs');
    }) as never,
  );
  await pgboss.schedule(CHAT_USAGE_RECONCILE_QUEUE_NAME, '* * * * *', {}, {} as never);

  await pgboss.work(
    QUEUE_NAME,
    { teamSize: 2, teamConcurrency: 1 } as never,
    (async (job: { id?: string; data?: { jobId?: string } }) => {
      const jobId = job.data?.jobId;
      if (!jobId) throw new Error('AI job payload is missing jobId');
      const record = await repository.loadJob(jobId);
      if (!record) return;
      let execution: AnalysisExecution | null = null;
      try {
        if (!record.encryptedInput) throw new Error('AI job encrypted input is unavailable');
        const input = aiRequestInputSchema.parse(JSON.parse(decrypt(record.encryptedInput, env.ENCRYPTION_KEY)));
        execution = await analyzer.analyze(input, {
          tenantId: record.tenantId,
          userId: record.userId,
          idempotencyKey: `ai-job:${record.jobId}`,
        });
        if (execution.answer.status !== 'SUCCESS' && execution.answer.status !== 'PARTIAL') {
          throw new Error(`AI job completed with ${execution.answer.status}`);
        }
        await analyzer.confirmDelivery(execution);
        if (!execution.responseId) throw new Error('AI job did not persist a response');
        await repository.finishJob(jobId, execution.responseId);
      } catch (error) {
        if (execution?.reservation) {
          await analyzer.cancelDelivery(execution, 'Asynchronous AI job delivery failed').catch((releaseError) => {
            log.error({ err: releaseError, jobId }, 'AI job reservation release failed');
          });
        }
        await repository.failJob(jobId, error instanceof Error ? error.message : 'Unknown AI job failure');
        throw error;
      }
    }) as never,
  );

  log.info({ queue: QUEUE_NAME }, 'AI reliability worker registered');
  return {
    stop: async () => {
      await pgboss.unschedule(RECONCILE_QUEUE_NAME).catch(() => undefined);
      await pgboss.unschedule(CHAT_USAGE_RECONCILE_QUEUE_NAME).catch(() => undefined);
    },
  };
}
