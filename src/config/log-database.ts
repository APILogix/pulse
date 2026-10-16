import './dns.js';
import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';
import {
  checkPostgresHealth,
  getSafePostgresConnectionMetadata,
  withPostgresAddressFamily,
  type PostgresHealthFailure,
} from './postgres-network.js';
import {
  isExpectedServerlessDisconnect,
  resolvePostgresSslConfig,
  sanitizePostgresConnectionString,
} from './postgres-ssl.js';

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
  '22003', // numeric_value_out_of_range
  '22012', // division_by_zero
  '57014', // query_canceled (statement_timeout) — NEVER retry timed-out queries!
  '53200', // out_of_memory
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

function isTimeoutError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const msg = String((err as { message?: string }).message ?? '').toLowerCase();
  return (
    code === '57014' ||
    msg.includes('query read timeout') ||
    msg.includes('statement timeout') ||
    msg.includes('canceling statement due to statement timeout')
  );
}

function isRetryableLogDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  if (isTimeoutError(err)) return false;

  const code = (err as { code?: string }).code;
  if (code) {
    if (NON_RETRYABLE_PG_CODES.has(code)) return false;
    if (RETRYABLE_CONNECTION_CODES.has(code)) return true;
  }

  return (
    isExpectedServerlessDisconnect(err as Error) ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code ?? '')
  );
}

export type DbOperation = 'read' | 'write';

export interface QueryOptions {
  /** Max retry attempts (default: env.LOG_RETRIES). */
  maxRetries?: number;
  /** 'read' routes to the replica when available; 'write' always hits primary. */
  operation?: DbOperation;
  /**
   * RLS tenant scope. Sets `app.current_project_id` for the duration of the
   * TRANSACTION wrapping this query, then reverts automatically. Supplying it
   * forces the query into a transaction even when no timeout is set, so the
   * scope can never be silently dropped.
   */
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
 * - **No session state on pooled connections.** Every per-request setting
 *   (statement timeout, RLS tenant scope) is transaction-scoped. Nothing is
 *   applied at checkout time, so a connection returned to the pool carries no
 *   residue from its previous borrower. See `applyTenantScope()`.
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
  private replicaHealthy = false;
  private replicaUnhealthyUntil = 0;
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
      this.replicaHealthy = true;
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
    const config: PoolConfig = withPostgresAddressFamily({
      connectionString: sanitizePostgresConnectionString(connectionString),
      max: env.LOG_POOL_MAX,
      min: env.LOG_POOL_MIN,
      idleTimeoutMillis: env.LOG_DB_IDLE_TIMEOUT,
      connectionTimeoutMillis: env.LOG_DB_CONNECTION_TIMEOUT,
      application_name: `${appName}_${env.NODE_ENV}`,
      keepAlive: env.LOG_DB_KEEPALIVE_MS > 0,
      keepAliveInitialDelayMillis: env.LOG_DB_KEEPALIVE_MS,
      allowExitOnIdle: false,
      ssl,
    }, env.DB_FAMILY);

    dbLogger.info(
      {
        pool: appName,
        ...getSafePostgresConnectionMetadata(connectionString, {
          family: env.DB_FAMILY,
          ssl,
          poolMax: env.LOG_POOL_MAX,
          poolMin: env.LOG_POOL_MIN,
        }),
      },
      'Log PostgreSQL configuration',
    );

    const pool = new Pool(config);
    this.setupPoolMonitoring(pool, appName);
    return pool;
  }

  private resolveSslConfig(connectionString: string, appName: string): PoolConfig['ssl'] {
    const ssl = resolvePostgresSslConfig(connectionString, {
      enabled: env.LOG_DB_SSL_ENABLED,
      rejectUnauthorized: env.LOG_DB_SSL_REJECT_UNAUTHORIZED,
    });
    if (ssl === false) {
      dbLogger.debug({ appName }, 'Log DB SSL disabled');
    }
    return ssl;
  }

  private setupPoolMonitoring(pool: Pool, name: string): void {
    pool.on('connect', (client: PoolClient) => {
      dbLogger.debug({ pool: name }, 'New connection added to pool');
      client.on('error', (err: Error) => {
        if (isExpectedServerlessDisconnect(err)) {
          dbLogger.debug(
            { pool: name, err: err.message },
            'Client log DB connection closed by server (Neon/PgBouncer)',
          );
          return;
        }
        dbLogger.debug(
          { pool: name, err: err.message },
          'PostgreSQL client socket error on active/checked-out log DB connection',
        );
      });
    });

    // Idle server-side disconnects are expected with managed providers; only
    // surface genuinely unexpected pool errors at error level.
    pool.on('error', (err: Error) => {
      if (isExpectedServerlessDisconnect(err)) {
        dbLogger.debug({ pool: name, err: err.message }, 'Idle log DB connection closed by server (Neon/PgBouncer)');
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

    const primaryClient = await this.connectStartupPool(this.primaryPool, 'LOG_DB_PRIMARY');
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
      try {
        const replicaClient = await this.connectStartupPool(this.replicaPool, 'LOG_DB_REPLICA');
        try {
          const replicaRes = await replicaClient.query<{ time: Date; db: string }>(
            'SELECT NOW() AS time, current_database() AS db',
          );
          replicaTime = replicaRes.rows[0]?.time;
          this.replicaHealthy = true;
          dbLogger.info({ db: replicaRes.rows[0]?.db, time: replicaTime }, 'Log DB replica connected');
        } finally {
          replicaClient.release();
        }
      } catch (error) {
        this.replicaHealthy = false;
        dbLogger.warn(
          { err: error instanceof Error ? error.message : String(error) },
          'Log DB replica unavailable at startup — reads will use primary',
        );
      }
    }

    if (env.LOG_DB_ENABLE_TIMESCALE) {
      await this.initializeTimescale();
    }

    return { primary: primaryTime, ...(replicaTime ? { replica: replicaTime } : {}) };
  }

  /** Preserve the connection failure while explaining IPv6-only endpoint configuration. */
  private async connectStartupPool(pool: Pool, setting: 'LOG_DB_PRIMARY' | 'LOG_DB_REPLICA'): Promise<PoolClient> {
    try {
      return await pool.connect();
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { address?: string };
      const connectionString = env[setting] ?? env.DATABASE_URL;
      let host = '';
      try { host = new URL(connectionString).hostname; } catch {}
      if (
        ['ETIMEDOUT', 'ENETUNREACH', 'EHOSTUNREACH'].includes(failure.code ?? '') &&
        failure.address?.includes(':') &&
        /^db\.[a-z0-9]+\.supabase\.co$/i.test(host)
      ) {
        throw new Error(
          `${setting} cannot reach the Supabase direct endpoint over IPv6. ` +
          'Use the same project\'s Session pooler connection string from Supabase Connect ' +
          '(port 5432, including its pooler username), or restore IPv6 connectivity. ' +
          'DNS ipv4first cannot provide IPv4 for an IPv6-only endpoint.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Ensure the TimescaleDB extension is available on the log database.
   * Hypertable provisioning lives in migrations2/004. Extension failures are
   * non-fatal: the log database continues using plain PostgreSQL.
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
   *
   * NOTE: this deliberately does not accept a `projectId`. Tenant scope is a
   * transaction-scoped concern and is applied by `applyTenantScope()` from
   * inside a transaction — see that method for the reasoning. An option here
   * that *looked* like it set tenant scope but could not do so safely is worse
   * than no option at all, because it fails open.
   */
  async getConnection(options?: { operation?: DbOperation }): Promise<PoolClient> {
    if (this.isShuttingDown) {
      throw new Error('Log database is shutting down — refusing new connections');
    }

    // Auto-recover replica after 15s cooldown if it was marked unhealthy by a transient drop
    if (!this.replicaHealthy && this.replicaPool && Date.now() >= this.replicaUnhealthyUntil) {
      this.replicaHealthy = true;
    }

    const useReplica = options?.operation === 'read' && this.replicaPool !== null && this.replicaHealthy;
    const pool = useReplica ? this.replicaPool! : this.primaryPool;
    return pool.connect();
  }

  /**
   * Apply the RLS tenant scope (`app.current_project_id`) for the CURRENT
   * TRANSACTION only.
   *
   * ## Why this exists (a real defect, not a style preference)
   *
   * This previously ran in `getConnection()` as:
   *
   *     SET app.current_project_id = $1
   *
   * before any `BEGIN`. A bare `SET` is **session**-scoped, so the value
   * survived `COMMIT`, survived `client.release()`, and stayed attached to the
   * connection sitting in the `pg` pool. The next caller to borrow that
   * connection silently inherited the previous tenant's project id. Nothing
   * ever reset it.
   *
   * That is a cross-tenant state leak in a multi-tenant system. It is currently
   * NOT exploitable — a repo-wide search of `database/migrations/**` found no
   * `CREATE POLICY`, no `ENABLE ROW LEVEL SECURITY`, and no `current_setting`
   * reader, so no query consumes this GUC on the Log DB today. It is a loaded
   * gun rather than a fired one: the moment anyone adds an RLS policy (which is
   * exactly what this setting exists to feed) the leak becomes a tenant
   * data-disclosure bug, and it would be invisible in testing because it only
   * manifests on connection reuse under concurrency.
   *
   * ## Why `set_config(..., true)` rather than `SET LOCAL`
   *
   * `is_local = true` makes the setting transaction-scoped: PostgreSQL reverts
   * it automatically at COMMIT or ROLLBACK, so it is leak-proof *by
   * construction* rather than by remembering to reset it. `set_config()` is also
   * a function call, so the value binds as a real parameter — `SET LOCAL` only
   * accepts a literal, which would have forced string interpolation of a
   * caller-supplied value into SQL.
   *
   * This matches the pattern already used correctly elsewhere in the codebase
   * (`src/modules/analytics/repository.ts`).
   *
   * ## Caller contract — IMPORTANT
   *
   * MUST be called inside an open transaction. Outside one, `is_local = true`
   * applies to the implicit single-statement transaction and is discarded
   * immediately, i.e. it becomes a silent no-op that **fails open** on tenant
   * scoping. It is private for that reason: every call site in this class
   * issues `BEGIN` first, and that invariant is enforced structurally rather
   * than by a runtime probe (which would cost an extra round trip per query on
   * the hot read path).
   */
  private async applyTenantScope(client: PoolClient, projectId: string): Promise<void> {
    await client.query('SELECT set_config($1, $2, true)', ['app.current_project_id', projectId]);
  }

  /**
   * Execute a query with retry + exponential backoff (with jitter).
   *
   * - Non-retryable errors (constraint, permission, syntax) fail immediately.
   * - Statement timeouts are never retried, preventing runaway zombie query storms on LogDB.
   * - A per-statement timeout, when supplied, is applied via `set_config('statement_timeout', ..., true)`
   *   inside a transaction so it can never leak onto a reused pooled connection and PostgreSQL
   *   engine cancels the query if exceeded.
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
      const useReplica = operation === 'read' && this.replicaPool !== null && this.replicaHealthy;
      let client: PoolClient | null = null;
      let destroyClientOnRelease = false;

      try {
        client = await this.getConnection({ operation });
        const start = Date.now();
        // projectId is threaded into runWithTimeout rather than applied at
        // checkout, so the tenant scope lives inside the same transaction as the
        // statement it scopes.
        const result = await this.runWithTimeout<T>(
          client,
          sql,
          params,
          effectiveTimeout,
          projectId,
          () => {
            destroyClientOnRelease = true;
          },
        );
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

        // Never retry timed-out queries (prevents 3x zombie query storms on LogDB)
        if (isTimeoutError(err)) {
          destroyClientOnRelease = true;
          throw err;
        }

        // Only trip replica circuit breaker on genuine connection failures, with 15s auto-recovery
        if (useReplica && isRetryableLogDbError(err)) {
          this.replicaHealthy = false;
          this.replicaUnhealthyUntil = Date.now() + 15_000;
          destroyClientOnRelease = true;
          dbLogger.warn(
            { error: (err as Error).message, code },
            'Log DB replica connection failed — falling back to primary for 15s',
          );
          continue;
        }

        if (!isRetryableLogDbError(err)) {
          throw err;
        }

        destroyClientOnRelease = true;
        const isLastAttempt = attempt === maxRetries - 1;
        if (!isLastAttempt) {
          const base = Math.min(1000 * 2 ** attempt, 5000);
          const delay = base + Math.floor(Math.random() * 250); // jitter
          dbLogger.warn(
            { error: (err as Error).message, code, attempt: attempt + 1, nextRetryMs: delay },
            'Transient log query error — retrying',
          );
          await sleep(delay);
        }
      } finally {
        client?.release(destroyClientOnRelease);
      }
    }

    throw lastError ?? new Error('Query failed after retries');
  }

  /**
   * Run a single statement, optionally bounded by a transaction-scoped
   * `set_config('statement_timeout', ..., true)` and/or an RLS tenant scope.
   *
   * A transaction is opened when EITHER a bounded timeout OR a tenant scope is
   * required, because both mechanisms are transaction-scoped. The no-transaction
   * fast path is only taken when neither is needed.
   *
   * Requesting a tenant scope therefore forces a transaction even when the
   * timeout is 0/unbounded. That is deliberate: applying the scope outside a
   * transaction would silently discard it and leave the statement unscoped,
   * which fails open. Correctness wins over saving a round trip.
   */
  private async runWithTimeout<T extends QueryResultRow>(
    client: PoolClient,
    sql: string,
    params: unknown[] | undefined,
    timeout: number,
    projectId?: string | undefined,
    markClientPoisoned?: () => void,
  ): Promise<QueryResult<T>> {
    const hasBoundedTimeout = typeof timeout === 'number' && timeout > 0;
    const needsTenantScope = typeof projectId === 'string' && projectId.length > 0;

    // Fast path when neither timeout nor tenant scope is needed (e.g. unbounded writes)
    if (!needsTenantScope && !hasBoundedTimeout) {
      return client.query<T>(sql, params);
    }

    // Use a real PostgreSQL transaction with server-side `set_config('statement_timeout', ..., true)`
    // so PostgreSQL itself cancels runaway queries at the engine level instead of leaving zombie
    // queries running after a client-side `query_timeout` timer.
    await client.query('BEGIN');
    try {
      if (needsTenantScope && hasBoundedTimeout) {
        await client.query(
          `SELECT set_config('app.current_project_id', $1, true), set_config('statement_timeout', $2, true)`,
          [projectId, String(Math.floor(timeout))],
        );
      } else if (needsTenantScope) {
        await this.applyTenantScope(client, projectId);
      } else if (hasBoundedTimeout) {
        await client.query(
          `SELECT set_config('statement_timeout', $1, true)`,
          [String(Math.floor(timeout))],
        );
      }

      const result = await client.query<T>(sql, params);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        markClientPoisoned?.();
      });
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
    const client = await this.getConnection({ operation: 'write' });
    const timeout = options?.timeout ?? env.LOG_DB_WRITE_TIMEOUT;
    const projectId = options?.projectId;
    let destroyClientOnRelease = false;

    try {
      await client.query('BEGIN');
      const hasProject = typeof projectId === 'string' && projectId.length > 0;
      const hasTimeout = timeout > 0;

      if (hasProject && hasTimeout) {
        await client.query(
          `SELECT set_config('app.current_project_id', $1, true), set_config('statement_timeout', $2, true)`,
          [projectId, String(Math.floor(timeout))],
        );
      } else if (hasProject) {
        await this.applyTenantScope(client, projectId);
      } else if (hasTimeout) {
        await client.query(`SELECT set_config('statement_timeout', $1, true)`, [String(Math.floor(timeout))]);
      }

      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      if (isTimeoutError(err)) {
        destroyClientOnRelease = true;
      }
      await client.query('ROLLBACK').catch(() => {
        destroyClientOnRelease = true;
      });
      throw err;
    } finally {
      client.release(destroyClientOnRelease);
    }
  }



  /**
   * Health check for load-balancer / readiness probes. Verifies primary and,
   * when configured, replica connectivity. A failed replica is non-fatal (reads
   * fall back to primary) and is reported but does not flip `healthy`.
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    primary?: Date;
    replica?: Date;
    failure?: PostgresHealthFailure;
  }> {
    const primaryHealth = await checkPostgresHealth(this.primaryPool);
    if (!primaryHealth.healthy) {
      dbLogger.error(
        { failure: primaryHealth.failure },
        'Log database primary health check failed',
      );
      return { healthy: false, failure: primaryHealth.failure };
    }

    const result: { healthy: boolean; primary?: Date; replica?: Date } = {
      healthy: true,
      primary: new Date(),
    };

    if (this.replicaPool) {
      const replicaHealth = await checkPostgresHealth(this.replicaPool);
      if (replicaHealth.healthy) {
        this.replicaHealthy = true;
        result.replica = new Date();
      } else {
        this.replicaHealthy = false;
        dbLogger.warn(
          { failure: replicaHealth.failure },
          'Replica health check failed — reads will fall back to primary',
        );
      }
    }

    return result;
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

  /**
   * Standard pg Pool used by typed telemetry persistence and analytics SQL.
   * Control-plane repositories must continue using config/database.ts.
   */
  getPrimaryPool(): Pool {
    return this.primaryPool;
  }

  /** Graceful shutdown — drains both pools. */
  async close(): Promise<void> {
    this.isShuttingDown = true;
    dbLogger.info('Closing log database pools');

    const closes: Promise<void>[] = [
      this.primaryPool.end().then(() => dbLogger.info('Log DB primary pool closed')),
    ];
    if (this.replicaPool) {
      closes.push(this.replicaPool.end().then(() => dbLogger.info('Log DB replica pool closed')));
    }
    const results = await Promise.allSettled(closes);
    const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failure) throw failure.reason;
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
