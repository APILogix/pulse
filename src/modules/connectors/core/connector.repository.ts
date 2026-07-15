/**
 * Connector persistence layer.
 *
 * Owns all SQL for connector_configs, deliveries, dead-letter, health checks,
 * and the connector-scoped audit log. The service layer enforces tenant
 * isolation by always passing `organizationId` into queries (this codebase
 * isolates tenants in the application layer — see module README / migration).
 */
import type { PoolClient } from 'pg';
import { pool } from '../../../config/database.js';
import {
  ConnectorConflictError,
  ConnectorNotFoundError,
  type ConnectorConfigRow,
  type ConnectorStatus,
  type ConnectorType,
  type DeliveryRow,
  type DeliveryStatus,
  type FailureCategory,
  type HealthCheckRow,
  type HealthState,
  type ListConnectorsQuery,
  type NotificationSeverity,
} from '../types.js';

const CONNECTOR_COLUMNS = `
  id, organization_id, project_id, name, provider AS type, status, description,
  COALESCE(
    (SELECT encrypted_value FROM connector_credentials cc
     WHERE cc.connector_id = connector_configs.id AND cc.key_name = 'config'
     ORDER BY cc.version DESC LIMIT 1),
    ''::bytea
  ) AS encrypted_config,
  1 AS config_schema_version,
  public_config AS display_config,
  supports_rich_formatting, supports_threading, supports_attachments,
  rate_limit_requests, rate_limit_window_seconds,
  max_retries, retry_backoff_base_ms, retry_backoff_multiplier,
  last_health_check_at, last_successful_delivery_at,
  consecutive_failures, failure_threshold,
  provider_metadata AS metadata, created_by, updated_by, created_at, updated_at, deleted_at
`;

export interface CreateConnectorInput {
  organizationId: string;
  name: string;
  type: ConnectorType;
  description: string | null;
  encryptedConfig: Buffer;
  displayConfig: Record<string, unknown>;
  capabilities: { richFormatting: boolean; threading: boolean; attachments: boolean };
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

export class ConnectorRepository {
  private readonly db = pool;

  async withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // ── Connector CRUD ─────────────────────────────────────────────────────
  async create(input: CreateConnectorInput): Promise<ConnectorConfigRow> {
    try {
      return await this.withTransaction(async (client) => {
        const created = await client.query<{ id: string }>(
          `INSERT INTO connector_configs
             (organization_id, name, provider, status, description, public_config,
              supports_rich_formatting, supports_threading, supports_attachments,
              rate_limit_requests, rate_limit_window_seconds, max_retries, failure_threshold,
              provider_metadata, created_by)
           VALUES ($1,$2,$3,'pending_setup',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
           RETURNING id`,
          [
            input.organizationId, input.name, input.type, input.description,
            JSON.stringify(input.displayConfig),
            input.capabilities.richFormatting, input.capabilities.threading, input.capabilities.attachments,
            input.rateLimitRequests, input.rateLimitWindowSeconds, input.maxRetries, input.failureThreshold,
            JSON.stringify(input.metadata), input.createdBy,
          ],
        );
        const connectorId = created.rows[0]!.id;
        await client.query(
          `INSERT INTO connector_credentials
             (connector_id, credential_type, key_name, encrypted_value, algorithm, version, created_by)
           VALUES ($1, 'config', 'config', $2, 'aes-256-gcm', 1, $3)`,
          [connectorId, input.encryptedConfig, input.createdBy],
        );
        const r = await client.query<ConnectorConfigRow>(
          `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs WHERE id=$1`,
          [connectorId],
        );
        return r.rows[0]!;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConnectorConflictError('A connector with this name already exists');
      }
      throw e;
    }
  }

  async findById(organizationId: string, id: string): Promise<ConnectorConfigRow | null> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    return r.rows[0] ?? null;
  }

  /** Fetch without org scoping — only for trusted internal paths (workers). */
  async findByIdInternal(id: string): Promise<ConnectorConfigRow | null> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs WHERE id=$1 AND deleted_at IS NULL`,
      [id],
    );
    return r.rows[0] ?? null;
  }

  /**
   * Bulk-fetch connectors by id (single query — no N+1). Used by the alerting
   * batch worker to resolve every connector referenced by a batch of events.
   * Not org-scoped: callers must already have validated tenant ownership of
   * the events that reference these connector ids.
   */
  async getByIds(ids: string[]): Promise<ConnectorConfigRow[]> {
    if (ids.length === 0) return [];
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
      [ids],
    );
    return r.rows;
  }

  async list(
    organizationId: string,
    query: ListConnectorsQuery,
  ): Promise<{ data: ConnectorConfigRow[]; total: number }> {
    const conditions: string[] = ['organization_id=$1', 'deleted_at IS NULL'];
    const params: unknown[] = [organizationId];

    if (query.type) { params.push(query.type); conditions.push(`provider=$${params.length}`); }
    if (query.status) { params.push(query.status); conditions.push(`status=$${params.length}`); }
    if (query.search) { params.push(`%${query.search}%`); conditions.push(`name ILIKE $${params.length}`); }

    const where = conditions.join(' AND ');

    const countRes = await this.db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM connector_configs WHERE ${where}`,
      params,
    );
    const total = Number(countRes.rows[0]?.count ?? 0);

    params.push(query.limit, query.offset);
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { data: r.rows, total };
  }

  /** All non-deleted connectors in an active/error state (for health sweeps). */
  async listMonitorable(): Promise<ConnectorConfigRow[]> {
    const r = await this.db.query<ConnectorConfigRow>(
      `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE deleted_at IS NULL AND status IN ('active','error')`,
    );
    return r.rows;
  }

  async update(
    organizationId: string,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<ConnectorConfigRow> {
    const map: Record<string, string> = {
      name: 'name',
      description: 'description',
      status: 'status',
      displayConfig: 'public_config',
      richFormatting: 'supports_rich_formatting',
      threading: 'supports_threading',
      attachments: 'supports_attachments',
      rateLimitRequests: 'rate_limit_requests',
      rateLimitWindowSeconds: 'rate_limit_window_seconds',
      maxRetries: 'max_retries',
      failureThreshold: 'failure_threshold',
      metadata: 'provider_metadata',
    };
    const encryptedConfig = fields.encryptedConfig instanceof Buffer ? fields.encryptedConfig : null;
    if (encryptedConfig) {
      delete fields.encryptedConfig;
    }
    const cols: string[] = [];
    const vals: unknown[] = [];
    for (const [k, v] of Object.entries(fields)) {
      if (v === undefined || !map[k]) continue;
      cols.push(`${map[k]}=$${cols.length + 1}`);
      vals.push(k === 'displayConfig' || k === 'metadata' ? JSON.stringify(v) : v);
    }
    if (cols.length === 0 && !encryptedConfig) {
      const existing = await this.findById(organizationId, id);
      if (!existing) throw new ConnectorNotFoundError(id);
      return existing;
    }
    try {
      return await this.withTransaction(async (client) => {
        const ownsConnector = await client.query<{ exists: boolean }>(
          `SELECT EXISTS(
             SELECT 1 FROM connector_configs
             WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
           ) AS "exists"`,
          [id, organizationId],
        );
        if (!ownsConnector.rows[0]?.exists) throw new ConnectorNotFoundError(id);

        if (encryptedConfig) {
          const previous = await client.query<{ id: string; encrypted_value: Buffer; version: number }>(
            `SELECT id, encrypted_value, version FROM connector_credentials
             WHERE connector_id=$1 AND key_name='config'
             FOR UPDATE`,
            [id],
          );
          const current = previous.rows[0];
          if (current) {
            await client.query(
              `INSERT INTO connector_secret_versions
                 (credential_id, version, encrypted_value, rotated_by)
               VALUES ($1,$2,$3,NULL)`,
              [current.id, current.version, current.encrypted_value],
            );
            await client.query(
              `UPDATE connector_credentials
               SET encrypted_value=$1, version=version+1, rotated_at=NOW(), updated_at=NOW()
               WHERE id=$2`,
              [encryptedConfig, current.id],
            );
          } else {
            await client.query(
              `INSERT INTO connector_credentials
                 (connector_id, credential_type, key_name, encrypted_value, algorithm, version)
               VALUES ($1, 'config', 'config', $2, 'aes-256-gcm', 1)`,
              [id, encryptedConfig],
            );
          }
        }

        let row: ConnectorConfigRow | undefined;
        if (cols.length > 0) {
          vals.push(id, organizationId);
          const r = await client.query<ConnectorConfigRow>(
            `UPDATE connector_configs SET ${cols.join(',')}, updated_at=NOW()
             WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL
             RETURNING ${CONNECTOR_COLUMNS}`,
            vals,
          );
          row = r.rows[0];
        } else {
          const r = await client.query<ConnectorConfigRow>(
            `SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
             WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
            [id, organizationId],
          );
          row = r.rows[0];
        }
        if (!row) throw new ConnectorNotFoundError(id);
        return row;
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') {
        throw new ConnectorConflictError('A connector with this name already exists');
      }
      throw e;
    }
  }

  async upsertCredential(input: UpsertConnectorCredentialInput): Promise<void> {
    await this.withTransaction(async (client) => {
      const ownsConnector = await client.query<{ exists: boolean }>(
        `SELECT EXISTS(
           SELECT 1 FROM connector_configs
           WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL
         ) AS "exists"`,
        [input.connectorId, input.organizationId],
      );
      if (!ownsConnector.rows[0]?.exists) throw new ConnectorNotFoundError(input.connectorId);

      const previous = await client.query<{ id: string; encrypted_value: Buffer; version: number }>(
        `SELECT id, encrypted_value, version FROM connector_credentials
         WHERE connector_id=$1 AND key_name=$2
         FOR UPDATE`,
        [input.connectorId, input.keyName],
      );
      const current = previous.rows[0];

      if (current) {
        await client.query(
          `INSERT INTO connector_secret_versions
             (credential_id, version, encrypted_value, rotated_by)
           VALUES ($1,$2,$3,$4)`,
          [current.id, current.version, current.encrypted_value, input.actorUserId],
        );
        await client.query(
          `UPDATE connector_credentials
           SET credential_type=$1, encrypted_value=$2, algorithm='aes-256-gcm',
               version=version+1, expires_at=$3, rotated_at=NOW(), updated_at=NOW()
           WHERE id=$4`,
          [input.credentialType, input.encryptedValue, input.expiresAt, current.id],
        );
        return;
      }

      await client.query(
        `INSERT INTO connector_credentials
           (connector_id, credential_type, key_name, encrypted_value, algorithm, version, expires_at, created_by)
         VALUES ($1,$2,$3,$4,'aes-256-gcm',1,$5,$6)`,
        [
          input.connectorId,
          input.credentialType,
          input.keyName,
          input.encryptedValue,
          input.expiresAt,
          input.actorUserId,
        ],
      );
    });
  }

  async getCredential(
    organizationId: string,
    connectorId: string,
    keyName: string,
  ): Promise<ConnectorCredentialRow | null> {
    const r = await this.db.query<ConnectorCredentialRow>(
      `SELECT cc.id, cc.connector_id, cc.credential_type, cc.key_name,
              cc.encrypted_value, cc.algorithm, cc.version, cc.expires_at,
              cc.created_at, cc.updated_at
       FROM connector_credentials cc
       JOIN connector_configs c ON c.id = cc.connector_id
       WHERE c.organization_id=$1
         AND c.id=$2
         AND c.deleted_at IS NULL
         AND cc.key_name=$3`,
      [organizationId, connectorId, keyName],
    );
    return r.rows[0] ?? null;
  }

  async softDelete(organizationId: string, id: string): Promise<void> {
    const r = await this.db.query(
      `UPDATE connector_configs SET deleted_at=NOW(), status='inactive'
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`,
      [id, organizationId],
    );
    if (r.rowCount === 0) throw new ConnectorNotFoundError(id);
  }

  // ── Health / failure bookkeeping ───────────────────────────────────────

  async setStatus(organizationId: string, id: string, status: ConnectorStatus): Promise<void> {
    const r = await this.db.query(
      `UPDATE connector_configs SET status=$1
       WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL`,
      [status, id, organizationId],
    );
    if (r.rowCount === 0) throw new ConnectorNotFoundError(id);
  }

  // ── Deliveries ─────────────────────────────────────────────────────────
  // ── Dead letter ────────────────────────────────────────────────────────
  // ── Audit ──────────────────────────────────────────────────────────────
}
