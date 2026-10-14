/**
 * Applies exactly one Log DB migration file and records it in logdb_migrations.
 *
 * Why this exists instead of `npm run db:migrate:logdb`:
 *   The full Log DB runner applies files in filename order and currently halts at
 *   an UNRELATED pending migration, 03_observability_v2/030_events_logs_idempotency.up.sql,
 *   which intentionally refuses to run without a confirmed ingestion drain
 *   (pulse.events_logs_identity_drain_confirmed). That guard protects ingestion
 *   data integrity and must NOT be bypassed. This script applies a single named
 *   migration below that blocking point, and records it exactly like the real
 *   runner would (same `logdb_migrations` table, same filename key), so the real
 *   runner will see it as already-applied once it's eventually able to run past
 *   the ingestion guard.
 *
 * Usage: node scripts/apply-single-logdb-migration.cjs <relative-path-under-database/migrations/logdb>
 * Idempotent: safe to run repeatedly.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const REL = process.argv[2];
if (!REL) {
  console.error('Usage: node scripts/apply-single-logdb-migration.cjs <relative-path>');
  process.exit(1);
}
const FILE = path.resolve(__dirname, '..', 'database/migrations/logdb', REL);

(async () => {
  const sql = fs.readFileSync(FILE, 'utf8');
  const c = new Client({ connectionString: process.env.LOG_DB_PRIMARY, ssl: { rejectUnauthorized: false } });
  await c.connect();

  await c.query(`CREATE TABLE IF NOT EXISTS logdb_migrations (
    id SERIAL PRIMARY KEY,
    filename TEXT NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INTEGER
  )`);

  const already = await c.query('SELECT 1 FROM logdb_migrations WHERE filename = $1', [REL]);
  if (already.rows.length > 0) {
    console.log(`SKIP: ${REL} already recorded as applied`);
  } else {
    const t0 = Date.now();
    await c.query(sql);
    await c.query(
      `INSERT INTO logdb_migrations (filename, applied_at, duration_ms) VALUES ($1, NOW(), $2)
       ON CONFLICT (filename) DO NOTHING`,
      [REL, Date.now() - t0],
    );
    console.log(`APPLIED: ${REL} (${Date.now() - t0}ms)`);
  }

  await c.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
