import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';
import { acquireLogDbMigrationLock } from '../../src/shared/logdb/migrations.js';

const UP_PATH = resolve(
  'database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.up.sql',
);
const DOWN_PATH = resolve(
  'database/migrations/logdb/03_observability_v2/030_events_logs_idempotency.down.sql',
);
const ROLLBACK_RUNNER_PATH = resolve('scripts/logdb-rollback.ts');

describe('events_logs identity migration contract', () => {
  it('requires a drained writer path and rejects scoped duplicates before creating the index', async () => {
    const sql = await readFile(UP_PATH, 'utf8');

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
