/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { type ConnectorConfigRow, type ConnectorStatus, type ConnectorType, type ListConnectorsQuery } from '../types.js';
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
export interface UpsertConnectorCredentialInput {
    organizationId: string;
    connectorId: string;
    credentialType: string;
    keyName: string;
    encryptedValue: Buffer;
    expiresAt: Date | null;
    actorUserId: string | null;
}
export interface ConnectorCredentialRow {
    id: string;
    connector_id: string;
    credential_type: string;
    key_name: string;
    encrypted_value: Buffer;
    algorithm: string;
    version: number;
    expires_at: Date | null;
    created_at: Date;
    updated_at: Date;
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
    upsertCredential(input: UpsertConnectorCredentialInput): Promise<void>;
    getCredential(organizationId: string, connectorId: string, keyName: string): Promise<ConnectorCredentialRow | null>;
    softDelete(organizationId: string, id: string): Promise<void>;
    setStatus(organizationId: string, id: string, status: ConnectorStatus): Promise<void>;
}
//# sourceMappingURL=connector.repository.d.ts.map