import type { FastifyBaseLogger } from 'fastify';

import { pgmq, type PgmqMessage } from '../../lib/pgmq.js';
import { PgmqWorker } from '../../lib/pgmq-worker.js';
import { aiConfig } from '../../config/ai.js';
import { env } from '../../config/env.js';
import { decrypt } from '../../shared/utils/encryption.js';
import { AIRepository } from './repository.js';
import { OpenAIProvider } from './openai-client.js';
import { AIAnalyzer, type AnalysisExecution } from './analyzer.js';
import { aiRequestInputSchema } from './types.js';

const QUEUE_NAME = 'ai_reliability_analysis';
const DEAD_LETTER_QUEUE_NAME = 'ai_reliability_analysis_dlq';
const RECONCILE_QUEUE_NAME = 'ai_credit_reservation_reconcile';
const CHAT_USAGE_RECONCILE_QUEUE_NAME = 'ai_chat_usage_reconcile';

export async function enqueueAIJob(jobId: string): Promise<string> {
  return pgmq.send(QUEUE_NAME, { jobId });
}

export async function registerAIWorkers(
  log: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  await pgmq.createQueues(
    [
      QUEUE_NAME,
      DEAD_LETTER_QUEUE_NAME,
      RECONCILE_QUEUE_NAME,
      CHAT_USAGE_RECONCILE_QUEUE_NAME,
    ],
    { concurrency: 4 },
  );

  const repository = new AIRepository();
  const provider = new OpenAIProvider(aiConfig, log);
  const analyzer = new AIAnalyzer(repository, provider, aiConfig, log);

  await repository.releaseStaleReservations().catch((error) => {
    log.warn({ err: error }, 'Initial AI reservation reconciliation failed');
  });

  // Reconcile worker
  const reconcileWorker = new PgmqWorker(
    pgmq,
    async () => {
      const released = await repository.releaseStaleReservations();
      if (released > 0) log.warn({ released }, 'Released stale AI credit reservations');
    },
    { queue: RECONCILE_QUEUE_NAME, batchSize: 1, concurrency: 1 },
  );

  // Chat usage reconcile worker
  const chatWorker = new PgmqWorker(
    pgmq,
    async () => {
      const logged = await repository.reconcilePendingChatUsage();
      if (logged > 0) log.info({ logged }, 'Reconciled completed AI chat usage logs');
    },
    { queue: CHAT_USAGE_RECONCILE_QUEUE_NAME, batchSize: 1, concurrency: 1 },
  );

  // Main AI reliability worker
  const aiWorker = new PgmqWorker(
    pgmq,
    async (msg: PgmqMessage<{ jobId?: string }>) => {
      const jobId = msg.message?.jobId;
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
    },
    {
      queue: QUEUE_NAME,
      batchSize: 1,
      concurrency: 2,
      visibilityTimeoutSeconds: 600,
      deadLetterQueue: DEAD_LETTER_QUEUE_NAME,
      maxAttempts: 3,
    },
  );

  const workers = [reconcileWorker, chatWorker, aiWorker];
  await Promise.all(workers.map((w) => w.start()));

  // Periodic dispatch timers
  const timers = [
    setInterval(() => void pgmq.send(RECONCILE_QUEUE_NAME, {}).catch(() => undefined), 300_000),
    setInterval(() => void pgmq.send(CHAT_USAGE_RECONCILE_QUEUE_NAME, {}).catch(() => undefined), 60_000),
  ];
  for (const t of timers) t.unref();

  log.info({ queue: QUEUE_NAME }, 'AI reliability worker registered with PGMQ');
  return {
    stop: async () => {
      for (const t of timers) clearInterval(t);
      await Promise.all(workers.map((w) => w.stop()));
    },
  };
}
