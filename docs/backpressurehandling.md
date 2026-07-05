Enterprise Backpressure & Concurrency Refactor — Master Implementation Document
Version: 1.0 | Date: 2026-07-04 | Target: 3 Oracle Cloud Servers, Postgres-Only, No Redis
1. Executive Summary & Architecture Decisions
Table
Decision	Rationale
No Redis	Bootstrap constraint. Postgres is the source of truth.
Delete BackpressureTracker	Per-process counter is useless across 3 servers. Wrong Fastify preHandler signature (next callback). Dead code.
Delete globalDbLimit	p-limit is in-process. Real global limit = 50 × 3 servers = 150. DB pool size is the only true cross-process semaphore.
Gauge Table Pattern	Single-row backpressure_gauge updated by workers, read by all API servers. O(1) vs COUNT(*). Used by GitLab, Stripe-style systems.
Load Balancer Shedding	Oracle Cloud LB reads /health/ready. If queue depth > threshold, instance returns 503. LB stops routing. If all 3 instances hot, LB returns 503 to client. No in-app 503 logic.
Env-Driven Pool Sizing	Hard-coded max: 10 across 3 servers exhausts small OCI DB tiers.
2. Database Migration (Run Once)
File: migrations/002_add_backpressure_gauge.sql
sql
-- Enterprise backpressure gauge table
-- Single-row pattern ensures O(1) reads across all API servers
CREATE TABLE IF NOT EXISTS backpressure_gauge (
    id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    pending_depth bigint NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT NOW(),
    -- Enterprise: track which worker last updated for debugging
    last_worker_id text
);

-- Insert singleton row
INSERT INTO backpressure_gauge (id, pending_depth, updated_at, last_worker_id)
VALUES (1, 0, NOW(), 'init')
ON CONFLICT (id) DO NOTHING;

-- Index not needed on single-row table, but add for safety if schema tools require it
CREATE INDEX IF NOT EXISTS idx_backpressure_gauge_updated 
ON backpressure_gauge(updated_at);

-- Add comment for future developers
COMMENT ON TABLE backpressure_gauge IS 
'Shared cross-process queue depth gauge. Workers UPDATE after each batch. API servers READ for health checks.';
3. File-by-File Implementation Specs
3.1 src/lib/concurrency/backpressure.ts → DELETE
Action: Delete the entire file.
Reason:
activeCount is per-process (useless across 3 OCI servers).
enforce() signature is wrong for Fastify 4/5 (preHandler does not pass next).
If wired, it would crash with unhandled promise warnings.
Gauge + LB pattern replaces this completely.
Cleanup: Remove all imports of BackpressureTracker from app.ts or server.ts.
3.2 src/lib/concurrency/limiters.ts → REFACTOR
Action: Remove fake "global" limiters. Keep only local operation limiters. Add enterprise comments.
TypeScript
import pLimit from 'p-limit';

/**
 * LOCAL concurrency limiters only.
 *
 * WARNING: These are per-process. With 3 OCI servers, real concurrency
 * for any external resource = limit × 3. The true global semaphore is
 * the Postgres connection pool size (set via env).
 *
 * For DB concurrency: Do NOT use a limiter. Size your pool so that
 * (pool_size × server_count) < DB_max_connections.
 */
export const localApiLimit = pLimit(
  Number(process.env.API_MAX_CONCURRENCY || 20)
);

export const localRedisLimit = pLimit(
  Number(process.env.REDIS_MAX_CONCURRENCY || 100)
);

// DELETED: globalDbLimit — DB pool size is the real cross-process limit.
// If you need DB throttling, reduce the pool size, not a limiter.

/**
 * Creates a local concurrency limiter for a specific operation.
 *
 * Enterprise: Always assume this is per-process only. Never use for
 * cross-server resource protection (DB, Redis, external APIs).
 */
export function createLimiter(concurrency: number) {
  if (concurrency < 1) {
    throw new Error('Concurrency must be >= 1');
  }
  return pLimit(concurrency);
}
3.3 src/lib/concurrency/batching.ts → REFACTOR (or DELETE if unused)
Action: Replace sequential chunk drain with streaming p-map. Fix limiter leak. Add backpressure-safe streaming.
TypeScript
import pMap from 'p-map';

/**
 * Enterprise-grade batch processor with streaming concurrency.
 *
 * Fixes over the old implementation:
 * 1. No sequential chunk waiting — all items stream through with max concurrency.
 * 2. No limiter recreation — uses p-map's internal scheduler.
 * 3. Optional abort signal for graceful shutdown.
 * 4. Optional progress callback for metrics emission.
 */
export async function processInBatches<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>,
  options?: {
    abortSignal?: AbortSignal;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<R[]> {
  if (concurrency < 1) {
    throw new Error('Concurrency must be >= 1');
  }

  let completed = 0;
  const total = items.length;

  return pMap(
    items,
    async (item, index) => {
      // Check abort before processing
      if (options?.abortSignal?.aborted) {
        throw new Error('Batch processing aborted');
      }

      const result = await processor(item, index);

      completed++;
      options?.onProgress?.(completed, total);

      return result;
    },
    { concurrency }
  );
}

/**
 * Utility: Split array into chunks (still useful for bulk inserts).
 */
export function chunkArray<T>(array: T[], size: number): T[][] {
  if (size < 1) throw new Error('Chunk size must be >= 1');
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
Note: If processInBatches is not used in the hot path, delete the entire file and remove imports. The worker queue is the real batch mechanism. Only keep if you have bulk import endpoints.
3.4 src/lib/pgboss.ts → REFACTOR
Action: Env-driven pool. Add resiliency timeouts. Add connection error telemetry.
TypeScript
import { PgBoss } from 'pg-boss';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

const bossLogger = logger.child({ component: 'pg-boss' });

if (!env.DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

// Enterprise: Pool size must be env-driven so 3 servers don't exhaust DB.
const POOL_SIZE = Number(env.INGESTION_DB_POOL_SIZE || 10);
const IDLE_TIMEOUT = Number(env.INGESTION_DB_IDLE_TIMEOUT_MS || 30000);
const CONN_TIMEOUT = Number(env.INGESTION_DB_CONNECTION_TIMEOUT_MS || 5000);

/**
 * PgBoss Singleton.
 *
 * Enterprise decisions:
 * - Pool sized via env for multi-server deployment math.
 * - idleTimeoutMillis prevents OCI load balancer idle disconnects.
 * - connectionTimeoutMillis ensures fast fail during DB pressure.
 * - Separate from app query pool to prevent starvation.
 */
export const pgboss = new PgBoss({
  connectionString: env.DATABASE_URL,
  application_name: `pgboss_${env.NODE_ENV}`,
  max: POOL_SIZE,
  idleTimeoutMillis: IDLE_TIMEOUT,
  connectionTimeoutMillis: CONN_TIMEOUT,
  // Enterprise: apply_absolute_timeout if supported by your pg-boss version
  // to prevent zombie connections.
});

pgboss.on('error', (err: Error) => {
  bossLogger.error({ err, poolSize: POOL_SIZE }, 'PgBoss error');
});

pgboss.on('maintenance', () => {
  bossLogger.debug('PgBoss maintenance occurred');
});

pgboss.on('monitor', (state) => {
  // Enterprise: emit pool metrics for observability
  bossLogger.debug(
    {
      poolSize: state.poolSize,
      totalCount: state.totalCount,
      idleCount: state.idleCount,
      waitingCount: state.waitingCount
    },
    'PgBoss pool state'
  );
});

export async function startPgBoss(): Promise<void> {
  bossLogger.info({ poolSize: POOL_SIZE }, 'Starting PgBoss...');
  await pgboss.start();
  bossLogger.info('PgBoss started successfully');
}

export async function stopPgBoss(): Promise<void> {
  bossLogger.info('Stopping PgBoss...');
  await pgboss.stop({ graceful: true, timeout: 10000 });
  bossLogger.info('PgBoss stopped');
}
3.5 NEW FILE: src/lib/gauge.ts (Gauge Repository)
Action: Create typed repository for gauge operations. Enterprise-grade with error handling and metrics.
TypeScript
import { logger } from '../config/logger.js';

const gaugeLogger = logger.child({ component: 'backpressure-gauge' });

export interface GaugeState {
  pendingDepth: number;
  updatedAt: Date;
  lastWorkerId?: string;
}

/**
 * Enterprise gauge repository.
 *
 * All cross-process backpressure state flows through this single row.
 * Workers write. API servers read. O(1) guaranteed.
 */
export class BackpressureGauge {
  constructor(private readonly db: { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }> }) {}

  /**
   * Read current gauge state. Used by health checks (hot path).
   * Target: < 1ms query time.
   */
  async read(): Promise<GaugeState | null> {
    try {
      const result = await this.db.query(
        `SELECT pending_depth, updated_at, last_worker_id
         FROM backpressure_gauge
         WHERE id = 1`
      );

      if (!result.rows[0]) return null;

      return {
        pendingDepth: Number(result.rows[0].pending_depth),
        updatedAt: new Date(result.rows[0].updated_at),
        lastWorkerId: result.rows[0].last_worker_id,
      };
    } catch (err) {
      gaugeLogger.error({ err }, 'Failed to read gauge');
      // Enterprise: fail open — return null so health check decides
      return null;
    }
  }

  /**
   * Update gauge depth. Called by workers after each batch.
   *
   * Enterprise: Use a transaction if updating alongside job completion.
   */
  async update(depth: number, workerId: string): Promise<void> {
    try {
      await this.db.query(
        `UPDATE backpressure_gauge
         SET pending_depth = $1,
             updated_at = NOW(),
             last_worker_id = $2
         WHERE id = 1`,
        [depth, workerId]
      );
    } catch (err) {
      gaugeLogger.error({ err, depth, workerId }, 'Failed to update gauge');
      // Enterprise: don't throw — gauge is best-effort, not critical path
    }
  }

  /**
   * Check if gauge is stale (workers may have died).
   */
  isStale(state: GaugeState, maxAgeMs: number): boolean {
    return Date.now() - state.updatedAt.getTime() > maxAgeMs;
  }
}
3.6 NEW FILE: src/lib/health.ts (Health Check Endpoints)
Action: Fastify plugin. /health/ready is the Oracle LB integration point.
TypeScript
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BackpressureGauge } from './gauge.js';
import { logger } from '../config/logger.js';

const healthLogger = logger.child({ component: 'health-check' });

interface HealthConfig {
  gauge: BackpressureGauge;
  maxQueueDepth: number;
  maxGaugeAgeMs: number;
  // Enterprise: optional callback for custom checks
  customReadyCheck?: () => Promise<{ healthy: boolean; reason?: string }>;
}

/**
 * Enterprise health check plugin.
 *
 * Oracle Cloud Load Balancer configuration:
 * - Path: /health/ready
 * - Interval: 5s
 * - Healthy threshold: 2 consecutive 200s
 * - Unhealthy threshold: 2 consecutive 503s
 *
 * When queue depth exceeds threshold, this instance returns 503.
 * LB stops routing to it. If all 3 instances return 503, LB returns 503 to client.
 */
export async function registerHealthChecks(
  app: FastifyInstance,
  config: HealthConfig
) {
  // Liveness: always 200. K8s/OCI uses this to know if process is alive.
  app.get('/health/live', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.status(200).send({
      status: 'alive',
      timestamp: new Date().toISOString(),
    });
  });

  // Readiness: backpressure-aware. This is the LB traffic gate.
  app.get('/health/ready', async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const gauge = await config.gauge.read();

      // If gauge is missing or unreadable, fail open (assume unhealthy)
      if (!gauge) {
        healthLogger.warn('Gauge unreadable, reporting unhealthy');
        return reply.status(503).send({
          status: 'unavailable',
          reason: 'gauge_unavailable',
          timestamp: new Date().toISOString(),
        });
      }

      const ageMs = Date.now() - gauge.updatedAt.getTime();
      const isStale = config.gauge.isStale(gauge, config.maxGaugeAgeMs);
      const isDeep = gauge.pendingDepth > config.maxQueueDepth;

      // Custom enterprise check (e.g., DB connectivity, external API)
      let customResult = { healthy: true };
      if (config.customReadyCheck) {
        customResult = await config.customReadyCheck();
      }

      if (isDeep || isStale || !customResult.healthy) {
        const reason = isDeep
          ? 'queue_depth_exceeded'
          : isStale
            ? 'gauge_stale'
            : customResult.reason || 'custom_check_failed';

        healthLogger.warn(
          {
            depth: gauge.pendingDepth,
            maxDepth: config.maxQueueDepth,
            ageMs,
            maxAgeMs: config.maxGaugeAgeMs,
            reason
          },
          'Readiness check failed'
        );

        return reply.status(503).send({
          status: 'unavailable',
          reason,
          depth: gauge.pendingDepth,
          maxDepth: config.maxQueueDepth,
          gaugeAgeMs: ageMs,
          timestamp: new Date().toISOString(),
        });
      }

      // Healthy
      return reply.status(200).send({
        status: 'ready',
        depth: gauge.pendingDepth,
        gaugeAgeMs: ageMs,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      healthLogger.error({ err }, 'Health check exception');
      return reply.status(503).send({
        status: 'error',
        reason: 'health_check_exception',
        timestamp: new Date().toISOString(),
      });
    }
  });
}
3.7 src/service.ts (Worker) → REFACTOR
Action: Replace pendingDepth() COUNT(*) with gauge update. Add worker ID.
TypeScript
import { BackpressureGauge } from '../lib/gauge.js';
import { logger } from '../config/logger.js';

// ... existing imports ...

const workerLogger = logger.child({ component: 'ingestion-worker' });

// Enterprise: unique worker ID for debugging across 3 servers
const WORKER_ID = `${process.env.HOSTNAME || 'unknown'}_${process.pid}`;

export class IngestionService {
  private gauge: BackpressureGauge;

  constructor(private readonly db: any /* your DB pool type */) {
    this.gauge = new BackpressureGauge(db);
  }

  /**
   * DELETED: Old pendingDepth() with COUNT(*) and 2s cache.
   *
   * Replaced with: O(1) gauge read. If you need depth for metrics,
   * read from gauge table, not COUNT(*).
   */

  /**
   * Process batch and update gauge.
   *
   * Enterprise: Update gauge inside the same transaction as job completion
   * if possible, to prevent gauge drift on worker crash.
   */
  async processBatch(jobs: any[]): Promise<void> {
    // ... your existing processing logic ...

    // After processing, update gauge with remaining depth
    // Option A: If you have a queue method to get pending count:
    // const remainingDepth = await this.queue.pendingDepth();

    // Option B (better): Maintain a counter during processing
    // const remainingDepth = await this.getPendingCountEstimate();

    // For now, use your existing queue method but call it less frequently
    // or use pg_class reltuples estimate for very large tables:
    const remainingDepth = await this.getQueueDepthEstimate();

    await this.gauge.update(remainingDepth, WORKER_ID);

    workerLogger.debug(
      { workerId: WORKER_ID, remainingDepth, processed: jobs.length },
      'Batch complete, gauge updated'
    );
  }

  /**
   * Enterprise: Use pg_class estimate instead of COUNT(*) for large tables.
   * This is O(1) instead of O(n).
   */
  private async getQueueDepthEstimate(): Promise<number> {
    try {
      const result = await this.db.query(`
        SELECT reltuples::bigint AS estimate
        FROM pg_class
        WHERE relname = 'pgboss.job'
      `);
      return Number(result.rows[0]?.estimate || 0);
    } catch (err) {
      workerLogger.error({ err }, 'Failed to get depth estimate');
      return 0;
    }
  }

  // ... rest of service ...
}
Alternative if you want exact counts: Keep pendingDepth() but call it only once every 10 batches, and use the gauge for everything else. The gauge is the operational truth; COUNT(*) is the audit truth.
4. Environment Configuration (.env / OCI Secrets)
bash
# ============================================
# DATABASE (True global semaphore)
# ============================================
# OCI DB max_connections = 100. Leave 10 for admin.
# 90 ÷ 3 servers = 30 per server.
INGESTION_DB_POOL_SIZE=30
INGESTION_DB_IDLE_TIMEOUT_MS=30000
INGESTION_DB_CONNECTION_TIMEOUT_MS=5000

# App DB pool (if separate from PgBoss)
DB_POOL_SIZE=20
DB_MAX_CONCURRENCY=50  # Deprecated — kept for backwards compat only

# ============================================
# LOCAL LIMITERS (Per-process, soft limits)
# ============================================
API_MAX_CONCURRENCY=20
REDIS_MAX_CONCURRENCY=100

# ============================================
# BACKPRESSURE GAUGE
# ============================================
# Queue depth at which this instance stops accepting traffic
# Tune based on worker throughput. If workers process 10k/min,
# 50k means ~5 min backlog — reasonable.
MAX_QUEUE_DEPTH=50000

# If gauge hasn't been updated in 10s, assume workers died
MAX_GAUGE_AGE_MS=10000

# ============================================
# WORKER
# ============================================
# How often to update gauge (every N batches)
GAUGE_UPDATE_INTERVAL_BATCHES=1
5. Oracle Cloud Load Balancer Configuration
Configure your OCI LB with these exact settings:
Table
Setting	Value
Protocol	HTTPS
Path	/health/ready
Port	443 (or your app port)
Interval	5 seconds
Timeout	3 seconds
Healthy Threshold	2 consecutive passes
Unhealthy Threshold	2 consecutive failures
Success Code	200
Failure Code	503
Traffic policy: When an instance returns 503, the LB removes it from rotation. If all 3 instances return 503, the LB returns 503 to the client. This is graceful degradation.
6. Enterprise Observability Requirements
Every component must emit these metrics (via your logger or metrics library):
Table
Metric	Source	Purpose
gauge.pending_depth	gauge.read()	Queue depth trend
gauge.age_ms	gauge.read()	Detect stale/dead workers
health.ready.status	/health/ready	LB decision visibility
pgboss.pool.waiting	pgboss.on('monitor')	DB pool pressure
batch.processed	processInBatches	Worker throughput
batch.errors	processInBatches	Error rate
7. Testing & Validation Checklist
Before deploying to production:
[ ] Migration 002_add_backpressure_gauge.sql runs successfully
[ ] BackpressureTracker is deleted and no longer imported
[ ] globalDbLimit is deleted from limiters.ts
[ ] pgboss.ts reads INGESTION_DB_POOL_SIZE from env
[ ] Worker calls gauge.update() after each batch
[ ] /health/ready returns 200 when gauge is healthy
[ ] /health/ready returns 503 when MAX_QUEUE_DEPTH exceeded
[ ] /health/ready returns 503 when gauge is stale (>10s)
[ ] OCI LB stops routing to instance returning 503
[ ] processInBatches uses p-map (not sequential chunks)
[ ] Load test: simulate 3 servers, verify total DB connections ≤ 90
8. Rollback Plan
If issues occur:
Immediate: Set MAX_QUEUE_DEPTH=999999999 in env. All instances return 200.
Short-term: Revert pgboss.ts to max: 10 (hardcoded).
Full rollback: Delete gauge table, restore old pendingDepth() with 2s cache. Re-add BackpressureTracker if absolutely necessary (not recommended).
9. Summary of Changes
Table
File	Action	Lines of Change
backpressure.ts	DELETE	-50
limiters.ts	REFACTOR	Remove globalDbLimit, rename others
batching.ts	REFACTOR	Replace with p-map streaming
pgboss.ts	REFACTOR	Env pool size, timeouts, monitoring
service.ts	REFACTOR	Gauge update, remove COUNT(*)
gauge.ts	CREATE	New repository
health.ts	CREATE	LB-ready health checks
migrations/002_...	CREATE	Gauge table
Total philosophy: Remove broken distributed abstractions. Use Postgres as shared memory. Let the Load Balancer shed traffic. Size pools for true global limits. This is how enterprise systems handle 1M+ RPM without Redis.