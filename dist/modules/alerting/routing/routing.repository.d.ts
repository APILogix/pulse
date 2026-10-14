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
import { pool } from '../../../config/database.js';
import { type AlertRoutingRuleRow } from '../types.js';
export declare const ALERT_ROUTING_RULES_COLUMNS = "id, organization_id, name, description, priority, conditions, target_connector_ids, target_route_ids, fallback_connector_ids, template_id, is_active, created_at, updated_at, deleted_at";
export declare class RoutingRepository {
    private readonly db;
    /** ADR-0006: routing rules are control-plane configuration. */
    constructor(db?: typeof pool);
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    createRoutingRule(input: {
        organizationId: string;
        name: string;
        description: string | null;
        priority: number;
        conditions: Record<string, unknown>;
        targetConnectorIds: string[];
        targetRouteIds: string[];
        fallbackConnectorIds: string[];
        templateId: string | null;
        isActive: boolean;
    }): Promise<AlertRoutingRuleRow>;
    listRoutingRules(organizationId: string): Promise<AlertRoutingRuleRow[]>;
    findRoutingRule(organizationId: string, id: string): Promise<AlertRoutingRuleRow | null>;
    deleteRoutingRule(organizationId: string, id: string): Promise<void>;
}
//# sourceMappingURL=routing.repository.d.ts.map