/**
 * Alerting persistence layer.
 *
 * Owns all SQL for the alerting module. Tenant isolation is enforced in the
 * service layer by always passing `organization_id` into queries (this
 * codebase isolates tenants in the application layer — see migration 003).
 *
 * Performance contract for the batch worker:
 *   - `getBatchWithEvents` fetches a batch + its events in ONE query.
 *   - `bulkUpdateEventStatus` / `bulkInsertDeliveryAttempts` use UNNEST-based
 *     set operations — NO per-row (N+1) writes.
 */
import type { PoolClient } from 'pg';
import { type AlertSilenceRow } from '../types.js';
export declare class SilencesRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createSilence(input: {
        organizationId: string;
        ruleId: string | null;
        createdBy: string;
        comment: string | null;
        startsAt: Date;
        endsAt: Date;
        matchers: Record<string, unknown>;
    }): Promise<AlertSilenceRow>;
    listSilences(organizationId: string, active: boolean | undefined, limit: number, offset: number): Promise<{
        data: AlertSilenceRow[];
        total: number;
    }>;
    expireSilence(organizationId: string, id: string): Promise<void>;
    /** Active silences applicable to a rule (rule-specific or global) right now. */
    findActiveSilences(organizationId: string, ruleId: string | null): Promise<AlertSilenceRow[]>;
}
//# sourceMappingURL=silences.repository.d.ts.map