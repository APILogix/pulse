/**
 * Enterprise-Grade TimescaleDB Log Database Manager
 * 
 * Enhancements over original log-database.ts:
 * 1. TimescaleDB hypertable auto-creation with compression
 * 2. Continuous aggregates for performance
 * 3. Automated retention policies
 * 4. Connection pooling with circuit breaker
 * 5. Query performance monitoring
 * 6. Automatic failover to replica
 * 7. Statement timeout management (never timeout ingestion)
 * 8. Distributed tracing integration
 * 9. Metrics collection
 * 10. Health check with degraded state
 */

import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg';
import { env } from './env.js';
import { logger } from './logger.js';

const dbLogger = logger.child({ component: 'log-database-enterprise' });

/** PostgreSQL error codes that must never be retried */
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

/** Connection-level errors where retry is worthwhile */
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
  maxRetries?: number;
  operation?: DbOperation;
  projectId?: string | undefined;
  timeout?: number;
  traceId?: string;
  spanId?: string;
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

export interface HealthStatus {
  healthy: boolean;
  degraded: boolean;
  primary?: Date;
  replica?: Date;
  timescaleVersion?: string;
  extensions?: string[];
  errors?: string[];
}

/** Circuit breaker states */
enum CircuitState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}

/**
 * Circuit Breaker for database connections
 * Prevents cascading failures by opening circuit after threshold failures
 */
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;

  constructor(
    private readonly threshold = 5,
    private readonly timeout = 60000, // 60s
    private readonly halfOpenSuccessThreshold = 2,
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        this.state = CircuitState.HALF_OPEN;
        this.successCount = 0;
        dbLogger.info('Circuit breaker entering HALF_OPEN state');
      } else {
        throw new Error('Circuit breaker is OPEN - refusing request');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    if (this.state === CircuitState.HALF_OPEN) {
      this.successCount++;
      if (this.successCount >= this.halfOpenSuccessThreshold) {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        dbLogger.info('Circuit breaker entering CLOSED state');
      }
    } else {
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.threshold) {
      this.state = CircuitState.OPEN;
      dbLogger.error({ failureCount: this.failureCount }, 'Circuit breaker OPEN');
    }
  }

  getState(): CircuitState { return this.state; }
  reset(): void { this.state = CircuitState.CLOSED; this.failureCount = 0; }
}

/**
 * Enterprise LogDatabaseManager — production-grade TimescaleDB client
 * 
 * Features:
 * - TimescaleDB extension auto-provisioning
 * - Hypertable creation with compression & retention
 * - Circuit breaker for connection failures  
 * - Automatic replica failover
 * - Query performance tracking
 * - Never timeout ingestion writes
 * - Distributed tracing support
 */
class EnterpriseLogDatabaseManager {
  private primaryPool: Pool;
  private replicaPool: Pool | null = null;
  private isShuttingDown = false;
  private timescaleReady = false;
  private timescaleVersion: string | null = null;
  private primaryCircuit: CircuitBreaker;
  private replicaCircuit: CircuitBreaker | null = null;
  private queryMetrics = new Map<string, { count: number; totalMs: number; maxMs: number }>();

  constructor() {
    const primaryUrl = env.LOG_DB_PRIMARY ?? env.DATABASE_URL;
    this.primaryPool = this.createPool(primaryUrl, 'log_primary');
    this.primaryCircuit = new CircuitBreaker();

    if (env.LOG_DB_REPLICA && env.LOG_DB_REPLICA !== env.LOG_DB_PRIMARY) {
      this.replicaPool = this.createPool(env.LOG_DB_REPLICA, 'log_replica');
      this.replicaCircuit = new CircuitBreaker();
    }
  }
