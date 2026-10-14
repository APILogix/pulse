import type { FastifyBaseLogger } from 'fastify';
import { pgmq } from '../../../lib/pgmq.js';
import { PgmqWorker } from '../../../lib/pgmq-worker.js';
import { DomainsRepository } from './domains.repository.js';
import { DomainsService } from './domains.service.js';

export const ORGANIZATION_DOMAIN_VERIFICATION_JOB = 'org_domain_verification';

export async function registerOrganizationDomainVerificationJob(
  log: FastifyBaseLogger,
): Promise<{ stop: () => Promise<void> }> {
  const service = new DomainsService(new DomainsRepository(), async () => undefined, async () => undefined, log);
  await pgmq.createQueue(ORGANIZATION_DOMAIN_VERIFICATION_JOB);

  const worker = new PgmqWorker(
    pgmq,
    async () => {
      const result = await service.verifyPending(200);
      log.info(result, 'Organization domain verification batch complete');
    },
    { queue: ORGANIZATION_DOMAIN_VERIFICATION_JOB, batchSize: 1, concurrency: 1 },
  );

  await worker.start();

  const timer = setInterval(() => {
    void pgmq.send(ORGANIZATION_DOMAIN_VERIFICATION_JOB, {}).catch(() => {});
  }, 1800_000); // every 30m
  timer.unref();

  return {
    stop: async () => {
      clearInterval(timer);
      await worker.stop();
    },
  };
}
