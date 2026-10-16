#!/usr/bin/env tsx
/**
 * PostgreSQL pg_stat_statements Diagnostic CLI.
 *
 * Usage:
 *   npx tsx scripts/db-top-queries.ts [--db=control|telemetry] [--format=table|json] [--limit=10]
 */

import { pool } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';

interface QueryRow {
  query_id: string;
  query: string;
  calls: string;
  total_exec_time_ms: number;
  mean_exec_time_ms: number;
  max_exec_time_ms: number;
  min_exec_time_ms: number;
  stddev_exec_time_ms: number;
  jitter_ratio: number;
  shared_blks_hit: string;
  shared_blks_read: string;
  cache_miss_ratio: number;
  io_time_ms: number;
}

function parseArgs(): { db: 'control' | 'telemetry'; format: 'table' | 'json'; limit: number } {
  const args = process.argv.slice(2);
  let db: 'control' | 'telemetry' = 'control';
  let format: 'table' | 'json' = 'table';
  let limit = 10;

  for (const arg of args) {
    if (arg.startsWith('--db=')) {
      const val = arg.split('=')[1];
      if (val === 'telemetry') db = 'telemetry';
    } else if (arg.startsWith('--format=')) {
      const val = arg.split('=')[1];
      if (val === 'json') format = 'json';
    } else if (arg.startsWith('--limit=')) {
      const val = parseInt(arg.split('=')[1] ?? '10', 10);
      if (!isNaN(val) && val > 0) limit = val;
    }
  }

  return { db, format, limit };
}

async function runReport(): Promise<void> {
  const { db, format, limit } = parseArgs();
  const targetPool = db === 'telemetry' ? logDB.getPrimaryPool() : pool;

  try {
    // 1. Verify extension exists
    const extCheck = await targetPool.query(
      `SELECT 1 FROM pg_extension WHERE extname = 'pg_stat_statements'`,
    );
    if (extCheck.rowCount === 0) {
      console.error(
        `Error: pg_stat_statements extension is not installed in database '${db}'. Run database/monitoring/001_pg_stat_statements.sql first.`,
      );
      process.exit(1);
    }

    // 2. Top 10 by total execution time
    const topTotalRes = await targetPool.query<QueryRow>(
      `
      SELECT
        queryid::text AS query_id,
        LEFT(query, 120) AS query,
        calls::text,
        ROUND(total_exec_time::numeric, 2) AS total_exec_time_ms,
        ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms,
        ROUND(max_exec_time::numeric, 2) AS max_exec_time_ms,
        ROUND(min_exec_time::numeric, 2) AS min_exec_time_ms,
        ROUND((shared_blks_read::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100)::numeric, 2) AS cache_miss_ratio,
        ROUND((blk_read_time + blk_write_time)::numeric, 2) AS io_time_ms
      FROM pg_stat_statements
      WHERE query NOT ILIKE '%pg_stat_statements%'
      ORDER BY total_exec_time DESC
      LIMIT $1
    `,
      [limit],
    );

    // 3. Top 10 by mean execution time (min calls >= 50)
    const topMeanRes = await targetPool.query<QueryRow>(
      `
      SELECT
        queryid::text AS query_id,
        LEFT(query, 120) AS query,
        calls::text,
        ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms,
        ROUND(total_exec_time::numeric, 2) AS total_exec_time_ms,
        ROUND(max_exec_time::numeric, 2) AS max_exec_time_ms,
        ROUND((shared_blks_read::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100)::numeric, 2) AS cache_miss_ratio
      FROM pg_stat_statements
      WHERE calls >= 50 AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY mean_exec_time DESC
      LIMIT $1
    `,
      [limit],
    );

    // 4. Top 10 by buffer cache miss ratio (high disk reads)
    const topCacheMissRes = await targetPool.query<QueryRow>(
      `
      SELECT
        queryid::text AS query_id,
        LEFT(query, 120) AS query,
        calls::text,
        ROUND((shared_blks_read::numeric / NULLIF(shared_blks_hit + shared_blks_read, 0) * 100)::numeric, 2) AS cache_miss_ratio,
        shared_blks_read::text,
        shared_blks_hit::text,
        ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms
      FROM pg_stat_statements
      WHERE (shared_blks_hit + shared_blks_read) >= 100 AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY cache_miss_ratio DESC
      LIMIT $1
    `,
      [limit],
    );

    // 5. High Jitter Queries (Max vs Mean ratio)
    const highJitterRes = await targetPool.query<QueryRow>(
      `
      SELECT
        queryid::text AS query_id,
        LEFT(query, 120) AS query,
        calls::text,
        ROUND(mean_exec_time::numeric, 2) AS mean_exec_time_ms,
        ROUND(max_exec_time::numeric, 2) AS max_exec_time_ms,
        ROUND((max_exec_time / NULLIF(mean_exec_time, 0))::numeric, 1) AS jitter_ratio
      FROM pg_stat_statements
      WHERE calls >= 20 AND mean_exec_time >= 5 AND query NOT ILIKE '%pg_stat_statements%'
      ORDER BY (max_exec_time / NULLIF(mean_exec_time, 0)) DESC
      LIMIT $1
    `,
      [limit],
    );

    const report = {
      database: db,
      timestamp: new Date().toISOString(),
      topTotalExecutionTime: topTotalRes.rows,
      topMeanExecutionTime: topMeanRes.rows,
      topBufferCacheMisses: topCacheMissRes.rows,
      highJitterQueries: highJitterRes.rows,
    };

    if (format === 'json') {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n================================================================================`);
      console.log(` POSTGRESQL QUERY PERFORMANCE REPORT [DB: ${db.toUpperCase()}]`);
      console.log(` Generated at: ${report.timestamp}`);
      console.log(`================================================================================\n`);

      console.log(`--- 1. TOP ${limit} BY TOTAL EXECUTION TIME (Where DB spends the most time) ---`);
      console.table(
        topTotalRes.rows.map((r) => ({
          query_id: r.query_id,
          calls: r.calls,
          total_ms: r.total_exec_time_ms,
          mean_ms: r.mean_exec_time_ms,
          miss_pct: r.cache_miss_ratio,
          query: r.query.slice(0, 60),
        })),
      );

      console.log(`\n--- 2. TOP ${limit} BY MEAN EXECUTION TIME (Consistently Slow, Calls >= 50) ---`);
      console.table(
        topMeanRes.rows.map((r) => ({
          query_id: r.query_id,
          calls: r.calls,
          mean_ms: r.mean_exec_time_ms,
          total_ms: r.total_exec_time_ms,
          query: r.query.slice(0, 60),
        })),
      );

      console.log(`\n--- 3. TOP ${limit} BY BUFFER CACHE MISS RATIO (I/O Bottlenecks) ---`);
      console.table(
        topCacheMissRes.rows.map((r) => ({
          query_id: r.query_id,
          miss_pct: r.cache_miss_ratio,
          shared_read: r.shared_blks_read,
          shared_hit: r.shared_blks_hit,
          mean_ms: r.mean_exec_time_ms,
          query: r.query.slice(0, 60),
        })),
      );

      console.log(`\n--- 4. HIGH JITTER QUERIES (Max vs Mean Ratio, p99 Spikes) ---`);
      console.table(
        highJitterRes.rows.map((r) => ({
          query_id: r.query_id,
          jitter_ratio: `${r.jitter_ratio}x`,
          mean_ms: r.mean_exec_time_ms,
          max_ms: r.max_exec_time_ms,
          calls: r.calls,
          query: r.query.slice(0, 60),
        })),
      );
    }
  } finally {
    await pool.end().catch(() => {});
    await logDB.close().catch(() => {});
  }
}

void runReport().catch((err) => {
  console.error('Diagnostic report failed:', err);
  process.exit(1);
});
