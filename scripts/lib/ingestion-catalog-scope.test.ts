import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  AUXILIARY_INGESTION_TABLES,
  CANONICAL_EVENT_TABLES,
  GLOSSARY_GUARD_INDEXES,
  INGESTION_TABLE_SET,
  PRIOR_PHASE_INDEX_REMOVALS,
  PRIOR_PHASE_MIGRATION_FILES,
  priorPhaseRemovedIndexNames,
} from './ingestion-catalog-scope.js';

const LOGDB_MIGRATIONS_DIR = 'database/migrations/logdb/';

/** Every `DROP INDEX [IF EXISTS] <name>;` in a migration file, in statement order. */
function droppedIndexNames(relativePath: string): string[] {
  const sql = readFileSync(`${LOGDB_MIGRATIONS_DIR}${relativePath}`, 'utf8');
  return [...sql.matchAll(/DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?([A-Za-z0-9_.]+)\s*;/gi)]
    .map((match) => match[1] ?? '');
}

/** Every `CREATE [UNIQUE] INDEX [IF NOT EXISTS] <name>` in a migration file. */
function createdIndexNames(relativePath: string): string[] {
  const sql = readFileSync(`${LOGDB_MIGRATIONS_DIR}${relativePath}`, 'utf8');
  return [...sql.matchAll(/CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z0-9_.]+)/gi)]
    .map((match) => match[1] ?? '');
}

describe('INGESTION_TABLE_SET', () => {
  it('covers the ten Canonical_Event_Tables plus the six auxiliary relations', () => {
    expect(CANONICAL_EVENT_TABLES).toHaveLength(10);
    expect(AUXILIARY_INGESTION_TABLES).toHaveLength(6);
    expect(INGESTION_TABLE_SET).toHaveLength(16);
    expect(new Set(INGESTION_TABLE_SET).size).toBe(16);
  });

  it('includes error_group_history, which the previous audit table list omitted', () => {
    expect(INGESTION_TABLE_SET).toContain('error_group_history');
  });

  it('omits events_errors_idempotency, which is an index rather than a relation', () => {
    expect(INGESTION_TABLE_SET).not.toContain('events_errors_idempotency');
    expect(GLOSSARY_GUARD_INDEXES.map((guard) => guard.glossaryTerm))
      .toContain('events_errors_idempotency');
  });
});

describe('GLOSSARY_GUARD_INDEXES', () => {
  it('resolves events_errors_idempotency to an index its origin migration actually creates', () => {
    for (const guard of GLOSSARY_GUARD_INDEXES) {
      expect(createdIndexNames(guard.originMigrationFile)).toContain(guard.indexName);
    }
  });

  it('records a uniqueness or idempotency requirement, which Requirement 4.9 locks to KEEP', () => {
    for (const guard of GLOSSARY_GUARD_INDEXES) {
      expect(guard.requirements.length).toBeGreaterThan(0);
      expect(guard.table).not.toBe(guard.glossaryTerm);
    }
  });
});

describe('PRIOR_PHASE_INDEX_REMOVALS', () => {
  it('matches every DROP INDEX statement in 025, 028 and 029, in file and statement order', () => {
    const fromMigrations = PRIOR_PHASE_MIGRATION_FILES.flatMap((file) =>
      droppedIndexNames(file).map((indexName) => `${indexName}@${file}`));
    const fromList = PRIOR_PHASE_INDEX_REMOVALS.map(
      (removal) => `${removal.indexName}@${removal.migrationFile}`);

    // 4 in 025, 10 in 028, 10 in 029. Design §4.1 says "eighteen"; the files say 24.
    expect(fromMigrations).toHaveLength(24);
    expect(fromList).toEqual(fromMigrations);
  });

  it('records each entry against the table its index name is scoped to', () => {
    for (const removal of PRIOR_PHASE_INDEX_REMOVALS) {
      expect(removal.indexName.startsWith(`idx_${removal.table}_`)).toBe(true);
    }
  });

  it('derives the events_requests subset the evidence-bundle check needs', () => {
    // The 14 names the validator's forbiddenRequestHotPathIndexes list carried
    // before it was rewired to this module: 025 plus 028, no 029.
    expect(priorPhaseRemovedIndexNames('events_requests')).toEqual([
      'idx_events_requests_payload_gin',
      'idx_events_requests_ai_response_gin',
      'idx_events_requests_metadata_gin',
      'idx_events_requests_attributes_gin',
      'idx_events_requests_tenant_env_time',
      'idx_events_requests_user_time',
      'idx_events_requests_trace',
      'idx_events_requests_service',
      'idx_events_requests_endpoint_time',
      'idx_events_requests_duration_time',
      'idx_events_requests_geo_time',
      'idx_events_requests_release_time',
      'idx_events_requests_session_time',
      'idx_events_requests_sdk_time',
    ]);
  });

  it('returns every name when no table scope is given', () => {
    expect(priorPhaseRemovedIndexNames()).toHaveLength(PRIOR_PHASE_INDEX_REMOVALS.length);
    expect(priorPhaseRemovedIndexNames('events_spans')).toHaveLength(4);
    expect(priorPhaseRemovedIndexNames('events_logs')).toHaveLength(6);
  });
});
