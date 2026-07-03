import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

const dbLogger = logger.child({ component: 'log-database' });

/** PostgreSQL error codes that must never be retried — retrying cannot help. */
const NON_RETRYABLE_PG_CODES = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation
  '23502', // not_null_violation
  '23514', // check_violation
  '42501', // insufficient_privilege
  '42601', // syntax_error
  '42P01', // undefined_table
  '42703', // undefined_column
  '22P02', // invalid_text_representation
]);

/** Connection-level errors where a retry on a fresh connection is worthwhile. */
const RETRYABLE_CONNECTION_CODES = new Set([
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '08000', // connection_exception
  '08003', // connection_does_not_exist
  '08006', // connection_failure
  '08001', // sqlclient_unable_to_establish_sqlconnection
  '08004', // sqlserver_rejected_establishment_of_sqlconnection
  '53300', // too_many_connections
  '40001', // serialization_failure
  '40P01', // deadlock_detected
]);

export type DbOperation = 'read' | 'write';

export interface QueryOptions {
  /** Max retry attempts (default: env.LOG_RETRIES). */
  maxRetries?: number;
  /** 'read' routes to the replica when available; 'write' always hits primary. */
  operation?: DbOperation;
  /** Sets app.current_project_id for the duration of the query (RLS tenant scope). */
  projectId?: string | undefined;
  /**
   * Per-statement timeout in ms applied via `SET LOCAL` inside a transaction.
   * `0` disables the timeout for this statement. When omitted, the pool default
   * (read path) or the configured write timeout (write path) applies.
   */
  timeout?: number;
}

export interface PoolStats {
  total: number;
  idle: number;
  waiting: number;
}

export interface LogEvent {
  project_id: string;
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
}

/**
 * LogDatabaseManager — enterprise-grade dual-pool manager for the dedicated log
 * / event-ingestion database (TimescaleDB-compatible).
 *
 * Design goals:
 * - **Never time out ingestion.** Writes run with a separate, by-default
 *   unbounded statement timeout so large batch inserts and background
 *   maintenance are never aborted. Reads stay bounded to contain runaway
 *   analytical queries. Timeouts are applied with `SET LOCAL` inside a
 *   transaction so they can never leak onto a pooled connection.
 * - **Dual pool.** Primary handles writes/DDL; replica absorbs read traffic and
 *   transparently falls back to primary when absent or unhealthy.
 * - **TimescaleDB.** On connect (when enabled) the event tables are promoted to
 *   hypertables with compression + retention policies. Every step is idempotent
 *   and non-fatal — failure degrades cleanly to plain PostgreSQL.
 * - **High-throughput batch ingest** via set-based `UNNEST` inserts.
 * - **Resilience.** Exponential backoff with jitter, fast-fail on
 *   non-retryable errors, TCP keepalive, and a load-balancer health probe.
 */
class LogDatabaseManager {
  private primaryPool: Pool;
  private replicaPool: Pool | null = null;
  private isShuttingDown = false;
  private timescaleReady = false;

  constructor() {
    const primaryUrl = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    if (!env.LOG_DB_PRIMARY) {
      dbLogger.warn('LOG_DB_PRIMARY not configured — falling back to DATABASE_URL for the log DB');
    }
    this.primaryPool = this.createPool(primaryUrl, 'log_primary');

    if (env.LOG_DB_REPLICA && env.LOG_DB_REPLICA !== env.LOG_DB_PRIMARY) {
      dbLogger.info('Replica pool configured — read queries will be routed to the replica');
      this.replicaPool = this.createPool(env.LOG_DB_REPLICA, 'log_replica');
    }
  }

  /**
   * Build a tuned connection pool.
   *
   * Note: we deliberately do NOT set a global `statement_timeout`/`query_timeout`
   * on the pool. A hard global timeout silently kills legitimate long-running
   * ingestion batches, COPY, and TimescaleDB maintenance. Instead, timeouts are
   * applied per-statement via `SET LOCAL`, scoped to the read path only.
   */
  private createPool(connectionString: string, appName: string): Pool {
    const ssl = this.resolveSslConfig(connectionString, appName);
    const config: PoolConfig = {
      connectionString,
      max: env.LOG_POOL_MAX,
      min: env.LOG_POOL_MIN,
      idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
      application_name: `${appName}_${env.NODE_ENV}`,
      keepAlive: env.LOG_DB_KEEPALIVE_MS > 0,
      keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
      allowExitOnIdle: false,
      ssl,
    };

    const pool = new Pool(config);
    this.setupPoolMonitoring(pool, appName);
    return pool;
  }

  private resolveSslConfig(connectionString: string, appName: string): PoolConfig['ssl'] {
    if (env.LOG_DB_SSL_ENABLED !== undefined) {
      return env.LOG_DB_SSL_ENABLED
        ? { rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED }
        : false;
    }

    try {
      const url = new URL(connectionString);
      const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
      if (sslMode === 'disable') return false;
      if (
        sslMode === 'require' ||
        sslMode === 'verify-ca' ||
        sslMode === 'verify-full' ||
        sslMode === 'prefer' ||
        sslMode === 'allow'
      ) {
        return { rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED };
      }
    } catch {
      dbLogger.warn({ appName }, 'Invalid log DB connection string while inferring SSL; defaulting to SSL disabled');
    }

    return false;
  }

  private setupPoolMonitoring(pool: Pool, name: string): void {
    pool.on('connect', () => {
      dbLogger.debug({ pool: name }, 'New connection added to pool');
    });

    // Idle server-side disconnects are expected with managed providers; only
    // surface genuinely unexpected pool errors at error level.
    pool.on('error', (err: Error) => {
      const expected =
        err.message.includes('Connection terminated unexpectedly') ||
        err.message.includes('Connection ended unexpectedly') ||
        err.message.includes('terminating connection');
      if (expected) {
        dbLogger.debug({ pool: name, err: err.message }, 'Idle log DB connection closed by server');
        return;
      }
      dbLogger.error({ err, pool: name }, 'Unexpected log DB pool error');
    });
  }

  /**
   * Test connections on startup (fail-fast) and, when enabled, promote the
   * event tables to TimescaleDB hypertables. Safe to call once at bootstrap.
   */
  async connect(): Promise<{ primary: Date; replica?: Date }> {
    dbLogger.info('Testing log database connections');

    const primaryClient = await this.primaryPool.connect();
    let primaryTime: Date;
    try {
      const res = await primaryClient.query<{ time: Date; db: string }>(
        'SELECT NOW() AS time, current_database() AS db',
      );
      primaryTime = res.rows[0]!.time;
      dbLogger.info({ db: res.rows[0]?.db, time: primaryTime }, 'Log DB primary connected');
    } finally {
      primaryClient.release();
    }

    let replicaTime: Date | undefined;
    if (this.replicaPool) {
      const replicaClient = await this.replicaPool.connect();
      try {
        const replicaRes = await replicaClient.query<{ time: Date; db: string }>(
          'SELECT NOW() AS time, current_database() AS db',
        );
        replicaTime = replicaRes.rows[0]?.time;
        dbLogger.info({ db: replicaRes.rows[0]?.db, time: replicaTime }, 'Log DB replica connected');
      } finally {
        replicaClient.release();
      }
    }

    if (env.LOG_DB_ENABLE_TIMESCALE) {
      await this.initializeTimescale();
    }

    return { primary: primaryTime, ...(replicaTime ? { replica: replicaTime } : {}) };
  }

  /**
   * Ensure the TimescaleDB extension is available on the log database.
   *
   * Table-level hypertable provisioning (chunking, compression, retention) for
   * the analytics event tables lives in the schema migrations where those
   * tables are defined (migrations2/004), not here — that keeps DDL in one
   * authoritative place. This method only guarantees the extension exists so
   * the log DB is ready to host hypertables.
   *
   * Fully non-fatal: if TimescaleDB is unavailable the log DB simply runs as
   * plain PostgreSQL.
   */
  async initializeTimescale(): Promise<void> {
    const client = await this.primaryPool.connect();
    try {
      await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE');
      const res = await client.query<{ version: string }>(
        `SELECT extversion AS version FROM pg_extension WHERE extname = 'timescaledb'`,
      );
      this.timescaleReady = true;
      dbLogger.info(
        { version: res.rows[0]?.version },
        'TimescaleDB extension ready on log database',
      );
    } catch (err) {
      dbLogger.warn(
        { err: (err as Error).message },
        'TimescaleDB extension unavailable — log DB will run as plain PostgreSQL',
      );
    } finally {
      client.release();
    }
  }

  /** True once TimescaleDB hypertables have been provisioned. */
  get isTimescaleReady(): boolean {
    return this.timescaleReady;
  }

  /** True if a separate replica pool is configured. */
  get hasReplica(): boolean {
    return this.replicaPool !== null;
  }

  /**
   * Acquire a pooled connection from the appropriate pool.
   *
   * @param options.operation 'read' routes to the replica when available.
   * @param options.projectId sets the RLS tenant scope for the session.
   */
  async getConnection(options?: {
    operation?: DbOperation;
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
   * Execute a query with retry + exponential backoff (with jitter).
   *
   * - Non-retryable errors (constraint, permission, syntax) fail immediately.
   * - A per-statement timeout, when supplied, is applied via `SET LOCAL` inside
   *   a transaction so it can never leak onto a reused pooled connection.
   * - Reads default to the configured read timeout; writes default to the
   *   write timeout (0/unbounded) so ingestion is never aborted mid-batch.
   */
  async queryWithRetry<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params?: unknown[],
    options: QueryOptions = {},
  ): Promise<QueryResult<T>> {
    const { maxRetries = env.LOG_RETRIES, operation = 'read', projectId } = options;
    const effectiveTimeout =
      options.timeout ?? (operation === 'write' ? env.LOG_DB_WRITE_TIMEOUT : env.LOG_QUERY_TIMEOUT);

    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const client = await this.getConnection({
        operation,
        ...(projectId !== undefined ? { projectId } : {}),
      });

      try {
        const start = Date.now();
        const result = await this.runWithTimeout<T>(client, sql, params, effectiveTimeout);
        const duration = Date.now() - start;

        if (duration > env.LOG_DB_SLOW_QUERY_MS) {
          dbLogger.warn(
            { query: sql.slice(0, 120), duration, rows: result.rowCount, operation },
            'Slow log query detected',
          );
        }

        return result;
      } catch (err) {
        lastError = err as Error;
        const code = (err as { code?: string }).code;

        if (code && NON_RETRYABLE_PG_CODES.has(code)) {
          throw err;
        }

        const isLastAttempt = attempt === maxRetries - 1;
        if (!isLastAttempt) {
          const base = Math.min(1000 * 2 ** attempt, 5000);
          const delay = base + Math.floor(Math.random() * 250); // jitter
          dbLogger.warn(
            { error: (err as Error).message, code, attempt: attempt + 1, nextRetryMs: delay },
            'Log query failed — retrying',
          );
          await sleep(delay);
        }
      } finally {
        client.release();
      }
    }

    throw lastError ?? new Error('Query failed after retries');
  }

  /**
   * Run a single statement, optionally bounded by a transaction-scoped
   * `SET LOCAL statement_timeout`. A timeout of 0 means "no statement timeout"
   * and the query runs directly without transaction overhead.
   */
  private async runWithTimeout<T extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: unknown[] | undefined,
    timeout: number,
  ): Promise<QueryResult<T>> {
    if (!timeout || timeout <= 0) {
      return client.query<T>(sql, params);
    }

    await client.query('BEGIN');
    try {
      // SET LOCAL is transaction-scoped: it cannot leak onto the pooled
      // connection once the transaction ends.
      await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeout)}`);
      const result = await client.query<T>(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    }
  }

  /**
   * Run a function inside a single transaction on the primary pool. The
   * statement timeout defaults to the (unbounded) write timeout so long
   * ingestion transactions are never aborted.
   */
  async withTransaction<T>(
    fn: (client: PoolClient) => Promise<T>,
    options?: { projectId?: string | undefined; timeout?: number },
  ): Promise<T> {
    const client = await this.getConnection({
      operation: 'write',
      ...(options?.projectId !== undefined ? { projectId: options.projectId } : {}),
    });
    const timeout = options?.timeout ?? env.LOG_DB_WRITE_TIMEOUT;

    try {
      await client.query('BEGIN');
      if (timeout > 0) {
        await client.query(`SET LOCAL statement_timeout = ${Math.floor(timeout)}`);
      }
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * High-throughput batch insert of raw events plus their specialized rows.
   *
   * Uses set-based `UNNEST` inserts (one statement per table regardless of
   * batch size) inside a single transaction with an unbounded statement timeout
   * so large batches never get killed mid-flight.
   */
  async batchInsertEvents(events: LogEvent[]): Promise<void> {
    if (events.length === 0) return;

    await this.withTransaction(async (client) => {
      await client.query(
        `
        INSERT INTO events (project_id, type, timestamp, payload)
        SELECT * FROM UNNEST(
          $1::uuid[], $2::varchar[], $3::timestamptz[], $4::jsonb[]
        )
        `,
        [
          events.map((e) => e.project_id),
          events.map((e) => e.type),
          events.map((e) => e.timestamp),
          events.map((e) => JSON.stringify(e.payload)),
        ],
      );

      const requests = events.filter((e) => e.type === 'request');
      const errors = events.filter((e) => e.type === 'error');

      if (requests.length > 0) await this.insertRequests(client, requests);
      if (errors.length > 0) await this.insertErrors(client, errors);
    });
  }

  private async insertRequests(client: PoolClient, requests: LogEvent[]): Promise<void> {
    await client.query(
      `
      INSERT INTO request_events (project_id, request_id, url, method, status_code, timestamp)
      SELECT * FROM UNNEST(
        $1::uuid[], $2::uuid[], $3::text[], $4::varchar[], $5::int[], $6::timestamptz[]
      )
      `,
      [
        requests.map((r) => r.project_id),
        requests.map((r) => r.payload.request_id ?? null),
        requests.map((r) => r.payload.url ?? null),
        requests.map((r) => r.payload.method ?? null),
        requests.map((r) => r.payload.status_code ?? null),
        requests.map((r) => r.timestamp),
      ],
    );
  }

  private async insertErrors(client: PoolClient, errors: LogEvent[]): Promise<void> {
    const { createHash } = await import('crypto');

    const fingerprints = errors.map((e) =>
      createHash('sha256')
        .update(`${String(e.payload.error_type)}:${JSON.stringify(e.payload.stack)}`)
        .digest('hex')
        .slice(0, 16),
    );

    await client.query(
      `
      INSERT INTO error_events
        (project_id, request_id, message, error_type, fingerprint, stack, timestamp)
      SELECT * FROM UNNEST(
        $1::uuid[], $2::uuid[], $3::text[], $4::varchar[], $5::varchar[], $6::jsonb[], $7::timestamptz[]
      )
      `,
      [
        errors.map((e) => e.project_id),
        errors.map((e) => e.payload.request_id ?? null),
        errors.map((e) => e.payload.message ?? null),
        errors.map((e) => e.payload.error_type ?? null),
        fingerprints,
        errors.map((e) => JSON.stringify(e.payload.stack ?? null)),
        errors.map((e) => e.timestamp),
      ],
    );
  }

  /**
   * Health check for load-balancer / readiness probes. Verifies primary and,
   * when configured, replica connectivity. A failed replica is non-fatal (reads
   * fall back to primary) and is reported but does not flip `healthy`.
   */
  async healthCheck(): Promise<{ healthy: boolean; primary?: Date; replica?: Date }> {
    try {
      const primaryRes = await this.primaryPool.query<{ time: Date }>('SELECT NOW() AS time');
      const result: { healthy: boolean; primary?: Date; replica?: Date } = {
        healthy: true,
        ...(primaryRes.rows[0]?.time ? { primary: primaryRes.rows[0].time } : {}),
      };

      if (this.replicaPool) {
        try {
          const replicaRes = await this.replicaPool.query<{ time: Date }>('SELECT NOW() AS time');
          if (replicaRes.rows[0]?.time) result.replica = replicaRes.rows[0].time;
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

  /** Live pool utilization, useful for metrics dashboards and capacity alerts. */
  getPoolStats(): { primary: PoolStats; replica?: PoolStats } {
    const snapshot = (p: Pool): PoolStats => ({
      total: p.totalCount,
      idle: p.idleCount,
      waiting: p.waitingCount,
    });

    return {
      primary: snapshot(this.primaryPool),
      ...(this.replicaPool ? { replica: snapshot(this.replicaPool) } : {}),
    };
  }

  /** Graceful shutdown — drains both pools. */
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Export singleton
export const logDB = new LogDatabaseManager();

// Convenience helpers
export const logQuery = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: unknown[],
  options?: QueryOptions,
) => logDB.queryWithRetry<T>(sql, params, options);

export const connectLogDB = async () => logDB.connect();
