import type { DeliveryRow, DeliveryStatus } from '../connectors/types.js';
export interface CreateDeliveryInput {
    organizationId: string;
    projectId: string;
    connectorId: string;
    routeId: string | null;
    notificationType: string;
    severity: string;
    payload: Record<string, unknown>;
    recipients?: string[] | null;
    maxAttempts: number;
    correlationId: string;
    parentDeliveryId: string | null;
    status: DeliveryStatus;
}
export declare class DeliveryRepository {
    private readonly db;
    createDelivery(input: CreateDeliveryInput): Promise<DeliveryRow>;
    listDeliveries(organizationId: string, projectId: string, filters: {
        connectorId?: string;
        status?: DeliveryStatus;
        limit: number;
        offset: number;
    }): Promise<{
        data: DeliveryRow[];
        total: number;
    }>;
    /** Claim due retry rows for processing (SKIP LOCKED for safe concurrency). */
    claimRetryableDeliveries(limit: number): Promise<DeliveryRow[]>;
    markDeliverySent(id: string, update: {
        externalMessageId: string | null;
        responseStatusCode: number | null;
        responseBody: string | null;
        latencyMs: number;
    }): Promise<void>;
    markDeliveryRetrying(id: string, nextRetryAt: Date, errorMessage: string): Promise<void>;
    markDeliveryFailed(id: string, errorMessage: string, errorDetails: Record<string, unknown> | null): Promise<void>;
}
//# sourceMappingURL=delivery.repository.d.ts.map