/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { type ConnectorConfigRow, type ConnectorStatus, type ConnectorType, type DeliveryRow, type DeliveryStatus, type FailureCategory, type HealthCheckRow, type HealthState, type ListConnectorsQuery, type NotificationSeverity } from './types.js';
export interface CreateConnectorInput {
    organizationId: string;
    name: string;
    type: ConnectorType;
    description: string | null;
    encryptedConfig: Buffer;
    displayConfig: Record<string, unknown>;
    capabilities: {
        richFormatting: boolean;
        threading: boolean;
        attachments: boolean;
    };
    rateLimitRequests: number;
    rateLimitWindowSeconds: number;
    maxRetries: number;
    failureThreshold: number;
    metadata: Record<string, unknown>;
    createdBy: string | null;
}
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
export declare class ConnectorRepository {
    private readonly db;
    withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
    create(input: CreateConnectorInput): Promise<ConnectorConfigRow>;
    findById(organizationId: string, id: string): Promise<ConnectorConfigRow | null>;
    /** Fetch without org scoping — only for trusted internal paths (workers). */
    findByIdInternal(id: string): Promise<ConnectorConfigRow | null>;
    /**
     * Bulk-fetch connectors by id (single query — no N+1). Used by the alerting
     * batch worker to resolve every connector referenced by a batch of events.
     * Not org-scoped: callers must already have validated tenant ownership of
     * the events that reference these connector ids.
     */
    getByIds(ids: string[]): Promise<ConnectorConfigRow[]>;
    list(organizationId: string, query: ListConnectorsQuery): Promise<{
        data: ConnectorConfigRow[];
        total: number;
    }>;
    /** All non-deleted connectors in an active/error state (for health sweeps). */
    listMonitorable(): Promise<ConnectorConfigRow[]>;
    update(organizationId: string, id: string, fields: Record<string, unknown>): Promise<ConnectorConfigRow>;
    softDelete(organizationId: string, id: string): Promise<void>;
    recordSuccess(connectorId: string): Promise<void>;
    /** Increment failures; flip to 'error' once the threshold is crossed. */
    recordFailure(connectorId: string): Promise<{
        consecutiveFailures: number;
        tripped: boolean;
    }>;
    insertHealthCheck(connectorId: string, state: HealthState, responseTimeMs: number | null, errorMessage: string | null, details: Record<string, unknown>): Promise<HealthCheckRow>;
    setStatus(organizationId: string, id: string, status: ConnectorStatus): Promise<void>;
    insertDelivery(input: InsertDeliveryInput): Promise<DeliveryRow>;
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
    insertAuditLog(input: {
        organizationId: string;
        connectorId: string | null;
        action: string;
        actorId: string | null;
        actorType?: string;
        previousState?: Record<string, unknown> | null;
        newState?: Record<string, unknown> | null;
        changesSummary?: Record<string, unknown> | null;
        ipAddress?: string | null;
        userAgent?: string | null;
        requestId?: string | null;
    }): Promise<void>;
}
//# sourceMappingURL=repository.d.ts.map