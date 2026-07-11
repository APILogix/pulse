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
import { type AlertTemplateRow } from '../types.js';
export declare class TemplatesRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createTemplate(input: {
        organizationId: string;
        name: string;
        templateType: string;
        content: string;
        variablesSchema: unknown[];
        defaultForSeverity: string | null;
        connectorType: string | null;
        isDefault: boolean;
        sampleData: Record<string, unknown>;
    }): Promise<AlertTemplateRow>;
    findTemplate(organizationId: string, id: string): Promise<AlertTemplateRow | null>;
    listTemplates(organizationId: string, limit: number, offset: number): Promise<{
        data: AlertTemplateRow[];
        total: number;
    }>;
    deleteTemplate(organizationId: string, id: string): Promise<void>;
}
//# sourceMappingURL=templates.repository.d.ts.map