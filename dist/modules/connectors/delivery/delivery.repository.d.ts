/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import { type ConnectorType, type DeliveryRow, type DeliveryStatus, type FailureCategory, type NotificationSeverity } from '../types.js';
export interface InsertDeliveryInput {
    organizationId: string;
    connectorId: string;
    routeId: string | null;
    notificationType: string;
    severity: NotificationSeverity;
    payload: Record<string, unknown>;
    maxAttempts: number;
    correlationId: string;
    parentDeliveryId: string | null;
    status: DeliveryStatus;
}
export interface RateLimitCheckResult {
    allowed: boolean;
    retryAfterMs: number;
}
export declare class DeliveryRepository {
    private readonly db;
    /**
     * ADR-0006: pools are injected explicitly. Reads/writes the LEGACY connector
     * delivery tables and stays on the primary pool until the L9 view swap.
     */
    constructor(db?: typeof pool);
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    insertDelivery(input: InsertDeliveryInput): Promise<DeliveryRow>;
    insertDeliveryIdempotent(input: InsertDeliveryInput): Promise<{
        row: DeliveryRow;
        existed: boolean;
    }>;
    markDeliverySent(id: string, update: {
        externalMessageId: string | null;
        responseStatusCode: number | null;
        responseBody: string | null;
        latencyMs: number;
    }): Promise<void>;
    markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string): Promise<void>;
    markDeliveryFailed(id: string, errorMessage: string, errorDetails: Record<string, unknown> | null): Promise<void>;
    /** Claim due retry rows for processing (SKIP LOCKED for safe concurrency). */
    claimRetryableDeliveries(limit: number): Promise<DeliveryRow[]>;
    listDeliveries(organizationId: string, filters: {
        connectorId?: string;
        status?: DeliveryStatus;
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryRow[];
        total: number;
    }>;
    getDelivery(organizationId: string, id: string): Promise<DeliveryRow | null>;
    findDeliveryByDedupKey(connectorId: string, dedupKey: string, windowMinutes: number): Promise<DeliveryRow | null>;
    consumeRateLimitToken(connectorId: string, limit: number, windowSeconds: number): Promise<RateLimitCheckResult>;
    circuitAllows(connectorId: string, resetTimeoutMs: number): Promise<boolean>;
    recordCircuitSuccess(connectorId: string): Promise<void>;
    recordCircuitFailure(connectorId: string, failureThreshold: number): Promise<'closed' | 'open' | 'half_open'>;
    recordSuccessfulDeliveryUsage(organizationId: string, projectId: string | null, connectorType: ConnectorType): Promise<void>;
    listAttempts(organizationId: string, connectorId: string, deliveryId: string, filters: {
        limit: number;
        offset: number;
    }): Promise<{
        data: import('../types.js').DeliveryAttemptRow[];
        total: number;
    }>;
    retryDelivery(organizationId: string, id: string): Promise<DeliveryRow | null>;
    insertDeadLetter(input: {
        originalDeliveryId: string;
        organizationId: string;
        connectorId: string;
        failureReason: string;
        failureCategory: FailureCategory;
        errorStack: string | null;
        originalPayload: Record<string, unknown>;
        retryAttempts: number;
    }): Promise<void>;
    getDlqGrowth(windowMinutes: number): Promise<number>;
    private insertAttempt;
}
//# sourceMappingURL=delivery.repository.d.ts.map