/**
 * Auth automation pg-boss queue wiring.
 *
 * Runs scheduled Postgres-backed housekeeping for auth-owned durable
 * automation tables. This remains Redis-free and safe across multiple worker
 * or standalone cron processes because pg-boss delivers each scheduled job to
 * exactly one consumer.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const AUTH_AUTOMATION_JOBS: {
    readonly daily: "auth.automation.daily";
};
export interface AuthAutomationSchedule {
    /** Cron for the daily auth purge pass. Default: 02:15 daily. */
    dailyCron?: string;
}
export declare function registerAuthAutomationWorkers(logger: FastifyBaseLogger, schedule?: AuthAutomationSchedule): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map