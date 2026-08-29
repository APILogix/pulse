/**
 * `031_remaining_jsonb_gin_hot_path.sql` — closes the gap left by the earlier
 * hot-path remediations (`025_request_ingestion_hot_path.sql`,
 * `029_span_log_ingestion_hot_path.sql`), which dropped the broad
 * attributes/metadata/payload/ai_response GIN indexes on events_requests,
 * events_spans, and events_logs but missed the identical index class on
 * events_errors, events_metrics, events_traces, events_messages,
 * events_profiles, events_replays, and events_cron_checkins.
 *
 * These assertions are static (read the migration file, do not touch a live
 * database), mirroring the existing pattern in logdb-trigger-contract.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

describe('031_remaining_jsonb_gin_hot_path.sql', () => {
  const migrationsDir = path.resolve(process.cwd(), 'database/migrations/logdb/03_observability_v2');
  const sql = readFileSync(path.join(migrationsDir, '031_remaining_jsonb_gin_hot_path.sql'), 'utf8');

  const expectedDrops = [
    // events_errors
    'idx_events_errors_context_gin',
    'idx_events_errors_tags_gin',
    'idx_events_errors_extra_gin',
    'idx_events_errors_metadata_gin',
    'idx_events_errors_payload_gin',
    'idx_events_errors_ai_response_gin',
    // events_metrics
    'idx_events_metrics_attributes_gin',
    'idx_events_metrics_metadata_gin',
    'idx_events_metrics_payload_gin',
    'idx_events_metrics_ai_response_gin',
    // events_traces
    'idx_events_traces_attributes_gin',
    'idx_events_traces_metadata_gin',
    'idx_events_traces_payload_gin',
    'idx_events_traces_ai_response_gin',
    // events_messages
    'idx_events_messages_attributes_gin',
    'idx_events_messages_metadata_gin',
    'idx_events_messages_payload_gin',
    'idx_events_messages_ai_response_gin',
    // events_profiles
    'idx_events_profiles_attributes_gin',
    'idx_events_profiles_metadata_gin',
    'idx_events_profiles_payload_gin',
    'idx_events_profiles_ai_response_gin',
    // events_replays
    'idx_events_replays_attributes_gin',
    'idx_events_replays_metadata_gin',
    'idx_events_replays_payload_gin',
    'idx_events_replays_ai_response_gin',
    // events_cron_checkins
    'idx_events_cron_checkins_attributes_gin',
    'idx_events_cron_checkins_metadata_gin',
    'idx_events_cron_checkins_payload_gin',
    'idx_events_cron_checkins_ai_response_gin',
  ] as const;

  it('drops exactly the 30 remaining metadata/payload/attributes/ai_response GIN indexes, one IF EXISTS statement each', () => {
    for (const indexName of expectedDrops) {
      expect(sql).toContain(`DROP INDEX IF EXISTS ${indexName};`);
    }
    const dropStatementCount = (sql.match(/DROP INDEX IF EXISTS/g) ?? []).length;
    expect(dropStatementCount).toBe(expectedDrops.length);
  });

  it('does not touch tenant/time/unique/BRIN indexes on any of the seven tables', () => {
    // Non-GIN index name fragments that must be preserved (spot-check one per table).
    const mustNotDrop = [
      'idx_events_errors_event_unique',
      'idx_events_metrics_tenant_time',
      'idx_events_traces_tenant_time',
      'idx_events_messages_tenant_time',
      'idx_events_profiles_tenant_time',
      'idx_events_replays_tenant_time',
      'idx_events_cron_checkins_tenant_time',
    ];
    for (const indexName of mustNotDrop) {
      expect(sql).not.toContain(`DROP INDEX IF EXISTS ${indexName}`);
    }
  });

  it('does not touch the events_requests/events_spans/events_logs indexes already handled by 025/029', () => {
    expect(sql).not.toContain('idx_events_requests_');
    expect(sql).not.toContain('idx_events_spans_');
    expect(sql).not.toContain('idx_events_logs_');
  });

  it('wraps the drops in an explicit transaction (matches 025/029 convention)', () => {
    expect(sql.trim().toUpperCase().startsWith('BEGIN;')).toBe(true);
    expect(sql).toContain('COMMIT;');
  });

  it('does not attempt DROP INDEX CONCURRENTLY as an executable statement (rejected on partitioned parent indexes)', () => {
    // Strip `-- ` line comments before checking, since the migration's own
    // explanatory comment mentions "DROP INDEX CONCURRENTLY" as prose.
    const executableSql = sql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n');
    expect(executableSql).not.toMatch(/DROP INDEX CONCURRENTLY/i);
  });
});
