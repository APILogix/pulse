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
import { type AlertEscalationPolicyRow, type AlertEscalationStepRow } from '../types.js';
export declare class PoliciesRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createEscalationPolicy(input: {
        organizationId: string;
        name: string;
        description: string | null;
        repeatIntervalMinutes: number | null;
        maxRepeats: number;
        isActive: boolean;
    }): Promise<AlertEscalationPolicyRow>;
    listEscalationPolicies(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertEscalationPolicyRow[];
        total: number;
    }>;
    findEscalationPolicy(organizationId: string, id: string): Promise<AlertEscalationPolicyRow | null>;
    deleteEscalationPolicy(organizationId: string, id: string): Promise<void>;
    upsertEscalationStep(policyId: string, input: {
        stepNumber: number;
        waitMinutes: number;
        connectorIds: string[];
        routeIds: string[];
        notifyOnCall: boolean;
        customMessageTemplate: string | null;
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertEscalationStepRow>;
    listEscalationSteps(policyId: string): Promise<AlertEscalationStepRow[]>;
}
//# sourceMappingURL=policies.repository.d.ts.map