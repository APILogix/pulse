import type { FailureCategory, DeliveryResult }  from "../delivery/delivery.types.js";
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
import { assertSafeHttpsUrl } from '../shared/url-safety.js';

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
  'pending_setup',
  'active',
  'inactive',
  'disabled',
  'expired',
  'revoked',
  'degraded',
  'error',
  'rate_limited',
]);
export type ConnectorStatus = z.infer<typeof ConnectorStatusSchema>;

export const NotificationSeveritySchema = z.enum([
  'info',
  'warning',
  'error',
  'critical',
]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;
export const ConnectorRouteEnvironmentSchema = z.enum(['development', 'staging', 'production']);
export type ConnectorRouteEnvironment = z.infer<typeof ConnectorRouteEnvironmentSchema>;
export const HealthStateSchema = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthState = z.infer<typeof HealthStateSchema>;
// ════════════════════════════════════════════════════════════════════════
// PER-CONNECTOR CONFIG SCHEMAS (the decrypted shape of encrypted_config)
// ════════════════════════════════════════════════════════════════════════

export const SlackConfigSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://hooks.slack.com/').optional(),
  botToken: z.string().min(1).optional(),
  defaultChannel: z.string().min(1).optional(),
  /** Explicit marker used by the OAuth bootstrap flow before tokens exist. */
  pendingOAuth: z.literal(true).optional(),
}).strict().refine((c) => Boolean(c.webhookUrl || c.botToken || c.pendingOAuth), {
  message: 'Slack connector requires webhookUrl or botToken',
});
export type SlackConfig = z.infer<typeof SlackConfigSchema>;

export const DiscordConfigSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://').refine((u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === 'discord.com' || h.endsWith('.discord.com') ||
             h === 'discordapp.com' || h.endsWith('.discordapp.com');
    } catch { return false; }
  }, 'Must be a Discord webhook URL').describe('Discord webhook URL'),
  username: z.string().max(80).optional(),
  avatarUrl: z.string().url().optional(),
}).strict();
export type DiscordConfig = z.infer<typeof DiscordConfigSchema>;

export const TeamsConfigSchema = z.object({
  webhookUrl: z.string().url().startsWith('https://').refine((u) => {
    try {
      const h = new URL(u).hostname.toLowerCase();
      return h === 'office.com' || h.endsWith('.office.com') ||
             h === 'webhook.office.com' || h.endsWith('.webhook.office.com');
    } catch { return false; }
  }, 'Must be a Microsoft Teams webhook URL'),
}).strict();
export type TeamsConfig = z.infer<typeof TeamsConfigSchema>;

export const PagerDutyConfigSchema = z.object({
  routingKey: z.string().min(1).describe('Events API v2 integration/routing key'),
  defaultSeverityMap: z.record(z.string(), z.string()).optional(),
}).strict();
export type PagerDutyConfig = z.infer<typeof PagerDutyConfigSchema>;

export const WebhookConfigSchema = z.object({
  url: z.string().url().refine((u) => {
    try { assertSafeHttpsUrl(u); return true; } catch { return false; }
  }, 'URL must be public HTTPS'),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.record(z.string(), z.string()).optional(),
  signingSecret: z.string().min(8).optional(),
}).strict();
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
  }).strict().optional(),
}).strict();
export type EmailConfig = z.infer<typeof EmailConfigSchema>;

export const SmsConfigSchema = z.object({
  provider: z.literal('twilio').default('twilio'),
  accountSid: z.string().min(1),
  authToken: z.string().min(1),
  fromNumber: z.string().min(1),
  toNumbers: z.array(z.string().min(1)).min(1),
}).strict();
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
  validateConfiguration(config: ConnectorConfig): ValidationResult;
  send(notification: NotificationPayload): Promise<DeliveryResult>;
  testConnection(): Promise<ConnectionTestResult>;
  getHealthStatus(): Promise<HealthStatus>;
  healthCheck(): Promise<HealthStatus>;
  rotateSecret(config: ConnectorConfig): Promise<ValidationResult>;
  refreshCredentials(credentials?: ConnectorConfig): Promise<ValidationResult>;
  serialize(): ConnectorConfig;
  deserialize(config: ConnectorConfig): ValidationResult;

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
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema }).strict();
export const ConnectorParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema }).strict();
export const DeliveryParamsSchema = z.object({ orgId: UuidSchema, deliveryId: UuidSchema }).strict();
export const ConnectorDeliveryParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema, deliveryId: UuidSchema }).strict();
export const ConnectorRouteParamsSchema = z.object({ orgId: UuidSchema, id: UuidSchema, routeId: UuidSchema }).strict();

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
}).strict();
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
}).strict();
export type UpdateConnectorBody = z.infer<typeof UpdateConnectorSchema>;

export const ListConnectorsQuerySchema = z.object({
  type: ConnectorTypeSchema.optional(),
  status: ConnectorStatusSchema.optional(),
  search: z.string().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
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
  }).strict()).max(20).optional(),
}).strict();
export type SendTestNotificationBody = z.infer<typeof SendTestNotificationSchema>;

export const RotateSecretSchema = z.object({
  config: z.record(z.string(), z.unknown()),
}).strict();
export type RotateSecretBody = z.infer<typeof RotateSecretSchema>;

export const ValidateConfigurationSchema = z.object({
  type: ConnectorTypeSchema,
  config: z.record(z.string(), z.unknown()),
}).strict();
export type ValidateConfigurationBody = z.infer<typeof ValidateConfigurationSchema>;

export const PreviewNotificationSchema = SendTestNotificationSchema.extend({
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();
export type PreviewNotificationBody = z.infer<typeof PreviewNotificationSchema>;

export const CreateConnectorRouteSchema = z.object({
  projectId: UuidSchema.optional().nullable(),
  environment: ConnectorRouteEnvironmentSchema.optional().nullable(),
  eventType: z.string().min(1).max(100),
  severity: NotificationSeveritySchema.optional().nullable(),
  enabled: z.boolean().default(true),
}).strict();
export type CreateConnectorRouteBody = z.infer<typeof CreateConnectorRouteSchema>;

export const UpdateConnectorRouteSchema = z.object({
  projectId: UuidSchema.optional().nullable(),
  environment: ConnectorRouteEnvironmentSchema.optional().nullable(),
  eventType: z.string().min(1).max(100).optional(),
  severity: NotificationSeveritySchema.optional().nullable(),
  enabled: z.boolean().optional(),
}).strict();
export type UpdateConnectorRouteBody = z.infer<typeof UpdateConnectorRouteSchema>;

export const OAuthCallbackSchema = z.object({
  state: z.string().min(16).max(255),
  code: z.string().min(1).max(4096).optional(),
  error: z.string().max(512).optional(),
  accessToken: z.string().min(1).max(8192).optional(),
  refreshToken: z.string().min(1).max(8192).optional(),
  tokenType: z.string().min(1).max(100).default('Bearer').optional(),
  scope: z.string().max(2000).optional(),
  expiresIn: z.number().int().positive().max(31_536_000).optional(),
  expiresAt: z.coerce.date().optional(),
}).strict().refine((body) => Boolean(body.code || body.error), {
  message: 'OAuth callback requires either code or error',
}).refine((body) => !(body.accessToken || body.refreshToken) || Boolean(body.code), {
  message: 'OAuth token material requires a successful authorization code callback',
});
export type OAuthCallbackBody = z.infer<typeof OAuthCallbackSchema>;

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

// ════════════════════════════════════════════════════════════════════════
// DB ROW TYPES — snake_case
// ════════════════════════════════════════════════════════════════════════

export interface ConnectorConfigRow {
  id: string;
  organization_id: string;
  project_id: string | null;
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
  updated_by: string | null;
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

export type ConnectorProvider = INotificationConnector;

export interface ConnectorRouteRow {
  id: string;
  connector_id: string;
  project_id: string | null;
  environment: ConnectorRouteEnvironment | null;
  event_type: string;
  severity: NotificationSeverity | null;
  enabled: boolean;
  created_at: Date;
}

export interface ConnectorAuditLogRow {
  id: string;
  organization_id: string;
  connector_id: string | null;
  action: string;
  actor_id: string | null;
  actor_type: string | null;
  previous_state: Record<string, unknown> | null;
  new_state: Record<string, unknown> | null;
  changes_summary: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  request_id: string | null;
  created_at: Date;
}

export interface ConnectorTestRunRow {
  id: string;
  connector_id: string;
  triggered_by: string | null;
  status: string;
  response: Record<string, unknown> | null;
  duration_ms: number | null;
  created_at: Date;
}

export interface ConnectorOAuthStateRow {
  id: string;
  connector_id: string | null;
  state: string;
  code_verifier: string | null;
  expires_at: Date;
  created_at: Date;
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

export interface ConnectorRouteDto {
  id: string;
  connectorId: string;
  projectId: string | null;
  environment: ConnectorRouteEnvironment | null;
  eventType: string;
  severity: NotificationSeverity | null;
  enabled: boolean;
  createdAt: Date;
}

export interface ConnectorAuditLogDto {
  id: string;
  connectorId: string | null;
  action: string;
  actorId: string | null;
  actorType: string | null;
  changesSummary: Record<string, unknown> | null;
  createdAt: Date;
}

export interface ConnectorTestRunDto {
  id: string;
  connectorId: string;
  status: string;
  response: Record<string, unknown> | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface ConnectorOAuthStartDto {
  state: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  expiresAt: Date;
}

// ════════════════════════════════════════════════════════════════════════
// REQUEST METADATA (for audit)
// ════════════════════════════════════════════════════════════════════════

export interface RequestMeta {
  actorUserId: string | null;
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
