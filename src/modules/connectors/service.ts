/**
 * Connector business service.
 *
 * Owns connector lifecycle rules:
 *   - Validate the provided config against the connector type's Zod schema
 *     before persisting (via the registry / a transient connector instance).
 *   - Encrypt sensitive config at rest; derive capability flags from the
 *     registry so they cannot drift from the implementation.
 *   - Never return decrypted credentials to clients (DTOs are credential-free).
 *   - Write a connector audit record for every mutating operation.
 */
import type { FastifyBaseLogger } from 'fastify';
import { createHash, randomBytes } from 'crypto';
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './delivery/delivery.service.js';
import { decryptConfig, encryptConfig } from './secrets/secret.service.js';
import { CONNECTOR_JOBS, type ConnectorJobName } from './job.constants.js';
import {
  createConnector as factoryCreate,
  ephemeralContext,
  getTypeCapabilities,
  isConnectorTypeRegistered,
  listConnectorTypes,
} from './registry.js';
import { assertPubliclyResolvable } from './shared/url-safety.js';
import {
  ConnectorConfigError,
  ConnectorError,
  ConnectorNotFoundError,
  ConnectorTypeUnsupportedError,
  type ConnectorAuditLogDto,
  type ConnectionTestResult,
  type ConnectorConfigRow,
  type ConnectorDto,
  type ConnectorOAuthStartDto,
  type ConnectorRouteDto,
  type ConnectorType,
  type ConnectorTypeInfoDto,
  type CreateConnectorRouteBody,
  type CreateConnectorBody,
  type DeliveryAttemptRow,
  type DeliveryDto,
  type DeliveryRow,
  type DispatchSummary,
  type HealthStatus,
  type ListConnectorsQuery,
  type OAuthCallbackBody,
  type PaginationQuery,
  type PreviewNotificationBody,
  type RequestMeta,
  type RotateSecretBody,
  type SendTestNotificationBody,
  type UpdateConnectorRouteBody,
  type UpdateConnectorBody,
  type ValidateConfigurationBody,
} from './types.js';

export interface ConnectorServiceDeps {
  repository: ConnectorRepository;
  dispatcher: NotificationDispatcher;
  logger: FastifyBaseLogger;
  emitEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
  enqueueConnectorJob?: (
    queue: ConnectorJobName,
    data: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => Promise<unknown>;
}

export class ConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly dispatcher: NotificationDispatcher;
  private readonly logger: FastifyBaseLogger;
  private readonly emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;
  private readonly enqueueConnectorJob?: ConnectorServiceDeps['enqueueConnectorJob'];

  constructor(deps: ConnectorServiceDeps) {
    this.repository = deps.repository;
    this.dispatcher = deps.dispatcher;
    this.logger = deps.logger;
    this.emitEvent = deps.emitEvent ?? (async () => undefined);
    this.enqueueConnectorJob = deps.enqueueConnectorJob;
  }

  // ── Types catalog ───────────────────────────────────────────────────────
  listTypes(): ConnectorTypeInfoDto[] {
    return listConnectorTypes();
  }

  // ── CRUD ──────────────────────────────────────────────────────────────
  async createConnector(orgId: string, meta: RequestMeta, body: CreateConnectorBody): Promise<ConnectorDto> {
    if (!isConnectorTypeRegistered(body.type)) {
      throw new ConnectorTypeUnsupportedError(body.type);
    }
    const normalized = this.validateConfigOrThrow(body.type, body.config);
    await this.assertSafeUrls(body.type, normalized);
    const capabilities = getTypeCapabilities(body.type);

    const row = await this.repository.create({
      organizationId: orgId,
      name: body.name,
      type: body.type,
      description: body.description ?? null,
      encryptedConfig: encryptConfig(normalized),
      displayConfig: body.displayConfig ?? {},
      capabilities,
      rateLimitRequests: body.rateLimitRequests ?? 60,
      rateLimitWindowSeconds: body.rateLimitWindowSeconds ?? 60,
      maxRetries: body.maxRetries ?? 3,
      failureThreshold: body.failureThreshold ?? 5,
      metadata: body.metadata ?? {},
      createdBy: meta.actorUserId,
    });

    await this.audit(orgId, row.id, 'created', meta, { type: body.type, name: body.name });
    const testJobId = await this.enqueueConnectorTestIfAvailable(orgId, row.id);
    if (testJobId) {
      await this.audit(orgId, row.id, 'test.queued', meta, { jobId: testJobId });
    }
    await this.emitEvent('connector.created', { orgId, connectorId: row.id, type: body.type });
    this.logger.info({ orgId, connectorId: row.id, type: body.type, testJobId }, 'Connector created');
    return this.toDto(row);
  }

  async listConnectors(orgId: string, query: ListConnectorsQuery): Promise<{ data: ConnectorDto[]; total: number; limit: number; offset: number }> {
    const { data, total } = await this.repository.list(orgId, query);
    return { data: data.map((r) => this.toDto(r)), total, limit: query.limit, offset: query.offset };
  }

  async getConnector(orgId: string, id: string): Promise<ConnectorDto> {
    const row = await this.requireConnector(orgId, id);
    return this.toDto(row);
  }

  async updateConnector(orgId: string, meta: RequestMeta, id: string, body: UpdateConnectorBody): Promise<ConnectorDto> {
    const existing = await this.requireConnector(orgId, id);

    const requestedActive = body.status === 'active';
    const fields: Record<string, unknown> = {
      name: body.name,
      description: body.description,
      status: requestedActive ? 'pending_setup' : body.status,
      displayConfig: body.displayConfig,
      rateLimitRequests: body.rateLimitRequests,
      rateLimitWindowSeconds: body.rateLimitWindowSeconds,
      maxRetries: body.maxRetries,
      failureThreshold: body.failureThreshold,
      metadata: body.metadata,
    };

    // Config updates are merged with the existing decrypted config so callers
    // can patch a single secret without resubmitting the whole bag. The merged
    // result is re-validated and re-encrypted.
    if (body.config) {
      const mergedInput = { ...decryptConfig(existing.encrypted_config), ...body.config };
      const merged = this.validateConfigOrThrow(existing.type, mergedInput);
      await this.assertSafeUrls(existing.type, merged);
      fields.encryptedConfig = encryptConfig(merged);
      // Re-derive capabilities (type can't change, but keeps them authoritative).
      const caps = getTypeCapabilities(existing.type);
      fields.richFormatting = caps.richFormatting;
      fields.threading = caps.threading;
      fields.attachments = caps.attachments;
    }

    const row = await this.repository.update(orgId, id, fields);
    const validationJobId = requestedActive ? await this.enqueueConnectorTestIfAvailable(orgId, id) : null;
    if (validationJobId) {
      await this.audit(orgId, id, 'test.queued', meta, { jobId: validationJobId, reason: 'status_activation' });
    }
    await this.audit(orgId, id, 'updated', meta, { changed: Object.keys(fields).filter((k) => fields[k] !== undefined) });
    await this.emitEvent('connector.updated', { orgId, connectorId: id });
    return this.toDto(row);
  }

  async deleteConnector(orgId: string, meta: RequestMeta, id: string): Promise<void> {
    await this.requireConnector(orgId, id);
    await this.repository.softDelete(orgId, id);
    await this.audit(orgId, id, 'deleted', meta);
    await this.emitEvent('connector.deleted', { orgId, connectorId: id });
    this.logger.info({ orgId, connectorId: id }, 'Connector soft-deleted');
  }

  async setConnectorEnabled(orgId: string, meta: RequestMeta, id: string, enabled: boolean): Promise<ConnectorDto> {
    await this.requireConnector(orgId, id);
    await this.repository.setStatus(orgId, id, enabled ? 'pending_setup' : 'disabled');
    const validationJobId = enabled ? await this.enqueueConnectorTestIfAvailable(orgId, id) : null;
    await this.audit(orgId, id, enabled ? 'enabled' : 'disabled', meta, enabled ? { validationJobId } : undefined);
    if (validationJobId) {
      await this.audit(orgId, id, 'test.queued', meta, { jobId: validationJobId, reason: 'enable' });
    }
    const row = await this.requireConnector(orgId, id);
    return this.toDto(row);
  }

  async rotateSecret(orgId: string, meta: RequestMeta, id: string, body: RotateSecretBody): Promise<ConnectorDto> {
    const existing = await this.requireConnector(orgId, id);
    const normalized = this.validateConfigOrThrow(existing.type, body.config);
    const probe = factoryCreate(existing.type, ephemeralContext(existing.type, normalized, this.logger));
    const rotation = await probe.rotateSecret(normalized);
    if (!rotation.valid) {
      throw new ConnectorConfigError('Connector secret rotation failed validation', { errors: rotation.errors });
    }
    await this.repository.upsertCredential({
      organizationId: orgId,
      connectorId: id,
      credentialType: 'config',
      keyName: 'config',
      encryptedValue: encryptConfig(rotation.normalized ?? normalized),
      expiresAt: null,
      actorUserId: meta.actorUserId,
    });
    await this.audit(orgId, id, 'secret.rotated', meta, { versioned: true });
    const row = await this.requireConnector(orgId, id);
    return this.toDto(row);
  }

  validateConfiguration(body: ValidateConfigurationBody): { valid: boolean; errors: string[]; normalized?: Record<string, unknown> } {
    if (!isConnectorTypeRegistered(body.type)) {
      throw new ConnectorTypeUnsupportedError(body.type);
    }
    const probe = factoryCreate(body.type, ephemeralContext(body.type, body.config, this.logger));
    const result = probe.validateConfig(body.config);
    return {
      valid: result.valid,
      errors: result.errors,
      ...(result.normalized ? { normalized: result.normalized } : {}),
    };
  }

  // ── Operations ──────────────────────────────────────────────────────────
  async testConnection(orgId: string, meta: RequestMeta, id: string): Promise<ConnectionTestResult> {
    const row = await this.requireConnector(orgId, id);
    const result = await this.runConnectionTest(row, meta.actorUserId);
    await this.audit(orgId, id, 'tested', meta, { success: result.success });
    return result;
  }

  async runConnectionTest(row: ConnectorConfigRow, triggeredBy: string | null): Promise<ConnectionTestResult> {
    const startedAt = Date.now();
    let result: ConnectionTestResult;
    try {
      const connector = await this.dispatcher.instantiate(row);
      result = await connector.testConnection();
    } catch (err) {
      result = {
        success: false,
        message: err instanceof Error ? err.message : 'Connector test failed',
        latencyMs: Date.now() - startedAt,
        details: {
          errorType: err instanceof Error ? err.name : 'UnknownError',
        },
      };
    }

    const state = result.success ? 'healthy' : 'unhealthy';
    await this.repository.insertHealthCheck(
      row.id, state, result.latencyMs, result.success ? null : result.message, result.details ?? {},
    );
    await this.repository.insertTestRun({
      connectorId: row.id,
      triggeredBy,
      status: result.success ? 'success' : 'failed',
      response: { message: result.message, details: result.details ?? {} },
      durationMs: result.latencyMs,
    });
    if (result.success && row.status === 'pending_setup') {
      await this.repository.setStatus(row.organization_id, row.id, 'active');
    }
    return result;
  }

  async runHealthCheckForConnector(orgId: string, meta: RequestMeta, id: string): Promise<HealthStatus> {
    const row = await this.requireConnector(orgId, id);
    const health = await this.runHealthCheck(row);
    await this.audit(orgId, id, 'health.checked', meta, { state: health.state });
    return health;
  }

  async sendTest(orgId: string, meta: RequestMeta, id: string, body: SendTestNotificationBody): Promise<DispatchSummary> {
    const row = await this.requireConnector(orgId, id);
    const correlationId = NotificationDispatcher.newCorrelationId();

    const outcome = await this.dispatcher.dispatch(row, {
      notificationType: body.notificationType,
      severity: body.severity,
      title: body.title,
      body: body.body,
      ...(body.fields ? { fields: body.fields } : {}),
      ...(body.url ? { url: body.url } : {}),
      correlationId,
    });

    await this.audit(orgId, id, 'sent', meta, { deliveryId: outcome.deliveryId, status: outcome.status });
    return {
      deliveryId: outcome.deliveryId,
      status: outcome.status,
      correlationId,
      success: outcome.result.success,
      ...(outcome.result.externalMessageId ? { externalMessageId: outcome.result.externalMessageId } : {}),
      ...(outcome.result.errorMessage ? { errorMessage: outcome.result.errorMessage } : {}),
    };
  }

  async listDeliveries(
    orgId: string,
    filters: { connectorId?: string; limit: number; offset: number },
  ): Promise<{ data: DeliveryDto[]; total: number }> {
    const { data, total } = await this.repository.listDeliveries(orgId, filters);
    return { data: data.map((d) => this.deliveryToDto(d)), total };
  }

  async getDelivery(orgId: string, deliveryId: string): Promise<DeliveryDto & { payload?: Record<string, unknown> }> {
    const row = await this.repository.getDelivery(orgId, deliveryId);
    if (!row) throw new ConnectorNotFoundError(deliveryId);
    return { ...this.deliveryToDto(row), payload: row.payload };
  }

  async listDeliveryAttempts(
    orgId: string,
    connectorId: string,
    deliveryId: string,
    query: PaginationQuery,
  ): Promise<{ data: DeliveryAttemptRow[]; total: number }> {
    return this.repository.listAttempts(orgId, connectorId, deliveryId, query);
  }

  async retryDelivery(orgId: string, meta: RequestMeta, deliveryId: string): Promise<DeliveryDto> {
    const row = await this.repository.retryDelivery(orgId, deliveryId);
    if (!row) throw new ConnectorNotFoundError(deliveryId);
    let retryJobId: string | null = null;
    if (this.enqueueConnectorJob) {
      const jobId = await this.enqueueConnectorJob(
        CONNECTOR_JOBS.deliveryRetry,
        { organizationId: orgId, deliveryId, actorUserId: meta.actorUserId },
        { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
      );
      retryJobId = typeof jobId === 'string' ? jobId : null;
    }
    await this.audit(orgId, row.connector_id, 'delivery.retry_requested', meta, { deliveryId, retryJobId });
    return this.deliveryToDto(row);
  }

  async listHealthHistory(orgId: string, connectorId: string, query: PaginationQuery): Promise<{ data: HealthStatus[]; total: number }> {
    const { data, total } = await this.repository.listHealthChecks(orgId, connectorId, query);
    return {
      data: data.map((row) => ({
        state: row.status,
        ...(row.response_time_ms !== null ? { responseTimeMs: row.response_time_ms } : {}),
        ...(row.error_message ? { message: row.error_message } : {}),
        checkedAt: row.checked_at.toISOString(),
        details: row.details,
      })),
      total,
    };
  }

  async listTestRuns(orgId: string, connectorId: string, query: PaginationQuery): Promise<{ data: import('./types.js').ConnectorTestRunDto[]; total: number }> {
    const { data, total } = await this.repository.listTestRuns(orgId, connectorId, query);
    return {
      data: data.map((row) => ({
        id: row.id,
        connectorId: row.connector_id,
        status: row.status,
        response: row.response,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
      })),
      total,
    };
  }

  async listAudit(orgId: string, connectorId: string | null, query: PaginationQuery): Promise<{ data: ConnectorAuditLogDto[]; total: number }> {
    const { data, total } = await this.repository.listAuditLogs(orgId, connectorId, query);
    return {
      data: data.map((row) => ({
        id: row.id,
        connectorId: row.connector_id,
        action: row.action,
        actorId: row.actor_id,
        actorType: row.actor_type,
        changesSummary: row.changes_summary,
        createdAt: row.created_at,
      })),
      total,
    };
  }

  async createRoute(orgId: string, meta: RequestMeta, connectorId: string, body: CreateConnectorRouteBody): Promise<ConnectorRouteDto> {
    const row = await this.repository.createRoute(orgId, connectorId, body);
    await this.audit(orgId, connectorId, 'route.created', meta, { routeId: row.id });
    return this.routeToDto(row);
  }

  async updateRoute(orgId: string, meta: RequestMeta, connectorId: string, routeId: string, body: UpdateConnectorRouteBody): Promise<ConnectorRouteDto> {
    const row = await this.repository.updateRoute(orgId, connectorId, routeId, body);
    if (!row) throw new ConnectorNotFoundError(routeId);
    await this.audit(orgId, connectorId, 'route.updated', meta, { routeId });
    return this.routeToDto(row);
  }

  async deleteRoute(orgId: string, meta: RequestMeta, connectorId: string, routeId: string): Promise<void> {
    const deleted = await this.repository.deleteRoute(orgId, connectorId, routeId);
    if (!deleted) throw new ConnectorNotFoundError(routeId);
    await this.audit(orgId, connectorId, 'route.deleted', meta, { routeId });
  }

  async listRoutes(orgId: string, connectorId: string, query: PaginationQuery): Promise<{ data: ConnectorRouteDto[]; total: number }> {
    const { data, total } = await this.repository.listRoutes(orgId, connectorId, query);
    return { data: data.map((row) => this.routeToDto(row)), total };
  }

  async startOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<ConnectorOAuthStartDto> {
    await this.requireConnector(orgId, connectorId);
    const state = randomBytes(32).toString('base64url');
    const codeVerifier = randomBytes(64).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    await this.repository.createOAuthState({ connectorId, state, codeVerifier, expiresAt });
    await this.audit(orgId, connectorId, 'oauth.started', meta, { expiresAt: expiresAt.toISOString() });
    return { state, codeChallenge, codeChallengeMethod: 'S256', expiresAt };
  }

  async completeOAuth(
    orgId: string,
    meta: RequestMeta,
    connectorId: string,
    body: OAuthCallbackBody,
  ): Promise<{ connected: boolean; refreshQueued: boolean; refreshJobId: string | null }> {
    const state = await this.repository.consumeOAuthState(orgId, connectorId, body.state);
    if (!state) throw new ConnectorError('Invalid or expired OAuth state', 'CONNECTOR_OAUTH_STATE_INVALID', 400);
    if (body.error) {
      await this.audit(orgId, connectorId, 'oauth.failed', meta, { error: body.error });
      throw new ConnectorError('OAuth provider returned an error', 'CONNECTOR_OAUTH_FAILED', 400, { error: body.error });
    }

    const hasTokenMaterial = Boolean(body.accessToken || body.refreshToken);
    if (!hasTokenMaterial) {
      await this.audit(orgId, connectorId, 'oauth.callback_validated', meta);
      return { connected: false, refreshQueued: false, refreshJobId: null };
    }

    const expiresAt = this.resolveOAuthExpiry(body);
    await this.repository.upsertCredential({
      organizationId: orgId,
      connectorId,
      credentialType: 'oauth',
      keyName: 'oauth',
      encryptedValue: encryptConfig({
        accessToken: body.accessToken ?? null,
        refreshToken: body.refreshToken ?? null,
        tokenType: body.tokenType ?? 'Bearer',
        scope: body.scope ?? null,
        expiresAt: expiresAt?.toISOString() ?? null,
      }),
      expiresAt,
      actorUserId: meta.actorUserId,
    });
    await this.repository.setStatus(orgId, connectorId, 'active');

    const refresh = await this.enqueueOAuthRefreshIfNeeded(orgId, connectorId, expiresAt);
    await this.audit(orgId, connectorId, 'oauth.connected', meta, {
      hasAccessToken: Boolean(body.accessToken),
      hasRefreshToken: Boolean(body.refreshToken),
      expiresAt: expiresAt?.toISOString() ?? null,
      refreshQueued: refresh.queued,
    });
    return { connected: true, refreshQueued: refresh.queued, refreshJobId: refresh.jobId };
  }

  async refreshOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<{ queued: boolean; jobId: string | null }> {
    await this.requireConnector(orgId, connectorId);
    if (!this.enqueueConnectorJob) {
      throw new ConnectorError('Connector OAuth refresh queue is not configured', 'CONNECTOR_QUEUE_UNAVAILABLE', 503);
    }
    const jobId = await this.enqueueConnectorJob(
      CONNECTOR_JOBS.oauthRefresh,
      { organizationId: orgId, connectorId },
      { retryLimit: 3, retryDelay: 60, retryBackoff: true, expireInSeconds: 3600 },
    );
    await this.audit(orgId, connectorId, 'oauth.refresh_requested', meta);
    return { queued: true, jobId: typeof jobId === 'string' ? jobId : null };
  }

  async disconnectOAuth(orgId: string, meta: RequestMeta, connectorId: string): Promise<{ disconnected: boolean }> {
    await this.requireConnector(orgId, connectorId);
    const revokedAt = new Date();
    await this.repository.upsertCredential({
      organizationId: orgId,
      connectorId,
      credentialType: 'oauth_revoked',
      keyName: 'oauth',
      encryptedValue: encryptConfig({ revokedAt: revokedAt.toISOString() }),
      expiresAt: revokedAt,
      actorUserId: meta.actorUserId,
    });
    await this.repository.setStatus(orgId, connectorId, 'revoked');
    await this.audit(orgId, connectorId, 'oauth.disconnected', meta, { revokedAt: revokedAt.toISOString() });
    return { disconnected: true };
  }

  async previewNotification(body: PreviewNotificationBody): Promise<Record<string, unknown>> {
    return {
      notificationType: body.notificationType,
      severity: body.severity,
      title: body.title,
      body: body.body,
      fields: body.fields ?? [],
      url: body.url ?? null,
      metadata: body.metadata ?? {},
    };
  }

  /** Run a health check for a connector row (used by the background monitor). */
  async runHealthCheck(row: ConnectorConfigRow): Promise<HealthStatus> {
    const connector = await this.dispatcher.instantiate(row);
    const health = await connector.getHealthStatus();
    await this.repository.insertHealthCheck(
      row.id,
      health.state,
      health.responseTimeMs ?? null,
      health.state === 'healthy' ? null : (health.message ?? null),
      health.details ?? {},
    );
    return health;
  }

  // ── Internals ──────────────────────────────────────────────────────────
  private async requireConnector(orgId: string, id: string): Promise<ConnectorConfigRow> {
    const row = await this.repository.findById(orgId, id);
    if (!row) throw new ConnectorNotFoundError(id);
    return row;
  }

  private validateConfigOrThrow(type: ConnectorType, config: Record<string, unknown>): Record<string, unknown> {
    const probe = factoryCreate(type, ephemeralContext(type, config, this.logger));
    const result = probe.validateConfig(config);
    if (!result.valid) {
      throw new ConnectorConfigError('Connector configuration is invalid', { errors: result.errors });
    }
    return result.normalized ?? config;
  }

  private async assertSafeUrls(type: ConnectorType, config: Record<string, unknown>): Promise<void> {
    try {
      if (type === 'webhook' && typeof config.url === 'string') {
        await assertPubliclyResolvable(new URL(config.url));
      } else if ((type === 'teams' || type === 'discord') && typeof config.webhookUrl === 'string') {
        await assertPubliclyResolvable(new URL(config.webhookUrl));
      }
    } catch (e) {
      throw new ConnectorConfigError(e instanceof Error ? e.message : 'Invalid URL');
    }
  }

  private async audit(
    orgId: string,
    connectorId: string | null,
    action: string,
    meta: RequestMeta,
    changesSummary?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.repository.insertAuditLog({
        organizationId: orgId,
        connectorId,
        action,
        actorId: meta.actorUserId,
        actorType: meta.actorUserId ? 'user' : 'system',
        ...(changesSummary ? { changesSummary } : {}),
        ipAddress: meta.actorIp,
        userAgent: meta.actorUserAgent,
        requestId: meta.requestId,
      });
    } catch (err) {
      // Audit must never block the operation.
      this.logger.error({ err, action, connectorId }, 'Failed to write connector audit log');
    }
  }

  private toDto(row: ConnectorConfigRow): ConnectorDto {
    return {
      id: row.id,
      organizationId: row.organization_id,
      name: row.name,
      type: row.type,
      status: row.status,
      description: row.description,
      displayConfig: row.display_config,
      capabilities: {
        richFormatting: row.supports_rich_formatting,
        threading: row.supports_threading,
        attachments: row.supports_attachments,
      },
      rateLimit: { requests: row.rate_limit_requests, windowSeconds: row.rate_limit_window_seconds },
      retry: {
        maxRetries: row.max_retries,
        backoffBaseMs: row.retry_backoff_base_ms,
        backoffMultiplier: Number(row.retry_backoff_multiplier),
      },
      health: {
        lastHealthCheckAt: row.last_health_check_at,
        lastSuccessfulDeliveryAt: row.last_successful_delivery_at,
        consecutiveFailures: row.consecutive_failures,
        failureThreshold: row.failure_threshold,
      },
      metadata: row.metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private deliveryToDto(d: DeliveryRow): DeliveryDto {
    return {
      id: d.id,
      connectorId: d.connector_id,
      notificationType: d.notification_type,
      severity: d.severity,
      status: d.status,
      attempts: d.attempts,
      maxAttempts: d.max_attempts,
      retryCount: d.retry_count,
      nextRetryAt: d.next_retry_at,
      externalMessageId: d.external_message_id,
      responseStatusCode: d.response_status_code,
      errorMessage: d.error_message,
      latencyMs: d.delivery_latency_ms,
      correlationId: d.correlation_id,
      createdAt: d.created_at,
      sentAt: d.sent_at,
      deliveredAt: d.delivered_at,
    };
  }

  private routeToDto(row: import('./types.js').ConnectorRouteRow): ConnectorRouteDto {
    return {
      id: row.id,
      connectorId: row.connector_id,
      projectId: row.project_id,
      environment: row.environment,
      eventType: row.event_type,
      severity: row.severity,
      enabled: row.enabled,
      createdAt: row.created_at,
    };
  }

  private resolveOAuthExpiry(body: OAuthCallbackBody): Date | null {
    if (body.expiresAt) return body.expiresAt;
    if (body.expiresIn) return new Date(Date.now() + body.expiresIn * 1000);
    return null;
  }

  private async enqueueOAuthRefreshIfNeeded(
    orgId: string,
    connectorId: string,
    expiresAt: Date | null,
  ): Promise<{ queued: boolean; jobId: string | null }> {
    if (!expiresAt || !this.enqueueConnectorJob) {
      return { queued: false, jobId: null };
    }

    const refreshAt = new Date(Math.max(Date.now(), expiresAt.getTime() - 5 * 60_000));
    const jobId = await this.enqueueConnectorJob(
      CONNECTOR_JOBS.oauthRefresh,
      { organizationId: orgId, connectorId },
      {
        startAfter: refreshAt,
        retryLimit: 3,
        retryDelay: 60,
        retryBackoff: true,
        expireInSeconds: 3600,
      },
    );
    return { queued: true, jobId: typeof jobId === 'string' ? jobId : null };
  }

  private async enqueueConnectorTestIfAvailable(orgId: string, connectorId: string): Promise<string | null> {
    if (!this.enqueueConnectorJob) return null;
    const jobId = await this.enqueueConnectorJob(
      CONNECTOR_JOBS.test,
      { organizationId: orgId, connectorId },
      { retryLimit: 2, retryDelay: 60, retryBackoff: true, expireInSeconds: 1800 },
    );
    return typeof jobId === 'string' ? jobId : null;
  }
}
