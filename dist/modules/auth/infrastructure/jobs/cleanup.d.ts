/**
 * Auth automation / housekeeping logic.
 *
 * The auth email outbox is intentionally queue-only. This cleanup pass keeps
 * the durable table bounded by purging already-processed rows on a daily
 * schedule. Sent rows are retained briefly for operational visibility; failed
 * rows are retained longer for debugging and incident review.
 */
import type { FastifyBaseLogger } from 'fastify';
export declare const AUTH_AUTOMATION_RETENTION: {
    readonly sentEmailDays: 14;
    readonly failedEmailDays: 30;
};
export interface DailyAuthAutomationResult {
    sentEmailsPurged: number;
    failedEmailsPurged: number;
    durationMs: number;
}
export declare function runDailyAuthAutomation(log: FastifyBaseLogger): Promise<DailyAuthAutomationResult>;
//# sourceMappingURL=cleanup.d.ts.map