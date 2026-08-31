/**
 * Disposable LOG-DB harness for the alerting -> automation bridge integration tests.
 *
 * IMPORTANT — WHY THIS TARGETS THE PRIMARY NEON HOST, NOT LOG_DB_PRIMARY:
 *   At the time this bridge was built, the real LOG_DB_PRIMARY Neon project was
 *   AT its 512 MB storage quota — plain single-row INSERTs into telemetry_outbox
 *   and even the pre-existing alert_events_v2 table were failing live with
 *   "could not extend file because project size limit has been exceeded". Every
 *   write (even inside a transaction that is later rolled back) generates WAL on
 *   that project, so running `CREATE DATABASE` / scratch-DB integration tests
 *   there would make an already-exhausted production storage incident worse.
 *
 *   DATABASE_URL (the PRIMARY control-plane Neon project) is a COMPLETELY
 *   SEPARATE Neon project/host with healthy headroom (~135 MB at the time of
 *   writing). This harness creates its scratch databases there instead, and
 *   applies the REAL, unmodified Log DB migration files from
 *   database/migrations/logdb/ against that disposable database. The resulting
 *   schema is byte-for-byte what LOG_DB_PRIMARY would have if its own quota were
 *   not exhausted — the same files, the same runner logic
 *   (applyLogDbMigrations from src/shared/logdb/migrations.ts) — so these tests
 *   fail if the migrations and the repository/relay SQL ever drift apart, same
 *   as automation-scratch.ts does for the automation runtime tables.
 *
 *   If/when LOG_DB_PRIMARY's storage is resolved, this harness can be pointed at
 *   it directly by swapping the source URL — nothing else changes.
 */
import { Pool } from 'pg';
import { applyLogDbMigrations, LOGDB_MIGRATIONS_DIR } from '../../src/shared/logdb/migrations.js';

export interface LogDbScratch {
  readonly pool: Pool;
  readonly dbName: string;
  destroy(): Promise<void>;
}

function swapDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

/**
 * A server we can safely CREATE DATABASE on for Log-DB-shaped scratch tests.
 * Deliberately DATABASE_URL (healthy Primary host), never LOG_DB_PRIMARY — see
 * the module doc comment above.
 */
export function logDbScratchAvailable(): boolean {
  return typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.length > 0;
}

export async function createLogDbScratch(prefix = 'logdb_it'): Promise<LogDbScratch> {
  const sourceUrl = process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error('DATABASE_URL is required for Log DB scratch integration tests');

  const dbName = `${prefix}_${Date.now()}`;
  const adminPool = new Pool({
    connectionString: swapDatabase(sourceUrl, 'postgres'),
    ssl: { rejectUnauthorized: false },
    max: 1,
  });
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const pool = new Pool({
    connectionString: swapDatabase(sourceUrl, dbName),
    ssl: { rejectUnauthorized: false },
    max: 6,
  });

  return {
    pool,
    dbName,
    async destroy() {
      await pool.end().catch(() => undefined);
      await adminPool.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [dbName],
      );
      await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
      await adminPool.end().catch(() => undefined);
    },
  };
}

/**
 * Apply every real Log DB migration file (00_shared through the folder that
 * created the alert-domain-event bridge) using the project's own
 * applyLogDbMigrations runner, in 'operator' mode so nothing is silently
 * deferred (there is no populated data to protect on a fresh scratch DB, so
 * the drain-gated 030_events_logs_idempotency.up.sql guard is a safe no-op:
 * the table it protects starts empty).
 */
export async function applyLogDbBridgeMigrations(pool: Pool): Promise<void> {
  const result = await applyLogDbMigrations(pool, { executionMode: 'operator' });
  if (result.failed > 0) {
    throw new Error(`Log DB scratch migration failed (see ${LOGDB_MIGRATIONS_DIR})`);
  }
}

export interface LogDbFixtures {
  orgId: string;
  otherOrgId: string;
}

/** Two organizations so cross-tenant outbox/claim behavior can be tested for real. */
export function makeLogDbFixtures(): LogDbFixtures {
  return {
    orgId: '11111111-1111-4111-8111-111111111111',
    otherOrgId: '22222222-2222-4222-8222-222222222222',
  };
}
