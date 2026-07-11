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
import { type AlertMetricRow, type MetricGranularity } from '../types.js';
export declare class MetricsRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    queryMetrics(organizationId: string, filters: {
        metricType?: string;
        ruleId?: string;
        granularity: MetricGranularity;
        from?: Date;
        to?: Date;
        limit: number;
    }): Promise<AlertMetricRow[]>;
    /** Real-time dashboard stats computed directly from alert_events. */
    getRealtimeStats(organizationId: string): Promise<{
        firing: number;
        acknowledged: number;
        resolvedLast24h: number;
        mttrSeconds: number | null;
        mttaSeconds: number | null;
    }>;
}
//# sourceMappingURL=metrics.repository.d.ts.map