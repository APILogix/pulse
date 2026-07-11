import { pool } from '../../../config/database.js';
import { ConnectorConflictError, ConnectorNotFoundError, } from '../types.js';
const CONNECTOR_COLUMNS = `
  id, organization_id, name, type, status, description,
  encrypted_config, config_schema_version, display_config,
  supports_rich_formatting, supports_threading, supports_attachments,
  rate_limit_requests, rate_limit_window_seconds,
  max_retries, retry_backoff_base_ms, retry_backoff_multiplier,
  last_health_check_at, last_successful_delivery_at,
  consecutive_failures, failure_threshold,
  metadata, created_by, created_at, updated_at, deleted_at
`;
export class ConnectorRepository {
    db = pool;
    async withTransaction(fn) {
        const client = await this.db.connect();
        try {
            await client.query('BEGIN');
            const result = await fn(client);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            await client.query('ROLLBACK');
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ── Connector CRUD ─────────────────────────────────────────────────────
    async create(input) {
        try {
            const r = await this.db.query(`INSERT INTO connector_configs
           (organization_id, name, type, status, description, encrypted_config,
            display_config, supports_rich_formatting, supports_threading, supports_attachments,
            rate_limit_requests, rate_limit_window_seconds, max_retries, failure_threshold,
            metadata, created_by)
         VALUES ($1,$2,$3,'pending_setup',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         RETURNING ${CONNECTOR_COLUMNS}`, [
                input.organizationId, input.name, input.type, input.description,
                input.encryptedConfig, JSON.stringify(input.displayConfig),
                input.capabilities.richFormatting, input.capabilities.threading, input.capabilities.attachments,
                input.rateLimitRequests, input.rateLimitWindowSeconds, input.maxRetries, input.failureThreshold,
                JSON.stringify(input.metadata), input.createdBy,
            ]);
            return r.rows[0];
        }
        catch (e) {
            if (e.code === '23505') {
                throw new ConnectorConflictError('A connector with this name already exists');
            }
            throw e;
        }
    }
    async findById(organizationId, id) {
        const r = await this.db.query(`SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        return r.rows[0] ?? null;
    }
    /** Fetch without org scoping — only for trusted internal paths (workers). */
    async findByIdInternal(id) {
        const r = await this.db.query(`SELECT ${CONNECTOR_COLUMNS} FROM connector_configs WHERE id=$1 AND deleted_at IS NULL`, [id]);
        return r.rows[0] ?? null;
    }
    /**
     * Bulk-fetch connectors by id (single query — no N+1). Used by the alerting
     * batch worker to resolve every connector referenced by a batch of events.
     * Not org-scoped: callers must already have validated tenant ownership of
     * the events that reference these connector ids.
     */
    async getByIds(ids) {
        if (ids.length === 0)
            return [];
        const r = await this.db.query(`SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`, [ids]);
        return r.rows;
    }
    async list(organizationId, query) {
        const conditions = ['organization_id=$1', 'deleted_at IS NULL'];
        const params = [organizationId];
        if (query.type) {
            params.push(query.type);
            conditions.push(`type=$${params.length}`);
        }
        if (query.status) {
            params.push(query.status);
            conditions.push(`status=$${params.length}`);
        }
        if (query.search) {
            params.push(`%${query.search}%`);
            conditions.push(`name ILIKE $${params.length}`);
        }
        const where = conditions.join(' AND ');
        const countRes = await this.db.query(`SELECT COUNT(*)::text AS count FROM connector_configs WHERE ${where}`, params);
        const total = Number(countRes.rows[0]?.count ?? 0);
        params.push(query.limit, query.offset);
        const r = await this.db.query(`SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
        return { data: r.rows, total };
    }
    /** All non-deleted connectors in an active/error state (for health sweeps). */
    async listMonitorable() {
        const r = await this.db.query(`SELECT ${CONNECTOR_COLUMNS} FROM connector_configs
       WHERE deleted_at IS NULL AND status IN ('active','error')`);
        return r.rows;
    }
    async update(organizationId, id, fields) {
        const map = {
            name: 'name',
            description: 'description',
            status: 'status',
            encryptedConfig: 'encrypted_config',
            displayConfig: 'display_config',
            richFormatting: 'supports_rich_formatting',
            threading: 'supports_threading',
            attachments: 'supports_attachments',
            rateLimitRequests: 'rate_limit_requests',
            rateLimitWindowSeconds: 'rate_limit_window_seconds',
            maxRetries: 'max_retries',
            failureThreshold: 'failure_threshold',
            metadata: 'metadata',
        };
        const cols = [];
        const vals = [];
        for (const [k, v] of Object.entries(fields)) {
            if (v === undefined || !map[k])
                continue;
            cols.push(`${map[k]}=$${cols.length + 1}`);
            vals.push(k === 'displayConfig' || k === 'metadata' ? JSON.stringify(v) : v);
        }
        if (cols.length === 0) {
            const existing = await this.findById(organizationId, id);
            if (!existing)
                throw new ConnectorNotFoundError(id);
            return existing;
        }
        vals.push(id, organizationId);
        try {
            const r = await this.db.query(`UPDATE connector_configs SET ${cols.join(',')}
         WHERE id=$${vals.length - 1} AND organization_id=$${vals.length} AND deleted_at IS NULL
         RETURNING ${CONNECTOR_COLUMNS}`, vals);
            if (!r.rows[0])
                throw new ConnectorNotFoundError(id);
            return r.rows[0];
        }
        catch (e) {
            if (e.code === '23505') {
                throw new ConnectorConflictError('A connector with this name already exists');
            }
            throw e;
        }
    }
    async softDelete(organizationId, id) {
        const r = await this.db.query(`UPDATE connector_configs SET deleted_at=NOW(), status='inactive'
       WHERE id=$1 AND organization_id=$2 AND deleted_at IS NULL`, [id, organizationId]);
        if (r.rowCount === 0)
            throw new ConnectorNotFoundError(id);
    }
    // ── Health / failure bookkeeping ───────────────────────────────────────
    async setStatus(organizationId, id, status) {
        const r = await this.db.query(`UPDATE connector_configs SET status=$1
       WHERE id=$2 AND organization_id=$3 AND deleted_at IS NULL`, [status, id, organizationId]);
        if (r.rowCount === 0)
            throw new ConnectorNotFoundError(id);
    }
}
//# sourceMappingURL=connector.repository.js.map