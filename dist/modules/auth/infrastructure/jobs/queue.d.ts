/**
 * Auth automation PGMQ queue wiring.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const AUTH_AUTOMATION_JOBS: {
    readonly daily: "auth_automation_daily";
};
export interface AuthAutomationSchedule {
    dailyIntervalMs?: number;
}
export declare function registerAuthAutomationWorkers(logger: FastifyBaseLogger, schedule?: AuthAutomationSchedule): Promise<{
    stop: () => Promise<void>;
}>;
//# sourceMappingURL=queue.d.ts.map