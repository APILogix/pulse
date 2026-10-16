#!/usr/bin/env tsx
/**
 * PgBouncer Metrics Exporter & Diagnostic Script.
 *
 * Connects to the PgBouncer administrative console database ('pgbouncer')
 * to poll 'SHOW POOLS;' and 'SHOW STATS;' and emit structured metrics.
 *
 * Usage:
 *   npx tsx scripts/pgbouncer-exporter.ts [--once] [--interval=5000] [--port=6432]
 */

import { Client } from 'pg';
import promClient from 'prom-client';

const pgbouncerClientActive = new promClient.Gauge({
  name: 'pgbouncer_pools_client_active',
  help: 'Active client connections currently linked to a server connection',
  labelNames: ['database', 'user'] as const,
});

const pgbouncerClientWaiting = new promClient.Gauge({
  name: 'pgbouncer_pools_client_waiting',
  help: 'Client connections waiting for a server connection slot',
  labelNames: ['database', 'user'] as const,
});

const pgbouncerServerActive = new promClient.Gauge({
  name: 'pgbouncer_pools_server_active',
  help: 'Server connections currently linked to a client',
  labelNames: ['database', 'user'] as const,
});

const pgbouncerServerIdle = new promClient.Gauge({
  name: 'pgbouncer_pools_server_idle',
  help: 'Server connections idle and ready for immediate client queries',
  labelNames: ['database', 'user'] as const,
});

const pgbouncerServerUsed = new promClient.Gauge({
  name: 'pgbouncer_pools_server_used',
  help: 'Server connections idle for longer than server_check_delay, needing ping',
  labelNames: ['database', 'user'] as const,
});

const pgbouncerAvgQueryTime = new promClient.Gauge({
  name: 'pgbouncer_stats_avg_query_time_seconds',
  help: 'Average query duration observed by PgBouncer in seconds',
  labelNames: ['database'] as const,
});

function parseArgs(): { once: boolean; intervalMs: number; host: string; port: number; user: string } {
  const args = process.argv.slice(2);
  let once = false;
  let intervalMs = 5000;
  let host = process.env.PGBOUNCER_HOST || '127.0.0.1';
  let port = Number(process.env.PGBOUNCER_PORT || 6432);
  let user = process.env.PGBOUNCER_ADMIN_USER || 'pgbouncer';

  for (const arg of args) {
    if (arg === '--once') once = true;
    else if (arg.startsWith('--interval=')) intervalMs = Number(arg.split('=')[1]);
    else if (arg.startsWith('--host=')) host = arg.split('=')[1]!;
    else if (arg.startsWith('--port=')) port = Number(arg.split('=')[1]);
  }

  return { once, intervalMs, host, port, user };
}

async function collectMetrics(client: Client): Promise<void> {
  const poolsRes = await client.query('SHOW POOLS;');
  const statsRes = await client.query('SHOW STATS;');

  console.log(`\n[${new Date().toISOString()}] === PGBOUNCER POOLS STATUS ===`);
  console.table(
    poolsRes.rows.map((row) => ({
      database: row.database,
      user: row.user,
      cl_active: row.cl_active,
      cl_waiting: row.cl_waiting,
      sv_active: row.sv_active,
      sv_idle: row.sv_idle,
      sv_used: row.sv_used,
      maxwait: `${row.maxwait}s`,
    })),
  );

  for (const row of poolsRes.rows) {
    const labels = { database: String(row.database), user: String(row.user) };
    pgbouncerClientActive.set(labels, Number(row.cl_active || 0));
    pgbouncerClientWaiting.set(labels, Number(row.cl_waiting || 0));
    pgbouncerServerActive.set(labels, Number(row.sv_active || 0));
    pgbouncerServerIdle.set(labels, Number(row.sv_idle || 0));
    pgbouncerServerUsed.set(labels, Number(row.sv_used || 0));
  }

  console.log(`=== PGBOUNCER STATS (Avg Query Time & Transactions) ===`);
  console.table(
    statsRes.rows.map((row) => ({
      database: row.database,
      total_xact_count: row.total_xact_count,
      total_query_count: row.total_query_count,
      avg_query_time: `${row.avg_query_time} us`,
      avg_wait_time: `${row.avg_wait_time} us`,
    })),
  );

  for (const row of statsRes.rows) {
    const labels = { database: String(row.database) };
    const avgQueryTimeSec = Number(row.avg_query_time || 0) / 1_000_000;
    pgbouncerAvgQueryTime.set(labels, avgQueryTimeSec);
  }
}

async function main(): Promise<void> {
  const { once, intervalMs, host, port, user } = parseArgs();

  const client = new Client({
    host,
    port,
    user,
    database: 'pgbouncer',
    password: process.env.PGBOUNCER_ADMIN_PASSWORD || 'pgbouncer',
  });

  try {
    await client.connect();
    console.log(`Connected to PgBouncer admin console at ${host}:${port}/pgbouncer`);

    if (once) {
      await collectMetrics(client);
      await client.end();
      return;
    }

    while (true) {
      try {
        await collectMetrics(client);
      } catch (err: any) {
        console.error('Error polling PgBouncer stats:', err.message);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  } catch (err: any) {
    console.error(`Failed to connect to PgBouncer console: ${err.message}`);
    process.exit(1);
  }
}

void main();
