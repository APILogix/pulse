import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('LogDB Trigger Contract Migrations', () => {
  const migrationsDir = path.resolve(process.cwd(), 'database/migrations/logdb/03_observability_v2');

  it('023_fix_error_groups_trigger_contract.sql properly drops trg_sync_typed_event_contract from error_groups', () => {
    const sql = readFileSync(path.join(migrationsDir, '023_fix_error_groups_trigger_contract.sql'), 'utf8');

    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON error_groups');
    expect(sql).toContain('DROP TRIGGER IF EXISTS trg_sync_typed_event_contract ON analytics_error_groups');
    expect(sql).toContain('logdb_sync_error_groups_contract');
    expect(sql).toContain('CREATE TRIGGER trg_sync_error_groups_contract');
    expect(sql).not.toContain('NEW.occurred_at :='); // Must not try to access occurred_at on error_groups
  });

  it('999_typed_event_contract.sql only attaches typed event contract to canonical events_* tables', () => {
    const sql = readFileSync(path.join(migrationsDir, '999_typed_event_contract.sql'), 'utf8');

    expect(sql).toContain('events_requests');
    expect(sql).toContain('events_errors');
    expect(sql).toContain('events_logs');
    expect(sql).toContain('events_metrics');
    expect(sql).toContain('events_spans');
    expect(sql).toContain('events_traces');
    expect(sql).not.toMatch(/'error_groups'/);
    expect(sql).not.toMatch(/'analytics_error_groups'/);
  });
});
