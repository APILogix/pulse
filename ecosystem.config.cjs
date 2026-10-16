/**
 * PM2 Ecosystem Configuration
 *
 * The API defaults to one cluster worker because each replica owns database,
 * Redis, log-database, and pg-boss pools. Set API_INSTANCES deliberately after
 * measuring CPU, memory, and connection capacity. Background and ingestion
 * work run in separate forked processes so they cannot block request handling.
 *
 * Usage:
 *   npx pm2 start ecosystem.config.cjs --env production
 *   npx pm2 stop api-backend
 *   npx pm2 restart api-backend
 *   npx pm2 logs
 *   npx pm2 monit
 */

'use strict';

const os = require('os');
const cpuCount = os.cpus().length;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

// Node handles many concurrent I/O requests in one process. Extra cluster
// workers should be an explicit capacity decision because every replica owns
// DB, Redis, log-DB, and pg-boss pools. Defaulting to `max` can OOM/throttle a
// small host before it receives traffic.
const apiInstances = positiveInteger(process.env.API_INSTANCES, cpuCount > 2 ? 2 : 1);

function startupBackoffBudget(attempts, baseDelayMs, maxDelayMs) {
  let total = 0;
  for (let attempt = 1; attempt < attempts; attempt += 1) {
    total += Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
  }
  return total;
}

const startupAttempts = positiveInteger(process.env.STARTUP_DB_RETRY_MAX_ATTEMPTS, 8);
const startupConnectionTimeoutMs = positiveInteger(process.env.DB_CONNECTION_TIMEOUT_MS, 30000);
const startupBaseDelayMs = positiveInteger(process.env.STARTUP_DB_RETRY_BASE_DELAY_MS, 2000);
const startupMaxDelayMs = positiveInteger(process.env.STARTUP_DB_RETRY_MAX_DELAY_MS, 15000);
const oneDatabaseStartupBudgetMs =
  startupAttempts * startupConnectionTimeoutMs +
  startupBackoffBudget(startupAttempts, startupBaseDelayMs, startupMaxDelayMs);
// API checks primary and Log DB serially. Workers use at most the same bound.
const listenTimeoutMs = positiveInteger(
  process.env.PM2_LISTEN_TIMEOUT_MS,
  oneDatabaseStartupBudgetMs * 2 + 30000,
);
const shutdownTimeoutMs = positiveInteger(process.env.SHUTDOWN_TIMEOUT_MS, 20000);
const killTimeoutMs = positiveInteger(process.env.PM2_KILL_TIMEOUT_MS, shutdownTimeoutMs + 10000);

module.exports = {
  apps: [
    {
      name: 'api-backend',
      script: 'dist/main.js',
      instances: apiInstances,
      exec_mode: 'cluster',

      node_args: ['--max-old-space-size=512'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '800M',

      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',

      wait_ready: true,
      listen_timeout: listenTimeoutMs,
      kill_timeout: killTimeoutMs,

      env: {
        NODE_ENV: 'development',
        PROCESS_ROLE: 'api',
        UV_THREADPOOL_SIZE: '8',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'api',
        UV_THREADPOOL_SIZE: '8',
        PORT: '3000',
      },

      description: `Fastify API backend — ${apiInstances}/${cpuCount} CPU workers (set API_INSTANCES to scale)`,
      version: '2.0.0',
    },

    {
      name: 'background-workers',
      script: 'dist/shared/workers/main.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: ['--max-old-space-size=512'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '700M',

      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-workers-out.log',
      error_file: 'logs/pm2-workers-error.log',

      wait_ready: true,
      listen_timeout: listenTimeoutMs,
      kill_timeout: killTimeoutMs,

      env: {
        NODE_ENV: 'development',
        PROCESS_ROLE: 'worker',
        UV_THREADPOOL_SIZE: '8',
      },
      env_production: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'worker',
        UV_THREADPOOL_SIZE: '8',
      },

      description: 'General PGMQ workers (alerts, billing, AI, automation, and maintenance)',
      version: '2.0.0',
    },

    {
      name: 'ingestion-workers',
      script: 'dist/shared/workers/ingestion-worker-main.js',
      instances: 1,
      exec_mode: 'fork',
      node_args: ['--max-old-space-size=512'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '700M',

      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-ingestion-out.log',
      error_file: 'logs/pm2-ingestion-error.log',

      wait_ready: true,
      listen_timeout: listenTimeoutMs,
      kill_timeout: killTimeoutMs,

      env: {
        NODE_ENV: 'development',
        PROCESS_ROLE: 'ingestion',
        UV_THREADPOOL_SIZE: '8',
      },
      env_production: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'ingestion',
        UV_THREADPOOL_SIZE: '8',
      },

      description: 'Ingestion worker tier (PGMQ pipelines + DLQ + usage rollup)',
      version: '2.0.0',
    },

    {
      // Analytics engine — docs/analytics/06-worker-architecture.md §1.
      // Intentionally a separate process from both the API and the ingestion
      // tier: analytics must never block ingestion, and it scales on its own.
      // Safe to run multiple instances: pg-boss uses SKIP LOCKED and every
      // rollup write is a whole-bucket recompute, so duplicate work converges.
      name: 'analytics-workers',
      script: 'dist/shared/workers/analytics-worker-main.js',
      instances: positiveInteger(process.env.ANALYTICS_WORKER_INSTANCES, 1),
      exec_mode: 'fork',
      node_args: ['--max-old-space-size=512'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      restart_delay: 2000,
      max_memory_restart: '640M',

      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-analytics-out.log',
      error_file: 'logs/pm2-analytics-error.log',

      wait_ready: true,
      listen_timeout: listenTimeoutMs,
      kill_timeout: killTimeoutMs,

      env: {
        NODE_ENV: 'development',
        PROCESS_ROLE: 'analytics',
        UV_THREADPOOL_SIZE: '8',
      },
      env_production: {
        NODE_ENV: 'production',
        PROCESS_ROLE: 'analytics',
        UV_THREADPOOL_SIZE: '8',
      },

      description: 'Analytics engine workers (rollups, compaction, retention) — Log DB read-only',
      version: '1.0.0',
    },
  ],
};
