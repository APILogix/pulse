#!/usr/bin/env tsx
/**
 * Safe EXPLAIN / EXPLAIN ANALYZE Diagnostic Script.
 *
 * Usage:
 *   npx tsx scripts/db-explain.ts --query=auth.apiKeyLookup [--analyze] [--allow-writes]
 *   npx tsx scripts/db-explain.ts --sql="SELECT * FROM users WHERE email = $1" --params='["admin@pulse.dev"]' [--analyze]
 */

import { pool } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';
import { DB_QUERY_NAMES, type DbQueryName } from '../src/config/perf/query-names.js';

const QUERY_TEMPLATES: Record<
  string,
  { db: 'control' | 'telemetry'; sql: string; params: unknown[] }
> = {
  [DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP]: {
    db: 'control',
    sql: 'SELECT id, organization_id, project_id, secret_hash, allowed_ips FROM api_keys WHERE key_prefix = $1 LIMIT 1',
    params: ['pk_live_sample'],
  },
  [DB_QUERY_NAMES.AUTH_USER_LOOKUP_BY_EMAIL]: {
    db: 'control',
    sql: 'SELECT id, email, password_hash, status FROM users WHERE email = $1 LIMIT 1',
    params: ['admin@pulse.dev'],
  },
  [DB_QUERY_NAMES.ORG_GET_BY_ID]: {
    db: 'control',
    sql: 'SELECT id, name, slug, settings FROM organizations WHERE id = $1',
    params: ['00000000-0000-0000-0000-000000000001'],
  },
  [DB_QUERY_NAMES.PROJECT_GET_BY_ID]: {
    db: 'control',
    sql: 'SELECT id, organization_id, name, slug FROM projects WHERE id = $1',
    params: ['00000000-0000-0000-0000-000000000002'],
  },
  [DB_QUERY_NAMES.TRACES_GET_BY_ID]: {
    db: 'telemetry',
    sql: 'SELECT * FROM spans WHERE trace_id = $1 ORDER BY start_time ASC LIMIT 500',
    params: ['trace_sample_uuid'],
  },
  [DB_QUERY_NAMES.DASHBOARD_WIDGET_ROLLUP]: {
    db: 'telemetry',
    sql: `SELECT time_bucket('1 minute', timestamp) AS bucket, count(*) AS count
          FROM events
          WHERE timestamp > NOW() - INTERVAL '1 hour'
          GROUP BY bucket
          ORDER BY bucket ASC`,
    params: [],
  },
};

const MUTATION_REGEX = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i;

function parseArgs(): {
  queryName?: string;
  customSql?: string;
  customParams?: unknown[];
  analyze: boolean;
  allowWrites: boolean;
  db?: 'control' | 'telemetry';
} {
  const args = process.argv.slice(2);
  let queryName: string | undefined;
  let customSql: string | undefined;
  let customParams: unknown[] | undefined;
  let analyze = false;
  let allowWrites = false;
  let db: 'control' | 'telemetry' | undefined;

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      queryName = arg.split('=')[1];
    } else if (arg.startsWith('--sql=')) {
      customSql = arg.slice(6);
    } else if (arg.startsWith('--params=')) {
      try {
        customParams = JSON.parse(arg.slice(9));
      } catch {
        console.error('Invalid JSON for --params');
      }
    } else if (arg === '--analyze') {
      analyze = true;
    } else if (arg === '--allow-writes') {
      allowWrites = true;
    } else if (arg.startsWith('--db=')) {
      const val = arg.split('=')[1];
      if (val === 'telemetry' || val === 'control') db = val;
    }
  }

  return { queryName, customSql, customParams, analyze, allowWrites, db };
}

async function runExplain(): Promise<void> {
  const { queryName, customSql, customParams, analyze, allowWrites, db: overrideDb } = parseArgs();

  let sql = customSql;
  let params = customParams ?? [];
  let db: 'control' | 'telemetry' = overrideDb ?? 'control';

  if (queryName) {
    const template = QUERY_TEMPLATES[queryName];
    if (template) {
      sql = template.sql;
      params = template.params;
      db = overrideDb ?? template.db;
    } else {
      console.warn(`Query name '${queryName}' has no built-in template; specify --sql instead.`);
    }
  }

  if (!sql) {
    console.error('Usage Error: Must specify --query=<name> or --sql="<SQL>"');
    console.log('Available registered templates:');
    for (const name of Object.keys(QUERY_TEMPLATES)) {
      console.log(`  - ${name}`);
    }
    process.exit(1);
  }

  const targetPool = db === 'telemetry' ? logDB.getPrimaryPool() : pool;
  const isMutation = MUTATION_REGEX.test(sql);
  const client = await targetPool.connect();

  console.log(`\n================================================================================`);
  console.log(` EXPLAIN PLAN EXECUTION`);
  console.log(` DB: ${db.toUpperCase()} | Analyze: ${analyze} | Mutation Guard: ${isMutation && !allowWrites ? 'ACTIVE (BEGIN..ROLLBACK)' : 'OFF'}`);
  console.log(`================================================================================\n`);
  console.log(`SQL: ${sql}\n`);
  if (params.length > 0) {
    console.log(`Parameters: ${JSON.stringify(params)}\n`);
  }

  try {
    const explainPrefix = analyze
      ? 'EXPLAIN (ANALYZE, BUFFERS, SETTINGS, WAL, FORMAT TEXT)'
      : 'EXPLAIN (BUFFERS, SETTINGS, FORMAT TEXT)';

    const fullSql = `${explainPrefix} ${sql}`;

    let result;
    if (analyze && isMutation && !allowWrites) {
      console.log('⚠️  Mutation detected under ANALYZE. Executing inside safe BEGIN ... ROLLBACK transaction.\n');
      await client.query('BEGIN');
      try {
        result = await client.query(fullSql, params);
      } finally {
        await client.query('ROLLBACK');
      }
    } else {
      result = await client.query(fullSql, params);
    }

    console.log('--- EXECUTION PLAN ---');
    for (const row of result.rows) {
      console.log(row['QUERY PLAN'] ?? Object.values(row)[0]);
    }
    console.log('\n================================================================================\n');
  } catch (err: any) {
    console.error('EXPLAIN query execution failed:', err.message || err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end().catch(() => {});
    await logDB.close().catch(() => {});
  }
}

void runExplain().catch((err) => {
  console.error('Explain runner failed:', err);
  process.exit(1);
});
