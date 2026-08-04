import { Pool } from 'pg';
import { env } from '../src/config/env.js';

const tables = [
  'alert_rules', 'alert_rule_conditions', 'alert_events',
  'events_requests', 'events_errors', 'events_logs', 'events_metrics', 'events_cron_checkins',
  'ai_usage_logs', 'project_usage_minute', 'project_alert_thresholds', 'project_environments',
];

async function probe(cs: string, label: string) {
  const pool = new Pool({ connectionString: cs, max: 2 });
  try {
    const db = (await pool.query<{ d: string }>('SELECT current_database() AS d')).rows[0]!.d;
    const rows = await pool.query<{ t: string }>(
      `SELECT t FROM unnest($1::text[]) AS t WHERE to_regclass(t) IS NOT NULL`,
      [tables],
    );
    const present = new Set(rows.rows.map((r) => r.t));
    console.log(`WHERE|${label}|${db}|${tables.map((t) => `${t}=${present.has(t) ? 'Y' : '-'}`).join(' ')}`);
  } finally {
    await pool.end();
  }
}

await probe(env.DATABASE_URL, 'primary');
await probe(env.LOG_DB_PRIMARY ?? env.DATABASE_URL, 'logdb');
