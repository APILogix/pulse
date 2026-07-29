/**
 * Project-scoped alert delivery + dead-letter repository.
 *
 * Connector deliveries are stored org-wide in `connector_deliveries` with no
 * `project_id` column. Project scope is derived by joining to
 * `connector_configs` (which is project-scoped) on `connector_id`.
 *
 * Dead-letters are modelled as deliveries in a terminal `failed` state: the
 * dispatcher marks a delivery `failed` once it has exhausted every retry.
 * Reprocessing resets a row to `retrying` so the delivery retry worker
 * (which claims `status='retrying' AND next_retry_at <= NOW()`) picks it up.
 * Discarding soft-deletes a row by moving it to `cancelled`, which keeps the
 * record for audit while removing it from the queue view.
 */
import type { Pool } from "pg";
export interface DeliveryLogRow {
    id: string;
    status: string;
    severity: string;
    attempts: number;
    delivery_latency_ms: number | null;
    created_at: Date;
    error_message: string | null;
    payload_size_bytes: number | null;
    notification_type: string;
    connector_name: string | null;
    connector_provider: string | null;
}
export interface DeliveryLogFilters {
    status?: string | undefined;
    severity?: string | undefined;
    limit: number;
    offset: number;
}
export declare class DeliveryLogRepository {
    private readonly db;
    constructor(db?: Pool);
    listDeliveries(organizationId: string, projectId: string, filters: DeliveryLogFilters): Promise<{
        data: DeliveryLogRow[];
        total: number;
    }>;
    /** List permanently failed deliveries (the dead-letter queue) for a project. */
    listDeadLetters(organizationId: string, projectId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryLogRow[];
        total: number;
    }>;
    /**
     * Reset a single failed delivery back to `retrying` so the retry worker
     * re-dispatches it. Scoped to the project via the connector join.
     */
    reprocessDeadLetter(organizationId: string, projectId: string, deliveryId: string): Promise<boolean>;
    /** Reset every failed delivery for a project back to `retrying`. */
    reprocessAll(organizationId: string, projectId: string): Promise<number>;
    /** Soft-discard a single failed delivery by moving it to `cancelled`. */
    discardDeadLetter(organizationId: string, projectId: string, deliveryId: string): Promise<boolean>;
    /** Soft-discard every failed delivery for a project. */
    purgeQueue(organizationId: string, projectId: string): Promise<number>;
}
//# sourceMappingURL=delivery-log.repository.d.ts.map