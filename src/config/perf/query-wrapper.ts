/**
 * Instrumented Database Query Layer.
 *
 * All database operations across Control-Plane (PrimaryDB) and Telemetry (LogDB/TimescaleDB)
 * go through this layer to provide:
 * 1. Required stable query names (compile-time type safety via DbQueryName).
 * 2. Distinct measurement of connection pool wait time vs. query execution time.
 * 3. AsyncLocalStorage integration for request tracing and N+1 detection.
 * 4. PII-safe slow query logging with rate limiting.
 * 5. Complete metrics fail-safety: query execution is NEVER broken if metrics fail.
 */

import { performance } from 'node:perf_hooks';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { pool as defaultControlPool } from '../database.js';
import { logDB } from '../log-database.js';
import { logger } from '../logger.js';
import { type DbQueryName } from './query-names.js';
import { getActivePerfContext, recordContextQuery } from './context.js';
import {
  dbPoolWaitHistogram,
  dbQueryDurationHistogram,
  ingestBatchDurationHistogram,
  ingestBatchRowsCounter,
} from './metrics.js';
import { maybeLogSlowQuery } from './slow-query.js';

const perfLogger = logger.child({ component: 'query-wrapper' });

export type DatabaseTarget = 'control' | 'telemetry';

export interface MeasuredQueryOptions {
  db?: DatabaseTarget;
  pool?: Pool;
  client?: PoolClient;
  timeout?: number;
  operation?: 'read' | 'write';
  projectId?: string;
  caller?: string;
  customThresholdMs?: number;
}

export interface MeasuredTransactionClient {
  readonly rawClient: PoolClient;
  query<T extends QueryResultRow = any>(
    name: DbQueryName,
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
  getStats(): {
    statementCount: number;
    totalStatementTimeMs: number;
  };
}

/**
 * Executes an instrumented single query with pool wait time and statement duration separation.
 */
export async function measuredQuery<T extends QueryResultRow = any>(
  name: DbQueryName,
  sql: string,
  params?: unknown[],
  options?: MeasuredQueryOptions,
): Promise<QueryResult<T>> {
  const db: DatabaseTarget =
    options?.db ?? (options?.operation ? 'telemetry' : 'control');
  const context = getActivePerfContext();
  let client: PoolClient | undefined = options?.client;
  let clientWasAcquired = false;
  let poolWaitMs = 0;

  // 1. Connection Acquisition (if not already inside a transaction)
  if (!client) {
    const acquireStart = performance.now();
    try {
      if (options?.pool) {
        client = await options.pool.connect();
      } else if (db === 'telemetry') {
        client = await logDB.getConnection(options?.operation ? { operation: options.operation } : undefined);
      } else {
        client = await defaultControlPool.connect();
      }
      clientWasAcquired = true;
      poolWaitMs = performance.now() - acquireStart;

      // Record pool wait duration metric
      try {
        dbPoolWaitHistogram.observe({ db }, poolWaitMs / 1000);
      } catch (metricErr) {
        perfLogger.debug({ err: metricErr }, 'Failed to record pool wait metric');
      }
    } catch (acquireErr) {
      perfLogger.error(
        { db, queryName: name, err: (acquireErr as Error).message },
        'Failed to acquire database connection from pool',
      );
      throw acquireErr;
    }
  }

  // 2. Query Execution
  const execStart = performance.now();
  let execDurationMs = 0;
  let queryResult: QueryResult<T> | undefined;
  let queryError: unknown;

  try {
    // If telemetry and options specified (timeout or tenant scope), use transaction-safe settings
    if (db === 'telemetry' && (options?.timeout || options?.projectId)) {
      queryResult = await executeTelemetryQueryWithSettings<T>(
        client,
        sql,
        params,
        options.timeout,
        options.projectId,
      );
    } else {
      queryResult = await client.query<T>(sql, params);
    }
    execDurationMs = performance.now() - execStart;
    return queryResult;
  } catch (err) {
    execDurationMs = performance.now() - execStart;
    queryError = err;
    throw err;
  } finally {
    // 3. Post-execution telemetry & metrics (fail-safe)
    try {
      const execDurationSec = execDurationMs / 1000;
      const status = queryError ? 'error' : 'ok';
      dbQueryDurationHistogram.observe({ db, query: name, status }, execDurationSec);

      // Record in AsyncLocalStorage request context
      recordContextQuery(name, execDurationMs, poolWaitMs);

      // PII-safe slow query logging
      maybeLogSlowQuery(
        db,
        name,
        execDurationMs,
        queryResult?.rowCount ?? 0,
        params,
        context,
        options?.customThresholdMs,
      );
    } catch (telemetryErr) {
      perfLogger.debug(
        { err: telemetryErr },
        'Safe suppression of telemetry recording error in measuredQuery',
      );
    }

    // 4. Release checked-out client if this invocation acquired it
    if (clientWasAcquired && client) {
      try {
        if (queryError && isSocketPoisoned(queryError)) {
          client.release(queryError as Error);
        } else {
          client.release();
        }
      } catch (releaseErr) {
        perfLogger.warn({ err: releaseErr }, 'Error releasing database client back to pool');
      }
    }
  }
}

/**
 * Wraps a transaction with timing instrumentation:
 * - Records connection acquisition time.
 * - Records time holding the connection vs time spent actively executing queries.
 * - Safely rolls back on error.
 */
export async function withMeasuredTransaction<T>(
  name: DbQueryName,
  fn: (tx: MeasuredTransactionClient) => Promise<T>,
  options?: {
    db?: DatabaseTarget;
    pool?: Pool;
    timeout?: number;
    projectId?: string;
  },
): Promise<T> {
  const db: DatabaseTarget = options?.db ?? 'control';
  const acquireStart = performance.now();
  let client: PoolClient;

  if (options?.pool) {
    client = await options.pool.connect();
  } else if (db === 'telemetry') {
    client = await logDB.getConnection({ operation: 'write' });
  } else {
    client = await defaultControlPool.connect();
  }

  const poolWaitMs = performance.now() - acquireStart;
  try {
    dbPoolWaitHistogram.observe({ db }, poolWaitMs / 1000);
  } catch {}

  const txStart = performance.now();
  let statementCount = 0;
  let totalStatementTimeMs = 0;
  let txError: unknown;

  const txClient: MeasuredTransactionClient = {
    rawClient: client,
    async query<R extends QueryResultRow = any>(
      queryName: DbQueryName,
      sql: string,
      params?: unknown[],
    ): Promise<QueryResult<R>> {
      statementCount += 1;
      const res = await measuredQuery<R>(queryName, sql, params, {
        db,
        client,
      });
      return res;
    },
    getStats() {
      return { statementCount, totalStatementTimeMs };
    },
  };

  try {
    await client.query('BEGIN');

    if (options?.projectId) {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_project_id',
        options.projectId,
      ]);
    }
    if (options?.timeout && options.timeout > 0) {
      await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
        String(Math.floor(options.timeout)),
      ]);
    }

    const result = await fn(txClient);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    txError = err;
    try {
      await client.query('ROLLBACK');
    } catch (rbErr) {
      perfLogger.debug({ err: rbErr }, 'Failed to rollback transaction');
    }
    throw err;
  } finally {
    const totalTxDurationMs = performance.now() - txStart;
    try {
      const status = txError ? 'error' : 'ok';
      dbQueryDurationHistogram.observe(
        { db, query: name, status },
        totalTxDurationMs / 1000,
      );

      // Slow transaction check
      const context = getActivePerfContext();
      maybeLogSlowQuery(
        db,
        name,
        totalTxDurationMs,
        statementCount,
        undefined,
        context,
        options?.timeout ? options.timeout * 0.8 : undefined,
      );
    } catch {}

    if (client) {
      if (txError && isSocketPoisoned(txError)) {
        client.release(txError as Error);
      } else {
        client.release();
      }
    }
  }
}

/**
 * Ingestion batch performance measurement helper.
 * Tracks batch execution duration and row count while avoiding high-frequency per-row metrics.
 */
export async function measuredIngestBatch<T>(
  source: 'logs' | 'spans' | 'metrics' | 'errors',
  rowCount: number,
  fn: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  let status: 'ok' | 'error' = 'ok';
  try {
    const result = await fn();
    return result;
  } catch (err) {
    status = 'error';
    throw err;
  } finally {
    const durationSec = (performance.now() - start) / 1000;
    try {
      ingestBatchDurationHistogram.observe({ source, status }, durationSec);
      if (status === 'ok' && rowCount > 0) {
        ingestBatchRowsCounter.inc({ source }, rowCount);
      }
    } catch (metricErr) {
      perfLogger.debug({ err: metricErr }, 'Failed to record ingest batch metric');
    }
  }
}

async function executeTelemetryQueryWithSettings<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] | undefined,
  timeout?: number,
  projectId?: string,
): Promise<QueryResult<T>> {
  const hasBoundedTimeout = typeof timeout === 'number' && timeout > 0;
  const needsTenantScope = typeof projectId === 'string' && projectId.length > 0;

  if (!hasBoundedTimeout && !needsTenantScope) {
    return client.query<T>(sql, params);
  }

  await client.query('BEGIN');
  try {
    if (needsTenantScope && hasBoundedTimeout) {
      await client.query(
        `SELECT set_config('app.current_project_id', $1, true), set_config('statement_timeout', $2, true)`,
        [projectId, String(Math.floor(timeout!))],
      );
    } else if (needsTenantScope) {
      await client.query('SELECT set_config($1, $2, true)', [
        'app.current_project_id',
        projectId,
      ]);
    } else if (hasBoundedTimeout) {
      await client.query(`SELECT set_config('statement_timeout', $1, true)`, [
        String(Math.floor(timeout!)),
      ]);
    }

    const result = await client.query<T>(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  }
}

function isSocketPoisoned(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const code = (err as { code?: string }).code;
  const msg = String((err as { message?: string }).message ?? '').toLowerCase();
  return (
    code === '57014' ||
    msg.includes('statement timeout') ||
    msg.includes('query read timeout') ||
    ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE'].includes(code ?? '')
  );
}
