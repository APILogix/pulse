/**
 * PM2 Ecosystem Configuration
 *
 * Cluster mode: PM2 forks one worker per CPU core, each running a full
 * copy of the Fastify process. The OS round-robins incoming connections
 * across workers, giving near-linear throughput scaling.
 *
 * Usage:
 *   npx pm2 start ecosystem.config.cjs
 *   npx pm2 stop api-backend
 *   npx pm2 restart api-backend
 *   npx pm2 logs api-backend
 *   npx pm2 monit
 */

'use strict';

const os = require('os');
const cpuCount = os.cpus().length;

module.exports = {
  apps: [
    {
      // ── Identity ───────────────────────────────────────────────────────
      name: 'api-backend',
      script: 'dist/main.js',

      // ── Cluster mode ───────────────────────────────────────────────────
      // 'max' = one worker per logical CPU core.
      // This is the primary scaling lever for a single machine.
      instances: 'max',
      exec_mode: 'cluster',

      // ── Runtime ────────────────────────────────────────────────────────
      node_args: [
        '--max-old-space-size=512',   // cap V8 heap per worker at 512 MB
        '--max-semi-space-size=64',   // smaller nursery → less GC pressure
      ],

      // ── Restart policy ─────────────────────────────────────────────────
      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',             // must stay up 5s or it's a crash loop
      restart_delay: 1000,          // wait 1s between restarts
      max_memory_restart: '600M',   // restart a worker if it leaks past 600 MB

      // ── Logging ────────────────────────────────────────────────────────
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',

      // ── Health probe ───────────────────────────────────────────────────
      // PM2 will wait for a 'ready' event from the worker before considering
      // it live. Our main.ts calls process.send('ready') after the server
      // starts listening.
      wait_ready: true,
      listen_timeout: 15000,

      // ── Graceful shutdown ──────────────────────────────────────────────
      // Give the worker 10 s to drain in-flight requests before SIGKILL.
      kill_timeout: 10000,

      // ── Environment ────────────────────────────────────────────────────
      env: {
        NODE_ENV: 'development',
        PORT: '3000',
      },
      env_production: {
        NODE_ENV: 'development',
        PORT: '3000',
      },

      // ── Metadata (informational) ───────────────────────────────────────
      description: `Fastify API backend — ${cpuCount} CPU cores detected`,
      version: '2.0.0',
    },

    {
      // ── Ingestion worker tier (dedicated process) ──────────────────────
      // Runs the pg-boss per-type ingestion pipelines (ingest.<type> queues),
      // DLQ intake, usage rollup cron, and the worker metrics endpoint. Kept
      // separate from the API cluster so heavy persistence never steals CPU
      // from request acceptance. Fork mode (NOT cluster): scale by raising
      // `instances` — pg-boss keeps multiple copies safe.
      name: 'ingestion-workers',
      script: 'dist/shared/workers/ingestion-worker-main.js',
      instances: 1,
      exec_mode: 'fork',

      node_args: ['--max-old-space-size=512'],

      autorestart: true,
      max_restarts: 10,
      min_uptime: '5s',
      restart_delay: 1000,
      max_memory_restart: '700M',

      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file: 'logs/pm2-ingestion-out.log',
      error_file: 'logs/pm2-ingestion-error.log',

      // ingestion-worker-main.ts calls process.send('ready') after the
      // WorkerRegistry starts.
      wait_ready: true,
      listen_timeout: 20000,
      // Allow in-flight jobs to drain (visibility timeout aware).
      kill_timeout: 20000,

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
      },

      description: 'Ingestion worker tier (pg-boss per-type pipelines + DLQ intake + usage rollup)',
      version: '2.0.0',
    },
  ],
};
