import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('LogDB Modular Schema & Proper Indexing', () => {
  const root = process.cwd();
  const draftDir = path.resolve(root, 'src/db/postgres/log_db_draft');
  const schemaV2Dir = path.resolve(root, 'database/logdbv2/schema');
  const schemaSqlPath = path.resolve(root, 'database/logdbv2/schema.sql');
  const upSqlPath = path.resolve(root, 'database/logdbv2/migrations/000001_create_schema.up.sql');

  const expectedDomains = [
    '00_extensions',
    '01_types',
    '02_schema_notes',
    '03_lookup',
    '04_ingestion',
    '05_observability',
    '06_error_groups',
    '07_analytics',
    '08_connectors',
    '09_alerting',
    '10_ai',
    '11_outbox',
    '12_search',
    '13_geo',
    '14_retention',
    '15_functions',
  ];

  it('contains all 16 modular domain folders in database/logdbv2/schema', () => {
    for (const domain of expectedDomains) {
      expect(fs.existsSync(path.join(schemaV2Dir, domain))).toBe(true);
    }
  });

  it('compiles schema.sql and migrations/000001_create_schema.up.sql identically from modular sources', () => {
    expect(fs.existsSync(schemaSqlPath)).toBe(true);
    expect(fs.existsSync(upSqlPath)).toBe(true);

    const schemaSql = fs.readFileSync(schemaSqlPath, 'utf8');
    const upSql = fs.readFileSync(upSqlPath, 'utf8');
    expect(schemaSql).toBe(upSql);
    expect(schemaSql.length).toBeGreaterThan(100000);
  });

  it('ensures all canonical event tables have range partitioning and default partitions', () => {
    const canonicalEvents = [
      'events_requests',
      'events_errors',
      'events_logs',
      'events_metrics',
      'events_spans',
      'events_traces',
      'events_messages',
      'events_profiles',
      'events_replays',
      'events_cron_checkins',
    ];

    const obsDir = path.join(schemaV2Dir, '05_observability');
    for (const tbl of canonicalEvents) {
      const file = path.join(obsDir, `001_create_${tbl}.sql`.replace('001_', tbl === 'events_cron_checkins' ? '010_' : `00${canonicalEvents.indexOf(tbl) + 1}_`));
      expect(fs.existsSync(file)).toBe(true);
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain(`PARTITION BY RANGE (occurred_at)`);
      expect(content).toContain(`CREATE TABLE IF NOT EXISTS ${tbl}_default PARTITION OF ${tbl} DEFAULT;`);
      const hasTenantEnvTime = content.includes(`_tenant_env_time`) || content.includes(`_org_env_time`);
      expect(hasTenantEnvTime).toBe(true);
      expect(content).toContain(`idx_${tbl}_occurred_brin`);
    }
  });

  it('incorporates high-performance hot-path indexes on events_spans', () => {
    const spansFile = path.join(schemaV2Dir, '05_observability/005_create_events_spans.sql');
    const content = fs.readFileSync(spansFile, 'utf8');

    expect(content).toContain('idx_events_spans_org_trace_time_asc');
    expect(content).toContain('idx_events_spans_org_span_id');
    expect(content).toContain('idx_events_spans_slow_db');
    expect(content).toContain('idx_events_spans_db_collection');
    expect(content).toContain('idx_events_spans_org_session_time');
  });

  it('omits dropped write-amplification GIN indexes on unqueried JSONB columns', () => {
    const requestsFile = path.join(schemaV2Dir, '05_observability/001_create_events_requests.sql');
    const content = fs.readFileSync(requestsFile, 'utf8');

    expect(content).not.toContain('idx_events_requests_payload_gin');
    expect(content).not.toContain('idx_events_requests_attributes_gin');
    expect(content).not.toContain('idx_events_requests_metadata_gin');
  });

  it('attaches proper sync triggers and fast-path contract function', () => {
    const fnFile = path.join(schemaV2Dir, '15_functions/001_functions.sql');
    const fnContent = fs.readFileSync(fnFile, 'utf8');
    expect(fnContent).toContain('logdb_sync_typed_event_contract');
    expect(fnContent).toContain('logdb_sync_error_groups_contract');
    expect(fnContent).toContain('logdb_sync_user_sessions_contract');
    expect(fnContent).toContain('logdb_set_updated_at');

    const triggersFile = path.join(schemaV2Dir, '05_observability/999_triggers.sql');
    const trgContent = fs.readFileSync(triggersFile, 'utf8');
    expect(trgContent).toContain('BEFORE INSERT ON');
    expect(trgContent).toContain('logdb_sync_typed_event_contract');
  });
});
