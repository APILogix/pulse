import type { FastifyBaseLogger } from 'fastify';
import { pgboss } from '../../../lib/pgboss.js';
import type { EffectiveAlertPolicy } from '../policy/types.js';

export interface EscalationSnapshotJob {
  organizationId: string;
  alertKey: string;
  notificationJobId?: string;
  policy: Pick<EffectiveAlertPolicy, 'policyId' | 'version' | 'escalationPolicyId' | 'requestedChannels'>;
  step: number;
  notifyAt: string;
}

export class SnapshotEscalationWorker {
  constructor(private readonly logger: FastifyBaseLogger) {}

  async schedule(job: EscalationSnapshotJob): Promise<void> {
    await pgboss.send('alert.escalate', job, {
      singletonKey: `alert-escalate:${job.alertKey}:${job.step}`,
      startAfter: Math.max(0, Date.parse(job.notifyAt) - Date.now()),
      retryLimit: 3,
      retryDelay: 1,
      retryBackoff: true,
    } as never);
  }

  async run(job: EscalationSnapshotJob): Promise<void> {
    this.logger.info({ alertKey: job.alertKey, step: job.step, policyVersion: job.policy.version }, 'Escalation snapshot processed');
  }
}

export async function runCorrelationSweep(organizationId: string): Promise<void> {
  await pgboss.send('alert.correlate', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true } as never);
}

export async function runDigestSweep(organizationId: string): Promise<void> {
  await pgboss.send('notification.digest', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true } as never);
}
