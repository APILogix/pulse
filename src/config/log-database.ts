import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

const dbLogger = logger.child({ component: 'log-database' });

/**
 * LogDatabaseManager — enterprise-grade dual-pool manager for the log database.
 *
 * Architecture:
 * - Primary pool: handles all writes (INSERT, UPDATE, DELETE) and DDL
 * - Replica pool: handles read-heavy queries (SELECT) to offload the primary
 * - Falls back to primary for reads when no replica is configured
 *
 * Features:
 * - Retry with exponential backoff (skips non-retryable errors like constraint violations)
 * - Slow query detection and logging
 * - Batch insert for high-throughput event ingestion
 * - Health check for load-balancer probes
 */
class LogDatabaseManager {
  private primaryPool: Pool;
  private replicaPool: Pool | null = null;
  private isShuttingDown = false;

  constructor() {
    if (!env.LOG_DB_PRIMARY) {
      dbLogger.warn('LOG_DB_PRIMARY is not configured — log database features will be unavailable');
      // Create a pool with the main DATABASE_URL as fallback
      this.primaryPool = this.createPool(env.DATABASE_URL, 'log_primary');
    } else {
      this.primaryPool = this.createPool(env.LOG_DB_PRIMARY, 'log_primary');
    }

    // Set up replica pool if a separate replica URL is provided
    if (env.LOG_DB_REPLICA && env.LOG_DB_REPLICA !== env.LOG_DB_PRIMARY) {
      dbLogger.info('Replica pool configured — read queries will be routed to replica');
      this.replicaPool = this.createPool(env.LOG_DB_REPLICA, 'log_replica');
    }
  }

  /**
   * Creates a configured connection pool with monitoring.
   */
  private createPool(connectionString: string, appName: string): Pool {
    const pool = new Pool({
      connectionString,
      max: env.LOG_POOL_MAX,
      min: env.LOG_POOL_MIN,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      statement_timeout: env.LOG_QUERY_TIMEOUT,
      query_timeout: env.LOG_QUERY_TIMEOUT,
      application_name: `${appName}_${env.NODE_ENV}`,
      ssl: env.NODE_ENV === 'production' ? { rejectUnauthorized: true } : false,
    });

    this.setupPoolMonitoring(pool, appName);
    return pool;
  }

  /**
   * Test connections on startup (fail-fast pattern).
   * Verifies both primary and replica (if configured) are reachable.
   */
  async connect(): Promise<{ primary: Date; replica?: Date }> {
    dbLogger.info('Testing log database connections');

    // Test primary
    const primaryClient = await this.primaryPool.connect();
    try {
      const res = await primaryClient.query('SELECT NOW() AS time, current_database() AS db');
      const primaryTime = res.rows[0]?.time;
      dbLogger.info({ db: res.rows[0]?.db, time: primaryTime }, 'Log DB primary connected');

      // Test replica if configured
      let replicaTime: Date | undefined;
      if (this.replicaPool) {
        const replicaClient = await this.replicaPool.connect();
        try {
          const replicaRes = await replicaClient.query('SELECT NOW() AS time, current_database() AS db');
          replicaTime = replicaRes.rows[0]?.time;
          dbLogger.info({ db: replicaRes.rows[0]?.db, time: replicaTime }, 'Log DB replica connected');
        } finally {
          replicaClient.release();
        }
      }

      return { primary: primaryTime, ...(replicaTime ? { replica: replicaTime } : {}) };
    } finally {
      primaryClient.release();
    }
  }

  private setupPoolMonitoring(pool: Pool, name: string) {
    pool.on('connect', () => {
      dbLogger.debug({ pool: name }, 'New connection added to pool');
    });

    pool.on('error', (err) => {
      dbLogger.error({ err, pool: name }, 'Unexpected pool error');
    });
  }

  /**
   * Get a connection from the appropriate pool.
   *
   * @param operation - 'read' routes to replica (if available), 'write' always uses primary.
   * @param projectId - Optional project ID to set as a session variable for RLS.
   */
  async getConnection(options?: {
    operation?: 'read' | 'write';
    projectId?: string | undefined;
  }): Promise<PoolClient> {
    if (this.isShuttingDown) {
      throw new Error('Log database is shutting down — refusing new connections');
    }

    const useReplica = options?.operation === 'read' && this.replicaPool !== null;
    const pool = useReplica ? this.replicaPool! : this.primaryPool;
    const client = await pool.connect();

    if (options?.projectId) {
      await client.query('SET app.current_project_id = $1', [options.projectId]);
    }

    return client;
  }

  /**
   * Execute a query with retry logic and exponential backoff.
   *
   * Non-retryable errors (constraint violations, permission denied, syntax errors)
   * are thrown immediately without retry.
   */
  async queryWithRetry<T extends QueryResultRow = any>(
    sql: string,
    params?: any[],
    options: {
      maxRetries?: number;
      operation?: 'read' | 'write';
      projectId?: string | undefined;
      timeout?: number;
    } = {}
  ): Promise<QueryResult<T>> {
    const { maxRetries = env.LOG_RETRIES, operation = 'read', projectId, timeout } = options;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const client = await this.getConnection({ operation, ...(projectId !== undefined ? { projectId } : {}) });

      try {
        if (timeout) {
          await client.query(`SET statement_timeout = ${timeout}`);
        }

        const start = Date.now();
        const result = await client.query(sql, params) as QueryResult<T>;
        const duration = Date.now() - start;

        if (duration > 1000) {
          dbLogger.warn(
            { query: sql.slice(0, 120), duration, rows: result.rowCount },
            'Slow log query detected',
          );
        }

        return result;
      } catch (err: any) {
        lastError = err;

        // Non-retryable PG error codes:
        // 23505 = unique_violation, 42501 = insufficient_privilege, 42601 = syntax_error
        const NON_RETRYABLE = ['23505', '42501', '42601', '42P01', '23503'];
        if (NON_RETRYABLE.includes(err.code)) {
          throw err;
        }

        if (attempt < maxRetries - 1) {
          const delay = Math.min(1000 * (2 ** attempt), 5000);
          dbLogger.warn(
            { error: err.message, attempt: attempt + 1, nextRetryMs: delay },
            'Log query failed — retrying',
          );
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      } finally {
        client.release();
      }
    }

    throw lastError || new Error('Query failed after retries');
  }

  /**
   * Batch insert events using multi-row INSERT.
   * Suitable for batches up to ~1000 rows. For larger batches, consider COPY protocol.
   */
  async batchInsertEvents(events: Array<{
    project_id: string;
    type: string;
    timestamp: Date;
    payload: object;
  }>): Promise<void> {
    if (events.length === 0) return;

    const client = await this.getConnection({ operation: 'write' });

    try {
      const values = events.map((_, i) =>
        `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`
      ).join(',');

      const params = events.flatMap(e => [
        e.project_id,
        e.type,
        e.timestamp,
        JSON.stringify(e.payload)
      ]);

      await client.query(`
        INSERT INTO events (project_id, type, timestamp, payload)
        VALUES ${values}
      `, params);

      // Insert into specialized tables if needed
      const requests = events.filter(e => e.type === 'request');
      const errors = events.filter(e => e.type === 'error');

      if (requests.length > 0) {
        await this.insertRequests(client, requests);
      }
      if (errors.length > 0) {
        await this.insertErrors(client, errors);
      }

    } finally {
      client.release();
    }
  }

  private async insertRequests(client: PoolClient, requests: any[]) {
    const values = requests.map((r, i) =>
      `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`
    ).join(',');

    const params = requests.flatMap(r => [
      r.project_id,
      r.payload.request_id,
      r.payload.url,
      r.payload.method,
      r.payload.status_code,
      r.timestamp
    ]);

    await client.query(`
      INSERT INTO request_events (project_id, request_id, url, method, status_code, timestamp)
      VALUES ${values}
    `, params);
  }

  private async insertErrors(client: PoolClient, errors: any[]) {
    const crypto = await import('crypto');

    for (const error of errors) {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${error.payload.error_type}:${JSON.stringify(error.payload.stack)}`)
        .digest('hex')
        .slice(0, 16);

      await client.query(`
        INSERT INTO error_events (project_id, request_id, message, error_type, fingerprint, stack, timestamp)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        error.project_id,
        error.payload.request_id,
        error.payload.message,
        error.payload.error_type,
        fingerprint,
        JSON.stringify(error.payload.stack),
        error.timestamp
      ]);
    }
  }

  /**
   * Health check — verifies primary (and optionally replica) connectivity.
   */
  async healthCheck(): Promise<{ healthy: boolean; primary?: Date; replica?: Date }> {
    try {
      const primaryRes = await this.primaryPool.query('SELECT NOW() AS time');
      const result: { healthy: boolean; primary?: Date; replica?: Date } = {
        healthy: true,
        primary: primaryRes.rows[0]?.time,
      };

      if (this.replicaPool) {
        try {
          const replicaRes = await this.replicaPool.query('SELECT NOW() AS time');
          result.replica = replicaRes.rows[0]?.time;
        } catch {
          dbLogger.warn('Replica health check failed — reads will fall back to primary');
        }
      }

      return result;
    } catch {
      dbLogger.error('Log database primary health check failed');
      return { healthy: false };
    }
  }

  /**
   * Returns true if a replica pool is configured and available.
   */
  get hasReplica(): boolean {
    return this.replicaPool !== null;
  }

  /**
   * Graceful shutdown — drains both pools.
   */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    dbLogger.info('Closing log database pools');

    await this.primaryPool.end();
    dbLogger.info('Log DB primary pool closed');

    if (this.replicaPool) {
      await this.replicaPool.end();
      dbLogger.info('Log DB replica pool closed');
    }
  }
}

// Export singleton
export const logDB = new LogDatabaseManager();

// Convenience helpers
export const logQuery = <T extends QueryResultRow = any>(
  sql: string,
  params?: any[],
  options?: Parameters<typeof logDB['queryWithRetry']>[2]
) => logDB.queryWithRetry<T>(sql, params, options);

export const connectLogDB = async () => {
  return logDB.connect();
};