import type { DeliveryResult } from "../delivery/delivery.types.js";
/**
 * Notification connector module — types, schemas, DTOs, and errors.
 *
 * Conventions (matching the rest of the codebase):
 *   - Zod schemas drive request validation and enum parity with Postgres.
 *   - DB row types are snake_case; response DTOs are camelCase.
 *   - All module errors extend AppError for consistent HTTP mapping.
 */
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
export declare const ConnectorTypeSchema: z.ZodEnum<{
    sms: "sms";
    email: "email";
    webhook: "webhook";
    slack: "slack";
    discord: "discord";
    teams: "teams";
    pagerduty: "pagerduty";
}>;
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;
export declare const ConnectorStatusSchema: z.ZodEnum<{
    error: "error";
    active: "active";
    inactive: "inactive";
    pending_setup: "pending_setup";
}>;
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;
export declare const NotificationSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
    critical: "critical";
}>;
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;
export declare const HealthStateSchema: z.ZodEnum<{
    healthy: "healthy";
    degraded: "degraded";
    unhealthy: "unhealthy";
}>;
export type HealthState = z.infer<typeof HealthStateSchema>;
export declare const SlackConfigSchema: z.ZodObject<{
    webhookUrl: z.ZodOptional<z.ZodString>;
    botToken: z.ZodOptional<z.ZodString>;
    defaultChannel: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type SlackConfig = z.infer<typeof SlackConfigSchema>;
export declare const DiscordConfigSchema: z.ZodObject<{
    webhookUrl: z.ZodString;
    username: z.ZodOptional<z.ZodString>;
    avatarUrl: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;
export declare const TeamsConfigSchema: z.ZodObject<{
    webhookUrl: z.ZodString;
}, z.core.$strip>;
export type TeamsConfig = z.infer<typeof TeamsConfigSchema>;
export declare const PagerDutyConfigSchema: z.ZodObject<{
    routingKey: z.ZodString;
    defaultSeverityMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
}, z.core.$strip>;
export type PagerDutyConfig = z.infer<typeof PagerDutyConfigSchema>;
export declare const WebhookConfigSchema: z.ZodObject<{
    url: z.ZodString;
    method: z.ZodDefault<z.ZodEnum<{
        PATCH: "PATCH";
        POST: "POST";
        PUT: "PUT";
    }>>;
    headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    signingSecret: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;
export declare const EmailConfigSchema: z.ZodObject<{
    to: z.ZodArray<z.ZodString>;
    fromName: z.ZodOptional<z.ZodString>;
    fromEmail: z.ZodOptional<z.ZodString>;
    smtp: z.ZodOptional<z.ZodObject<{
        host: z.ZodString;
        port: z.ZodNumber;
        secure: z.ZodDefault<z.ZodBoolean>;
        user: z.ZodOptional<z.ZodString>;
        pass: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type EmailConfig = z.infer<typeof EmailConfigSchema>;
export declare const SmsConfigSchema: z.ZodObject<{
    provider: z.ZodDefault<z.ZodLiteral<"twilio">>;
    accountSid: z.ZodString;
    authToken: z.ZodString;
    fromNumber: z.ZodString;
    toNumbers: z.ZodArray<z.ZodString>;
}, z.core.$strip>;
export type SmsConfig = z.infer<typeof SmsConfigSchema>;
/** Discriminated map from connector type to its config schema. */
export declare const CONNECTOR_CONFIG_SCHEMAS: {
    readonly slack: z.ZodObject<{
        webhookUrl: z.ZodOptional<z.ZodString>;
        botToken: z.ZodOptional<z.ZodString>;
        defaultChannel: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly discord: z.ZodObject<{
        webhookUrl: z.ZodString;
        username: z.ZodOptional<z.ZodString>;
        avatarUrl: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly teams: z.ZodObject<{
        webhookUrl: z.ZodString;
    }, z.core.$strip>;
    readonly pagerduty: z.ZodObject<{
        routingKey: z.ZodString;
        defaultSeverityMap: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
    }, z.core.$strip>;
    readonly webhook: z.ZodObject<{
        url: z.ZodString;
        method: z.ZodDefault<z.ZodEnum<{
            PATCH: "PATCH";
            POST: "POST";
            PUT: "PUT";
        }>>;
        headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
        signingSecret: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly email: z.ZodObject<{
        to: z.ZodArray<z.ZodString>;
        fromName: z.ZodOptional<z.ZodString>;
        fromEmail: z.ZodOptional<z.ZodString>;
        smtp: z.ZodOptional<z.ZodObject<{
            host: z.ZodString;
            port: z.ZodNumber;
            secure: z.ZodDefault<z.ZodBoolean>;
            user: z.ZodOptional<z.ZodString>;
            pass: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
    }, z.core.$strip>;
    readonly sms: z.ZodObject<{
        provider: z.ZodDefault<z.ZodLiteral<"twilio">>;
        accountSid: z.ZodString;
        authToken: z.ZodString;
        fromNumber: z.ZodString;
        toNumbers: z.ZodArray<z.ZodString>;
    }, z.core.$strip>;
};
/** Untyped config bag as decrypted from storage / supplied by clients. */
export type ConnectorConfig = Record<string, unknown>;
export interface ValidationResult {
    valid: boolean;
    errors: string[];
    /** Parsed + normalized config when valid. */
    normalized?: ConnectorConfig;
}
export interface NotificationPayload {
    /** e.g. 'alert.created', 'incident.escalated', 'test'. */
    notificationType: string;
    severity: NotificationSeverity;
    title: string;
    body: string;
    /** Optional structured fields surfaced as key/value rows where supported. */
    fields?: Array<{
        label: string;
        value: string;
        short?: boolean | undefined;
    }>;
    /** Optional deep link back into the product. */
    url?: string;
    /** Thread/grouping key for connectors that support threading. */
    threadKey?: string;
    /** Arbitrary metadata forwarded to webhook-style connectors. */
    metadata?: Record<string, unknown>;
    /** Correlation id tying retries / fan-out together. */
    correlationId: string;
    /** Idempotency / dedup key for providers that support it (PagerDuty). */
    dedupKey?: string;
}
export interface ConnectionTestResult {
    success: boolean;
    message: string;
    latencyMs: number;
    details?: Record<string, unknown>;
}
export interface HealthStatus {
    state: HealthState;
    responseTimeMs?: number;
    message?: string;
    checkedAt: string;
    details?: Record<string, unknown>;
}
export interface RateLimitInfo {
    requests: number;
    windowSeconds: number;
}
/**
 * The Strategy contract every connector implements. Concrete connectors are
 * stateless w.r.t. a single notification: configuration is injected at
 * construction by the factory.
 */
export interface INotificationConnector {
    readonly id: string;
    readonly name: string;
    readonly type: ConnectorType;
    validateConfig(config: ConnectorConfig): ValidationResult;
    send(notification: NotificationPayload): Promise<DeliveryResult>;
    testConnection(): Promise<ConnectionTestResult>;
    getHealthStatus(): Promise<HealthStatus>;
    supportsRichFormatting(): boolean;
    supportsThreading(): boolean;
    supportsAttachments(): boolean;
    getRateLimitInfo(): RateLimitInfo;
}
/** Runtime context handed to a connector instance by the factory. */
export interface ConnectorContext {
    id: string;
    name: string;
    organizationId: string;
    config: ConnectorConfig;
    rateLimit: RateLimitInfo;
    /** Bound logger child for this connector instance. */
    log: import('fastify').FastifyBaseLogger;
}
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const ConnectorParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
    id: z.ZodString;
}, z.core.$strip>;
export declare const CreateConnectorSchema: z.ZodObject<{
    name: z.ZodString;
    type: z.ZodEnum<{
        sms: "sms";
        email: "email";
        webhook: "webhook";
        slack: "slack";
        discord: "discord";
        teams: "teams";
        pagerduty: "pagerduty";
    }>;
    description: z.ZodOptional<z.ZodString>;
    config: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    displayConfig: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rateLimitRequests: z.ZodOptional<z.ZodNumber>;
    rateLimitWindowSeconds: z.ZodOptional<z.ZodNumber>;
    maxRetries: z.ZodOptional<z.ZodNumber>;
    failureThreshold: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type CreateConnectorBody = z.infer<typeof CreateConnectorSchema>;
export declare const UpdateConnectorSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    status: z.ZodOptional<z.ZodEnum<{
        error: "error";
        active: "active";
        inactive: "inactive";
        pending_setup: "pending_setup";
    }>>;
    config: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    displayConfig: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    rateLimitRequests: z.ZodOptional<z.ZodNumber>;
    rateLimitWindowSeconds: z.ZodOptional<z.ZodNumber>;
    maxRetries: z.ZodOptional<z.ZodNumber>;
    failureThreshold: z.ZodOptional<z.ZodNumber>;
    metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, z.core.$strip>;
export type UpdateConnectorBody = z.infer<typeof UpdateConnectorSchema>;
export declare const ListConnectorsQuerySchema: z.ZodObject<{
    type: z.ZodOptional<z.ZodEnum<{
        sms: "sms";
        email: "email";
        webhook: "webhook";
        slack: "slack";
        discord: "discord";
        teams: "teams";
        pagerduty: "pagerduty";
    }>>;
    status: z.ZodOptional<z.ZodEnum<{
        error: "error";
        active: "active";
        inactive: "inactive";
        pending_setup: "pending_setup";
    }>>;
    search: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
}, z.core.$strip>;
export type ListConnectorsQuery = z.infer<typeof ListConnectorsQuerySchema>;
export declare const SendTestNotificationSchema: z.ZodObject<{
    notificationType: z.ZodDefault<z.ZodString>;
    severity: z.ZodDefault<z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
        critical: "critical";
    }>>;
    title: z.ZodDefault<z.ZodString>;
    body: z.ZodDefault<z.ZodString>;
    url: z.ZodOptional<z.ZodString>;
    fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        label: z.ZodString;
        value: z.ZodString;
        short: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export type SendTestNotificationBody = z.infer<typeof SendTestNotificationSchema>;
export interface ConnectorConfigRow {
    id: string;
    organization_id: string;
    name: string;
    type: ConnectorType;
    status: ConnectorStatus;
    description: string | null;
    encrypted_config: Buffer;
    config_schema_version: number;
    display_config: Record<string, unknown>;
    supports_rich_formatting: boolean;
    supports_threading: boolean;
    supports_attachments: boolean;
    rate_limit_requests: number;
    rate_limit_window_seconds: number;
    max_retries: number;
    retry_backoff_base_ms: number;
    retry_backoff_multiplier: string;
    last_health_check_at: Date | null;
    last_successful_delivery_at: Date | null;
    consecutive_failures: number;
    failure_threshold: number;
    metadata: Record<string, unknown>;
    created_by: string | null;
    created_at: Date;
    updated_at: Date;
    deleted_at: Date | null;
}
export interface HealthCheckRow {
    id: string;
    connector_id: string;
    status: HealthState;
    response_time_ms: number | null;
    error_message: string | null;
    details: Record<string, unknown>;
    checked_at: Date;
}
export interface ConnectorDto {
    id: string;
    organizationId: string;
    name: string;
    type: ConnectorType;
    status: ConnectorStatus;
    description: string | null;
    displayConfig: Record<string, unknown>;
    capabilities: {
        richFormatting: boolean;
        threading: boolean;
        attachments: boolean;
    };
    rateLimit: {
        requests: number;
        windowSeconds: number;
    };
    retry: {
        maxRetries: number;
        backoffBaseMs: number;
        backoffMultiplier: number;
    };
    health: {
        lastHealthCheckAt: Date | null;
        lastSuccessfulDeliveryAt: Date | null;
        consecutiveFailures: number;
        failureThreshold: number;
    };
    metadata: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}
export interface ConnectorTypeInfoDto {
    type: ConnectorType;
    displayName: string;
    description: string;
    capabilities: {
        richFormatting: boolean;
        threading: boolean;
        attachments: boolean;
    };
    /** JSON-schema-ish description of required config fields. */
    configFields: Array<{
        key: string;
        label: string;
        required: boolean;
        secret: boolean;
        type: 'string' | 'url' | 'number' | 'boolean' | 'array';
    }>;
}
export interface RequestMeta {
    actorUserId: string;
    actorIp: string;
    actorUserAgent: string | null;
    requestId: string;
}
export declare class ConnectorError extends AppError {
    constructor(message: string, code?: string, statusCode?: number, details?: Record<string, unknown>);
}
export declare class ConnectorNotFoundError extends ConnectorError {
    constructor(id?: string);
}
export declare class ConnectorConflictError extends ConnectorError {
    constructor(message: string);
}
export declare class ConnectorConfigError extends ConnectorError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class ConnectorTypeUnsupportedError extends ConnectorError {
    constructor(type: string);
}
export declare class CircuitOpenError extends ConnectorError {
    constructor(connectorId: string);
}
export declare class RateLimitedError extends ConnectorError {
    constructor(retryAfterMs: number);
}
//# sourceMappingURL=connector.types.d.ts.map