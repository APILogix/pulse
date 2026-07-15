import { z } from 'zod';
import { ConnectorError, type NotificationSeverity } from '../core/connector.types.js';
export declare const DeliveryStatusSchema: z.ZodEnum<{
    pending: "pending";
    cancelled: "cancelled";
    failed: "failed";
    sent: "sent";
    delivered: "delivered";
    retrying: "retrying";
}>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export declare const FailureCategorySchema: z.ZodEnum<{
    unknown: "unknown";
    timeout: "timeout";
    auth_error: "auth_error";
    rate_limit: "rate_limit";
    invalid_config: "invalid_config";
    invalid_payload: "invalid_payload";
    network_error: "network_error";
    circuit_open: "circuit_open";
}>;
export type FailureCategory = z.infer<typeof FailureCategorySchema>;
export interface DeliveryResult {
    success: boolean;
    /** Provider-side message/incident id when available. */
    externalMessageId?: string;
    statusCode?: number;
    responseBody?: string;
    errorMessage?: string;
    failureCategory?: FailureCategory;
    /** Whether a failed delivery is worth retrying. */
    retryable?: boolean;
    latencyMs: number;
}
export interface DeliveryRow {
    id: string;
    organization_id: string;
    connector_id: string;
    route_id: string | null;
    notification_type: string;
    severity: NotificationSeverity;
    payload: Record<string, unknown>;
    payload_size_bytes: number | null;
    status: DeliveryStatus;
    attempts: number;
    max_attempts: number;
    scheduled_at: Date | null;
    sent_at: Date | null;
    delivered_at: Date | null;
    failed_at: Date | null;
    external_message_id: string | null;
    response_body: string | null;
    response_status_code: number | null;
    error_message: string | null;
    error_details: Record<string, unknown> | null;
    next_retry_at: Date | null;
    retry_count: number;
    delivery_latency_ms: number | null;
    correlation_id: string;
    parent_delivery_id: string | null;
    created_at: Date;
    updated_at: Date;
}
export interface DeliveryAttemptRow {
    id: string;
    delivery_id: string;
    delivery_created_at: Date;
    attempt_number: number;
    status: DeliveryStatus;
    http_status: number | null;
    error_code: string | null;
    error_message: string | null;
    response: Record<string, unknown> | null;
    duration_ms: number | null;
    attempted_at: Date;
}
export interface DeliveryDto {
    id: string;
    connectorId: string;
    notificationType: string;
    severity: NotificationSeverity;
    status: DeliveryStatus;
    attempts: number;
    maxAttempts: number;
    retryCount: number;
    nextRetryAt: Date | null;
    externalMessageId: string | null;
    responseStatusCode: number | null;
    errorMessage: string | null;
    latencyMs: number | null;
    correlationId: string;
    createdAt: Date;
    sentAt: Date | null;
    deliveredAt: Date | null;
}
export interface DispatchSummary {
    deliveryId: string;
    status: DeliveryStatus;
    correlationId: string;
    success: boolean;
    externalMessageId?: string;
    errorMessage?: string;
}
export declare class ConnectorDeliveryError extends ConnectorError {
    readonly failureCategory: FailureCategory;
    readonly retryable: boolean;
    constructor(message: string, failureCategory: FailureCategory, retryable: boolean, details?: Record<string, unknown>);
}
//# sourceMappingURL=delivery.types.d.ts.map