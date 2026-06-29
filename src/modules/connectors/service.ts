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
import { ConnectorRepository } from './repository.js';
import { NotificationDispatcher } from './dispatcher.js';
import { encryptConfig } from './crypto.js';
import {
  createConnector as factoryCreate,
  ephemeralContext,
  getTypeCapabilities,
  isConnectorTypeRegistered,
  listConnectorTypes,
} from './registry.js';
import {
  ConnectorConfigError,
  ConnectorNotFoundError,
  ConnectorTypeUnsupportedError,
  type ConnectionTestResult,
  type ConnectorConfigRow,
  type ConnectorDto,
  type ConnectorType,
  type ConnectorTypeInfoDto,
  type CreateConnectorBody,
  type DeliveryDto,
  type DeliveryRow,
  type DispatchSummary,
  type HealthStatus,
  type ListConnectorsQuery,
  type RequestMeta,
  type SendTestNotificationBody,
  type UpdateConnectorBody,
} from './types.js';

export interface ConnectorServiceDeps {
  repository: ConnectorRepository;
  dispatcher: NotificationDispatcher;
  logger: FastifyBaseLogger;
  emitEvent?: (event: string, payload: Record<string, unknown>) => Promise<void>;
}

export class ConnectorService {
  private readonly repository: ConnectorRepository;
  private readonly dispatcher: NotificationDispatcher;
  private readonly logger: FastifyBaseLogger;
  private readonly emitEvent: (event: string, payload: Record<string, unknown>) => Promise<void>;

  constructor(deps: ConnectorServiceDeps) {
    this.repository = deps.repository;
    this.dispatcher = deps.dispatcher;
    this.logger = deps.logger;
    this.emitEvent = deps.emitEvent ?? (async () => undefined);
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
    await this.emitEvent('connector.created', { orgId, connectorId: row.id, type: body.type });
    this.logger.info({ orgId, connectorId: row.id, type: body.type }, 'Connector created');
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

    const fields: Record<string, unknown> = {
      name: body.name,
      description: body.description,
      status: body.status,
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
      const merged = this.validateConfigOrThrow(existing.type, body.config);
      fields.encryptedConfig = encryptConfig(merged);
      // Re-derive capabilities (type can't change, but keeps them authoritative).
      const caps = getTypeCapabilities(existing.type);
      fields.richFormatting = caps.richFormatting;
      fields.threading = caps.threading;
      fields.attachments = caps.attachments;
    }

    const row = await this.repository.update(orgId, id, fields);
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

  // ── Operations ──────────────────────────────────────────────────────────
  async testConnection(orgId: string, meta: RequestMeta, id: string): Promise<ConnectionTestResult> {
    const row = await this.requireConnector(orgId, id);
    const connector = this.dispatcher.instantiate(row);
    const result = await connector.testConnection();

    const state = result.success ? 'healthy' : 'unhealthy';
    await this.repository.insertHealthCheck(
      id, state, result.latencyMs, result.success ? null : result.message, result.details ?? {},
    );
    // A successful test promotes a freshly-created connector to active.
    if (result.success && row.status === 'pending_setup') {
      await this.repository.setStatus(orgId, id, 'active');
    }
    await this.audit(orgId, id, 'tested', meta, { success: result.success });
    return result;
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

  /** Run a health check for a connector row (used by the background monitor). */
  async runHealthCheck(row: ConnectorConfigRow): Promise<HealthStatus> {
    const connector = this.dispatcher.instantiate(row);
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
        actorType: 'user',
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
}
