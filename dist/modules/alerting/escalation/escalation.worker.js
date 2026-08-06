import { pgboss } from '../../../lib/pgboss.js';
export class SnapshotEscalationWorker {
    logger;
    constructor(logger) {
        this.logger = logger;
    }
    async schedule(job) {
        await pgboss.send('alert.escalate', job, {
            singletonKey: `alert-escalate:${job.alertKey}:${job.step}`,
            startAfter: Math.max(0, Date.parse(job.notifyAt) - Date.now()),
            retryLimit: 3,
            retryDelay: 1,
            retryBackoff: true,
        });
    }
    async run(job) {
        this.logger.info({ alertKey: job.alertKey, step: job.step, policyVersion: job.policy.version }, 'Escalation snapshot processed');
    }
}
export async function runCorrelationSweep(organizationId) {
    await pgboss.send('alert.correlate', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
}
export async function runDigestSweep(organizationId) {
    await pgboss.send('notification.digest', { organizationId }, { retryLimit: 3, retryDelay: 5, retryBackoff: true });
}
//# sourceMappingURL=escalation.worker.js.map