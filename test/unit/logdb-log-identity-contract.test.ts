import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import {
  acquireLogDbMigrationLock,
  applyLogDbMigrations,
} from '../../src/shared/logdb/migrations.js';

const MIGRATION_FILENAME = '03_observability_v2/030_events_logs_idempotency.up.sql';
const UP_PATH = resolve('database/migrations/logdb', MIGRATION_FILENAME);
const DOWN_PATH = resolve(
  'database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.down.sql',
);
const ROLLBACK_RUNNER_PATH = resolve('scripts/logdb-rollback.ts');
const MIGRATE_RUNNER_PATH = resolve('scripts/migrate-logdb.ts');
const WORKER_MAIN_PATH = resolve('src/shared/workers/ingestion-worker-main.ts');

function createMigrationHarness() {
  const client = {
    query: vi.fn(async (query: string) => {
      if (query.includes('pg_try_advisory_lock')) {
        return { rows: [{ acquired: true }] };
      }
      if (query.includes('SELECT id FROM logdb_migrations')) {
        return { rows: [] };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  const pool = {
    connect: vi.fn().mockResolvedValue(client),
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };

  return { client, logger, pool };
}

describe('events_logs identity migration contract', () => {
  it('requires a drained writer path and rejects scoped duplicates before creating the index', async () => {
    const sql = await readFile(UP_PATH, 'utf8');

    expect(sql).toMatch(
      /^BEGIN;\s*--\s*codex-logdb-migration:\s*requires-operator-drain\b/i,
    );
    expect(sql).toMatch(/SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/current_setting\(\s*'pulse\.events_logs_identity_drain_confirmed'\s*,\s*true\s*\)/i);
    expect(sql).toMatch(/ERRCODE\s*=\s*'55000'/i);
    expect(sql).toMatch(
      /GROUP BY\s+organization_id,\s*project_id,\s*environment,\s*event_id,\s*occurred_at/i,
    );
    expect(sql).toMatch(/HAVING\s+COUNT\(\*\)\s*>\s*1/i);
    expect(sql).toMatch(/ERRCODE\s*=\s*'23505'/i);
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique\s+ON events_logs\s*\(\s*organization_id,\s*project_id,\s*environment,\s*event_id,\s*occurred_at\s*\)/i,
    );
    expect(sql).not.toMatch(/DELETE\s+FROM\s+events_logs/i);
    expect(sql.indexOf("ERRCODE = '55000'")).toBeLessThan(
      sql.indexOf('GROUP BY organization_id, project_id, environment, event_id, occurred_at'),
    );
    expect(sql.indexOf("ERRCODE = '23505'")).toBeLessThan(
      sql.indexOf('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique'),
    );
  });

  it('defers the operator-drained migration during worker startup but executes it in operator mode', async () => {
    const automatic = createMigrationHarness();
    const automaticResult = await applyLogDbMigrations(automatic.pool as never, {
      executionMode: 'automatic',
      logger: automatic.logger as never,
      only: [MIGRATION_FILENAME],
    });
    const automaticQueries = automatic.client.query.mock.calls.map(([query]) => query);

    expect(automaticResult).toMatchObject({
      found: 1,
      applied: 0,
      skipped: 1,
      deferred: 1,
      failed: 0,
    });
    expect(
      automaticQueries.some((query) =>
        query.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique'),
      ),
    ).toBe(false);
    expect(
      automaticQueries.some((query) => query.includes('INSERT INTO logdb_migrations')),
    ).toBe(false);
    expect(automatic.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ migration: MIGRATION_FILENAME, executionMode: 'automatic' }),
      'Operator-drained Log DB migration deferred during automatic startup',
    );
    expect(automatic.client.release).toHaveBeenCalledOnce();

    const operator = createMigrationHarness();
    const operatorResult = await applyLogDbMigrations(operator.pool as never, {
      executionMode: 'operator',
      logger: operator.logger as never,
      only: [MIGRATION_FILENAME],
    });
    const operatorQueries = operator.client.query.mock.calls.map(([query]) => query);

    expect(operatorResult).toMatchObject({
      found: 1,
      applied: 1,
      skipped: 0,
      deferred: 0,
      failed: 0,
    });
    expect(
      operatorQueries.some((query) =>
        query.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_events_logs_event_unique'),
      ),
    ).toBe(true);
    expect(
      operatorQueries.some((query) => query.includes('INSERT INTO logdb_migrations')),
    ).toBe(true);
    expect(operator.client.release).toHaveBeenCalledOnce();

    const workerMain = await readFile(WORKER_MAIN_PATH, 'utf8');
    expect(workerMain).toMatch(/executionMode:\s*'automatic'/);

    const migrationRunner = await readFile(MIGRATE_RUNNER_PATH, 'utf8');
    expect(migrationRunner).toMatch(/executionMode:\s*'operator'/);
  });

  it('requires the same drain gate before rolling back only the new index and ledger entry', async () => {
    const sql = await readFile(DOWN_PATH, 'utf8');

    expect(sql).toMatch(/SET\s+LOCAL\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/current_setting\(\s*'pulse\.events_logs_identity_drain_confirmed'\s*,\s*true\s*\)/i);
    expect(sql).toMatch(/ERRCODE\s*=\s*'55000'/i);
    expect(sql).toMatch(/DROP INDEX IF EXISTS idx_events_logs_event_unique/i);
    expect(sql).not.toMatch(/DROP INDEX IF EXISTS idx_events_logs_event\s*;/i);
    expect(sql).toContain(
      "WHERE filename = '03_observability_v2/030_events_logs_idempotency.up.sql'",
    );
    expect(sql).not.toMatch(/DELETE\s+FROM\s+events_logs/i);
    expect(sql.indexOf("ERRCODE = '55000'")).toBeLessThan(
      sql.indexOf('DROP INDEX IF EXISTS idx_events_logs_event_unique'),
    );
  });

  it('serializes forward and rollback operations with the same fail-fast advisory lock', async () => {
    const grantedClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: true }] }),
    };
    await expect(acquireLogDbMigrationLock(grantedClient as never)).resolves.toBeUndefined();
    expect(grantedClient.query).toHaveBeenCalledWith(
      'SELECT pg_try_advisory_lock($1) AS acquired',
      [74_373_201],
    );

    const deniedClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ acquired: false }] }),
    };
    await expect(acquireLogDbMigrationLock(deniedClient as never)).rejects.toThrow(
      'Another Log DB migration or rollback already holds the migration lock',
    );

    const rollbackRunner = await readFile(ROLLBACK_RUNNER_PATH, 'utf8');
    expect(rollbackRunner).toMatch(/await acquireLogDbMigrationLock\(client\)/);
    expect(rollbackRunner).toMatch(/await releaseLogDbMigrationLock\(client\)/);
    expect(rollbackRunner).toMatch(/await client\.query\(sql\)/);
  });
});
