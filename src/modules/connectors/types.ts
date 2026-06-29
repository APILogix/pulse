/**
 * Notification connector module — types, schemas, DTOs, and errors.
 *
 * Conventions (matching the rest of the codebase):
 *   - Zod schemas drive request validation and enum parity with Postgres.
 *   - DB row types are snake_case; response DTOs are camelCase.
 *   - All module errors extend AppError for consistent HTTP mapping.
 */
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';

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
export type ConnectorType = z.infer<typeof ConnectorTypeSchema>;

export const ConnectorStatusSchema = z.enum([
  'active',
  'inactive',
  'error',
  'pending_setup',
]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const NotificationSeveritySchema = z.enum([
  'info',
  'warning',
  'error',
  'critical',
]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

export const DeliveryStatusSchema = z.enum([
  'pending',
  'sent',
  'delivered',
  'failed',
  'retrying',
  'cancelled',
]);
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;

export const HealthStateSchema = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthState = z.infer<typeof HealthStateSchema>;

/** Categories used by the dead-letter queue and error classification. */
export const FailureCategorySchema = z.enum([
  'timeout',
  'auth_error',
  'rate_limit',
  'invalid_config',
  'invalid_payload',
  'network_error',
  'circuit_open',
  'unknown',
]);
export type FailureCategory = z.infer<typeof FailureCategorySchema>;

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
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export const DiscordConfigSchema = z.object({
  webhookUrl: z.string().url().includes('discord').describe('Discord webhook URL'),
  username: z.string().max(80).optional(),
  avatarUrl: z.string().url().optional(),
});
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export const TeamsConfigSchema = z.object({
  webhookUrl: z.string().url(),
});
export type TeamsConfig = z.infer<typeof TeamsConfigSchema>;

export const PagerDutyConfigSchema = z.object({
  routingKey: z.string().min(1).describe('Events API v2 integration/routing key'),
  defaultSeverityMap: z.record(z.string(), z.string()).optional(),
});
export type PagerDutyConfig = z.infer<typeof PagerDutyConfigSchema>;

export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  signingSecret: z.string().min(8).optional(),
});
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

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
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

export const SmsConfigSchema = z.object({
  provider: z.literal('twilio').default('twilio'),
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  fromNumber: z.string().min(1),
  toNumbers: z.array(z.string().min(1)).min(1),
});
export type SmsConfig = z.infer<typeof SmsConfigSchema>;

/** Discriminated map from connector type to its config schema. */
export const CONNECTOR_CONFIG_SCHEMAS = {
  slack: SlackConfigSchema,
  discord: DiscordConfigSchema,
  teams: TeamsConfigSchema,
  pagerduty: PagerDutyConfigSchema,
  webhook: WebhookConfigSchema,
  email: EmailConfigSchema,
  sms: SmsConfigSchema,
} as const;

/** Untyped config bag as decrypted from storage / supplied by clients. */
export type ConnectorConfig = Record<string, unknown>;

// ════════════════════════════════════════════════════════════════════════
// STRATEGY-PATTERN CONTRACT TYPES
// ════════════════════════════════════════════════════════════════════════

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
  fields?: Array<{ label: string; value: string; short?: boolean | undefined }>;
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
export type CreateConnectorBody = z.infer<typeof CreateConnectorSchema>;

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
export type UpdateConnectorBody = z.infer<typeof UpdateConnectorSchema>;

export const ListConnectorsQuerySchema = z.object({
  type: ConnectorTypeSchema.optional(),
  status: ConnectorStatusSchema.optional(),
  search: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListConnectorsQuery = z.infer<typeof ListConnectorsQuerySchema>;

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
export type SendTestNotificationBody = z.infer<typeof SendTestNotificationSchema>;

// ════════════════════════════════════════════════════════════════════════
// DB ROW TYPES — snake_case
// ════════════════════════════════════════════════════════════════════════

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
  retry_backoff_multiplier: string; // NUMERIC arrives as string from pg
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

export interface HealthCheckRow {
  id: string;
  connector_id: string;
  status: HealthState;
  response_time_ms: number | null;
  error_message: string | null;
  details: Record<string, unknown>;
  checked_at: Date;
}

// ════════════════════════════════════════════════════════════════════════
// RESPONSE DTOs — never expose decrypted credentials
// ════════════════════════════════════════════════════════════════════════

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
  rateLimit: { requests: number; windowSeconds: number };
  retry: { maxRetries: number; backoffBaseMs: number; backoffMultiplier: number };
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

export interface DeliveryDto {
  id: string;
  connectorId: string;
  notificationType: string;
  severity: NotificationSeverity;
  status: DeliveryStatus;
  attempts: number;
  externalMessageId: string | null;
  responseStatusCode: number | null;
  errorMessage: string | null;
  latencyMs: number | null;
  correlationId: string;
  createdAt: Date;
  sentAt: Date | null;
  deliveredAt: Date | null;
}

/** Returned by the test-send endpoint describing the immediate dispatch result. */
export interface DispatchSummary {
  deliveryId: string;
  status: DeliveryStatus;
  correlationId: string;
  success: boolean;
  externalMessageId?: string;
  errorMessage?: string;
}

// ════════════════════════════════════════════════════════════════════════
// REQUEST METADATA (for audit)
// ════════════════════════════════════════════════════════════════════════

export interface RequestMeta {
  actorUserId: string;
  actorIp: string;
  actorUserAgent: string | null;
  requestId: string;
}

// ════════════════════════════════════════════════════════════════════════
// ERROR CLASSES
// ════════════════════════════════════════════════════════════════════════

export class ConnectorError extends AppError {
  constructor(message: string, code = 'CONNECTOR_ERROR', statusCode = 400, details?: Record<string, unknown>) {
    super(message, code, statusCode, details);
  }
}

export class ConnectorNotFoundError extends ConnectorError {
  constructor(id?: string) {
    super(id ? `Connector ${id} not found` : 'Connector not found', 'CONNECTOR_NOT_FOUND', 404);
  }
}

export class ConnectorConflictError extends ConnectorError {
  constructor(message: string) {
    super(message, 'CONNECTOR_CONFLICT', 409);
  }
}

export class ConnectorConfigError extends ConnectorError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONNECTOR_CONFIG_INVALID', 422, details);
  }
}

export class ConnectorTypeUnsupportedError extends ConnectorError {
  constructor(type: string) {
    super(`Connector type '${type}' is not registered`, 'CONNECTOR_TYPE_UNSUPPORTED', 400);
  }
}

/** Thrown by connectors during delivery; carries retry classification. */
export class ConnectorDeliveryError extends ConnectorError {
  public readonly failureCategory: FailureCategory;
  public readonly retryable: boolean;

  constructor(message: string, failureCategory: FailureCategory, retryable: boolean, details?: Record<string, unknown>) {
    super(message, 'CONNECTOR_DELIVERY_FAILED', 502, details);
    this.failureCategory = failureCategory;
    this.retryable = retryable;
  }
}

export class CircuitOpenError extends ConnectorError {
  constructor(connectorId: string) {
    super(`Circuit breaker open for connector ${connectorId}`, 'CONNECTOR_CIRCUIT_OPEN', 503);
  }
}

export class RateLimitedError extends ConnectorError {
  constructor(retryAfterMs: number) {
    super('Connector rate limit exceeded', 'CONNECTOR_RATE_LIMITED', 429, { retryAfterMs });
  }
}
