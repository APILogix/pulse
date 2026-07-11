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
// ════════════════════════════════════════════════════════════════════════
// ENUMS — must match the connector migration enum types exactly
// ════════════════════════════════════════════════════════════════════════
export const ConnectorTypeSchema = z.enum([
    'slack',
    'discord',
    'teams',
    'pagerduty',
    'webhook',
    'email',
    'sms',
]);
export const ConnectorStatusSchema = z.enum([
    'active',
    'inactive',
    'error',
    'pending_setup',
]);
export const NotificationSeveritySchema = z.enum([
    'info',
    'warning',
    'error',
    'critical',
]);
export const HealthStateSchema = z.enum(['healthy', 'degraded', 'unhealthy']);
// ════════════════════════════════════════════════════════════════════════
// PER-CONNECTOR CONFIG SCHEMAS (the decrypted shape of encrypted_config)
// ════════════════════════════════════════════════════════════════════════
export const SlackConfigSchema = z.object({
    webhookUrl: z.string().url().startsWith('https://hooks.slack.com/').optional(),
    botToken: z.string().min(1).optional(),
    defaultChannel: z.string().min(1).optional(),
}).refine((c) => Boolean(c.webhookUrl || c.botToken), {
    message: 'Slack connector requires either webhookUrl or botToken',
});
export const DiscordConfigSchema = z.object({
    webhookUrl: z.string().url().includes('discord').describe('Discord webhook URL'),
    username: z.string().max(80).optional(),
    avatarUrl: z.string().url().optional(),
});
export const TeamsConfigSchema = z.object({
    webhookUrl: z.string().url(),
});
export const PagerDutyConfigSchema = z.object({
    routingKey: z.string().min(1).describe('Events API v2 integration/routing key'),
    defaultSeverityMap: z.record(z.string(), z.string()).optional(),
});
export const WebhookConfigSchema = z.object({
    url: z.string().url(),
    method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
    headers: z.record(z.string(), z.string()).optional(),
    signingSecret: z.string().min(8).optional(),
});
export const EmailConfigSchema = z.object({
    to: z.array(z.string().email()).min(1),
    fromName: z.string().max(255).optional(),
    fromEmail: z.string().email().optional(),
    // Optional per-connector SMTP override; falls back to env SMTP_* when absent.
    smtp: z.object({
        host: z.string().min(1),
        port: z.number().int().positive(),
        secure: z.boolean().default(false),
        user: z.string().optional(),
        pass: z.string().optional(),
    }).optional(),
});
export const SmsConfigSchema = z.object({
    provider: z.literal('twilio').default('twilio'),
    accountSid: z.string().min(1),
    authToken: z.string().min(1),
    fromNumber: z.string().min(1),
    toNumbers: z.array(z.string().min(1)).min(1),
});
/** Discriminated map from connector type to its config schema. */
export const CONNECTOR_CONFIG_SCHEMAS = {
    slack: SlackConfigSchema,
    discord: DiscordConfigSchema,
    teams: TeamsConfigSchema,
    pagerduty: PagerDutyConfigSchema,
    webhook: WebhookConfigSchema,
    email: EmailConfigSchema,
    sms: SmsConfigSchema,
};
// ════════════════════════════════════════════════════════════════════════
// REQUEST SCHEMAS (HTTP layer)
// ════════════════════════════════════════════════════════════════════════
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const ConnectorParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema });
export const CreateConnectorSchema = z.object({
    name: z.string().min(1).max(255).trim(),
    type: ConnectorTypeSchema,
    description: z.string().max(1000).optional(),
    /** Raw, sensitive connector config — encrypted before persistence. */
    config: z.record(z.string(), z.unknown()),
    displayConfig: z.record(z.string(), z.unknown()).optional(),
    rateLimitRequests: z.number().int().min(1).max(100_000).optional(),
    rateLimitWindowSeconds: z.number().int().min(1).max(86_400).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    failureThreshold: z.number().int().min(1).max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export const UpdateConnectorSchema = z.object({
    name: z.string().min(1).max(255).trim().optional(),
    description: z.string().max(1000).nullable().optional(),
    status: ConnectorStatusSchema.optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    displayConfig: z.record(z.string(), z.unknown()).optional(),
    rateLimitRequests: z.number().int().min(1).max(100_000).optional(),
    rateLimitWindowSeconds: z.number().int().min(1).max(86_400).optional(),
    maxRetries: z.number().int().min(0).max(10).optional(),
    failureThreshold: z.number().int().min(1).max(100).optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
});
export const ListConnectorsQuerySchema = z.object({
    type: ConnectorTypeSchema.optional(),
    status: ConnectorStatusSchema.optional(),
    search: z.string().max(255).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    offset: z.coerce.number().int().min(0).default(0),
});
export const SendTestNotificationSchema = z.object({
    notificationType: z.string().min(1).max(100).default('test'),
    severity: NotificationSeveritySchema.default('info'),
    title: z.string().min(1).max(255).default('Test notification'),
    body: z.string().min(1).max(4000).default('This is a test notification from your connector.'),
    url: z.string().url().optional(),
    fields: z.array(z.object({
        label: z.string().max(255),
        value: z.string().max(2000),
        short: z.boolean().optional(),
    })).max(20).optional(),
});
// ════════════════════════════════════════════════════════════════════════
// ERROR CLASSES
// ════════════════════════════════════════════════════════════════════════
export class ConnectorError extends AppError {
    constructor(message, code = 'CONNECTOR_ERROR', statusCode = 400, details) {
        super(message, code, statusCode, details);
    }
}
export class ConnectorNotFoundError extends ConnectorError {
    constructor(id) {
        super(id ? `Connector ${id} not found` : 'Connector not found', 'CONNECTOR_NOT_FOUND', 404);
    }
}
export class ConnectorConflictError extends ConnectorError {
    constructor(message) {
        super(message, 'CONNECTOR_CONFLICT', 409);
    }
}
export class ConnectorConfigError extends ConnectorError {
    constructor(message, details) {
        super(message, 'CONNECTOR_CONFIG_INVALID', 422, details);
    }
}
export class ConnectorTypeUnsupportedError extends ConnectorError {
    constructor(type) {
        super(`Connector type '${type}' is not registered`, 'CONNECTOR_TYPE_UNSUPPORTED', 400);
    }
}
export class CircuitOpenError extends ConnectorError {
    constructor(connectorId) {
        super(`Circuit breaker open for connector ${connectorId}`, 'CONNECTOR_CIRCUIT_OPEN', 503);
    }
}
export class RateLimitedError extends ConnectorError {
    constructor(retryAfterMs) {
        super('Connector rate limit exceeded', 'CONNECTOR_RATE_LIMITED', 429, { retryAfterMs });
    }
}
//# sourceMappingURL=connector.types.js.map