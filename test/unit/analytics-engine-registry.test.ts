import type { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  AnalyticsRegistryError,
  assertRegistryInvariants,
  buildAnalyticsWorkers,
  resolveAnalyticsConfig,
  rollupOwnership,
} from '../../src/modules/analytics-engine/registry.js';
import {
  buildInsertSelect,
  buildUpsert,
  chunkRows,
  chunkSize,
  keyColumnsFor,
} from '../../src/modules/analytics-engine/rollup-writer.js';
import {
  buildBucketRecomputeSql,
} from '../../src/modules/analytics-engine/workers/base.js';
import {
  ALL_ENVIRONMENTS_SENTINEL,
  ALL_PROJECTS_SENTINEL,
  type AnalyticsWorkerSpec,
} from '../../src/modules/analytics-engine/types.js';
import { COMPACTION_TARGETS, mergeExpressionFor } from '../../src/modules/analytics-engine/workers/compaction.worker.js';
import { retentionTargets } from '../../src/modules/analytics-engine/workers/maintenance.worker.js';

/**
 * The registry only stores the pool on the repository; nothing queries during
 * construction, so a stub is sufficient and keeps this a pure unit test.
 */
const stubPool = {} as Pool;

function workers(): AnalyticsWorkerSpec[] {
  return buildAnalyticsWorkers(stubPool).workers;
}

describe('analytics engine — registry invariants', () => {
  it('builds the registry without violating ownership rules', () => {
    expect(() => buildAnalyticsWorkers(stubPool)).not.toThrow();
  });

  it('gives every rollup table exactly one writing worker', () => {
    const owners = rollupOwnership(workers());
    const declared = workers().flatMap((worker) => worker.outputTables);
    // No table appears twice across all workers.
    expect(new Set(declared).size).toBe(declared.length);
    expect(owners.get('request_metrics_1m')).toBe('analytics.requests');
    expect(owners.get('endpoint_metrics_1m')).toBe('analytics.endpoints');
    expect(owners.get('analytics_error_groups')).toBe('analytics.errors');
    expect(owners.get('trace_edge_metrics_1h')).toBe('analytics.traces');
    expect(owners.get('cron_monitor_state')).toBe('analytics.crons');
    expect(owners.get('geo_metrics_1h')).toBe('analytics.geo');
    expect(owners.get('device_metrics_1h')).toBe('analytics.geo');
    expect(owners.get('release_comparison')).toBe('analytics.releases');
    expect(owners.get('profile_function_metrics_1h')).toBe('analytics.profiles');
    expect(owners.get('replay_metrics_1h')).toBe('analytics.replays');
    expect(owners.get('ai_metrics_1m')).toBe('analytics.ai');
  });

  it('declares the expected worker set for the current wave', () => {
    const ids = workers().map((worker) => worker.id).sort();
    expect(ids).toEqual(
      [
        'analytics.ai',
        'analytics.crons',
        'analytics.endpoints',
        'analytics.errors',
        'analytics.geo',
        'analytics.logs',
        'analytics.metrics',
        'analytics.profiles',
        'analytics.releases',
        'analytics.replays',
        'analytics.requests',
        'analytics.runtime',
        'analytics.sdk',
        'analytics.services',
        'analytics.spans',
        'analytics.traces',
      ].sort(),
    );
  });

  it('has unique worker ids and queue names matching the ids', () => {
    const list = workers();
    expect(new Set(list.map((worker) => worker.id)).size).toBe(list.length);
    for (const worker of list) expect(worker.queue).toBe(worker.id);
  });

  it('only reads canonical Log DB source tables', () => {
    for (const worker of workers()) {
      for (const table of worker.sourceTables) {
        expect(table.startsWith('events_') || table.startsWith('ai_')).toBe(true);
      }
    }
  });

  it('never writes a table it also reads', () => {
    for (const worker of workers()) {
      for (const table of worker.outputTables) {
        expect(worker.sourceTables).not.toContain(table);
      }
    }
  });

  it('rejects two workers writing the same table', () => {
    const list = workers();
    const clone: AnalyticsWorkerSpec = {
      ...list[0]!,
      id: 'analytics.endpoints',
      queue: 'analytics.endpoints',
    };
    expect(() => assertRegistryInvariants([list[0]!, clone])).toThrow(AnalyticsRegistryError);
  });

  it('rejects a control-plane source table', () => {
    const list = workers();
    const bad: AnalyticsWorkerSpec = { ...list[0]!, sourceTables: ['projects'] };
    expect(() => assertRegistryInvariants([bad])).toThrow(/control-plane source/);
  });

  it('assigns every worker to a documented dispatch tier', () => {
    for (const worker of workers()) {
      expect(['live', 'standard', 'slow', 'platform']).toContain(worker.tier);
    }
  });

  it('resolves engine configuration from validated env', () => {
    const config = resolveAnalyticsConfig();
    expect(config.batchMaxRows).toBeGreaterThan(0);
    expect(config.apdexThresholdMs).toBeGreaterThan(0);
    expect(config.maxWindowSpanMinutes).toBeGreaterThan(0);
    expect(config.lateEventGraceSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe('analytics engine — rollup writer', () => {
  it('exposes the documented key columns per shape', () => {
    expect(keyColumnsFor('A')).toEqual(['organization_id', 'project_id', 'environment', 'bucket']);
    expect(keyColumnsFor('B')).toEqual([
      'organization_id',
      'project_id',
      'environment',
      'bucket',
      'entity_key',
    ]);
  });

  it('builds an idempotent upsert that overwrites, never increments', () => {
    const built = buildUpsert(
      'request_metrics_1m',
      'A',
      ['organization_id', 'project_id', 'environment', 'bucket', 'total_count'],
      [['org', 'proj', 'production', '2026-08-01T00:00:00Z', 5]],
    );

    expect(built.sql).toContain('INSERT INTO request_metrics_1m');
    expect(built.sql).toContain(
      'ON CONFLICT (organization_id,project_id,environment,bucket) DO UPDATE',
    );
    expect(built.sql).toContain('total_count = EXCLUDED.total_count');
    expect(built.sql).toContain('updated_at = NOW()');
    // Additive merge would break replay safety.
    expect(built.sql).not.toMatch(/total_count\s*=\s*request_metrics_1m\.total_count\s*\+/);
    expect(built.values).toEqual(['org', 'proj', 'production', '2026-08-01T00:00:00Z', 5]);
  });

  it('includes entity_key in the conflict target for Shape B', () => {
    const built = buildUpsert(
      'endpoint_metrics_1m',
      'B',
      ['organization_id', 'project_id', 'environment', 'bucket', 'entity_key', 'total_count'],
      [['org', 'proj', 'production', '2026-08-01T00:00:00Z', 'abc', 1]],
    );
    expect(built.sql).toContain(
      'ON CONFLICT (organization_id,project_id,environment,bucket,entity_key) DO UPDATE',
    );
    // Keys must not be part of the SET list.
    expect(built.sql).not.toContain('entity_key = EXCLUDED.entity_key');
  });

  it('rejects unsafe identifiers', () => {
    expect(() =>
      buildUpsert('request_metrics_1m; DROP TABLE users', 'A', ['organization_id'], [[1]]),
    ).toThrow(/not a safe identifier/);
    expect(() =>
      buildUpsert('request_metrics_1m', 'A', ['total_count); --'], [[1]]),
    ).toThrow(/not a safe identifier/);
  });

  it('rejects a column list missing shape key columns', () => {
    expect(() => buildUpsert('request_metrics_1m', 'A', ['total_count'], [[1]])).toThrow(
      /missing shape A key column/,
    );
  });

  it('rejects rows whose arity does not match the column list', () => {
    expect(() =>
      buildUpsert(
        'request_metrics_1m',
        'A',
        ['organization_id', 'project_id', 'environment', 'bucket'],
        [['org', 'proj']],
      ),
    ).toThrow(/row arity/);
  });

  it('chunks rows so a statement never exceeds the bind-parameter limit', () => {
    expect(chunkSize(30)).toBe(2_000);
    const rows = Array.from({ length: 5_000 }, () => [1, 2, 3]);
    const chunks = chunkRows(rows, 3);
    expect(chunks.every((chunk) => chunk.length * 3 <= 60_000)).toBe(true);
    expect(chunks.flat()).toHaveLength(5_000);
  });

  it('builds INSERT … SELECT with the conflict clause on its own token boundary', () => {
    const sql = buildInsertSelect(
      'request_metrics_1m',
      'A',
      ['organization_id', 'project_id', 'environment', 'bucket', 'total_count'],
      'SELECT 1, 2, 3, 4, 5',
    );
    expect(sql).toContain('ON CONFLICT');
    // Regression guard: a trailing line comment in the SELECT fragment would
    // comment out ON CONFLICT and silently turn upserts into duplicate-key errors.
    const conflictIndex = sql.indexOf('ON CONFLICT');
    const lastCommentIndex = sql.lastIndexOf('--');
    expect(lastCommentIndex).toBeLessThan(0);
    expect(conflictIndex).toBeGreaterThan(0);
  });
});

describe('analytics engine — bucket recompute SQL', () => {
  const baseOptions = {
    source: 'events_requests',
    window: '1m' as const,
    columns: ['organization_id', 'project_id', 'environment', 'bucket', 'total_count'],
    aggregates: ['COUNT(*)::bigint'],
  };

  it('tracks progress on ingested_at but buckets on event time', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    expect(sql).toContain('e.ingested_at >= $2');
    expect(sql).toContain('e.ingested_at <  $3');
    expect(sql).toContain("date_trunc('minute', e.timestamp)");
  });

  it('recomputes whole buckets, not just newly ingested rows', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    // The touched CTE finds affected buckets; the outer query re-reads them fully.
    expect(sql).toContain('WITH touched AS');
    expect(sql).toContain('JOIN touched t ON');
    expect(sql).toContain('SELECT lo FROM bounds');
    expect(sql).toContain('SELECT hi FROM bounds');
  });

  it('clamps the recompute floor with the $4 grace parameter', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    expect(sql).toContain('e.timestamp   >= $4');
  });

  it('emits project and environment sentinel roll-up rows', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    expect(sql).toContain('GROUPING SETS');
    expect(sql).toContain(ALL_PROJECTS_SENTINEL);
    expect(sql).toContain(ALL_ENVIRONMENTS_SENTINEL);
    expect(sql).toContain('GROUPING(e.project_id)');
    expect(sql).toContain('GROUPING(e.environment)');
  });

  it('excludes rows without a project so the rollup key stays total', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    expect(sql).toContain('e.project_id IS NOT NULL');
  });

  it('projects entity_key and entity_label for Shape B tables', () => {
    const sql = buildBucketRecomputeSql({
      ...baseOptions,
      columns: [
        'organization_id',
        'project_id',
        'environment',
        'bucket',
        'entity_key',
        'entity_label',
        'total_count',
      ],
      entityKeyExpr: "COALESCE(e.service, 'unknown')",
      entityLabelExpr: "COALESCE(e.service, 'unknown')",
    });
    expect(sql).toContain("MIN(COALESCE(e.service, 'unknown'))");
  });

  it('fails loudly when the column list and projections disagree', () => {
    expect(() =>
      buildBucketRecomputeSql({
        ...baseOptions,
        aggregates: ['COUNT(*)::bigint', 'COUNT(*)::bigint'],
      }),
    ).toThrow(/arity mismatch/);
  });

  it('does not end with a line comment (would swallow ON CONFLICT)', () => {
    const sql = buildBucketRecomputeSql(baseOptions);
    const lastLine = sql.trimEnd().split('\n').at(-1)!;
    expect(lastLine.trim().startsWith('--')).toBe(false);
  });
});

describe('analytics engine — compaction merge rules', () => {
  it('sums counters', () => {
    expect(mergeExpressionFor({ name: 'total_count', dataType: 'bigint' })).toContain('SUM(s.total_count)');
  });

  it('takes the max for max columns and exact distinct counts', () => {
    expect(mergeExpressionFor({ name: 'latency_max_ms', dataType: 'numeric' })).toBe('MAX(s.latency_max_ms)');
    expect(mergeExpressionFor({ name: 'unique_users_exact', dataType: 'bigint' })).toBe(
      'MAX(s.unique_users_exact)',
    );
  });

  it('defers histograms, sketches and percentiles to the second pass', () => {
    expect(mergeExpressionFor({ name: 'latency_hist', dataType: 'ARRAY' })).toContain('NULL');
    expect(mergeExpressionFor({ name: 'unique_users_hll', dataType: 'bytea' })).toContain('NULL');
    expect(mergeExpressionFor({ name: 'latency_p95_ms', dataType: 'numeric' })).toContain('NULL');
  });

  it('weights averages, rates and scores by sample_count', () => {
    const expression = mergeExpressionFor({ name: 'availability_pct', dataType: 'numeric' });
    expect(expression).toContain('SUM(s.sample_count)');
    expect(expression).toContain('s.availability_pct * s.sample_count');
  });

  it('takes the newest value for text and last_* columns', () => {
    expect(mergeExpressionFor({ name: 'last_status', dataType: 'text' })).toContain('ORDER BY s.bucket DESC');
    expect(mergeExpressionFor({ name: 'route', dataType: 'text' })).toContain('ORDER BY s.bucket DESC');
  });

  it('keeps first_* timestamps as minima', () => {
    expect(
      mergeExpressionFor({ name: 'first_seen_at', dataType: 'timestamp with time zone' }),
    ).toBe('MIN(s.first_seen_at)');
    expect(
      mergeExpressionFor({ name: 'last_seen_at', dataType: 'timestamp with time zone' }),
    ).toBe('MAX(s.last_seen_at)');
  });

  it('declares a compaction chain only for tiered tables', () => {
    for (const target of COMPACTION_TARGETS) {
      expect(target.windows[0]).toBe('1m');
      expect(target.windows.length).toBeGreaterThan(1);
    }
  });
});

describe('analytics engine — retention scope', () => {
  it('only ever targets analytics-owned rollups', () => {
    for (const target of retentionTargets()) {
      expect(target.table).toMatch(/_(1m|5m|1h|1d)$/);
      expect(target.table.startsWith('events_')).toBe(false);
    }
  });

  it('covers every tier of every compacted table', () => {
    const tables = new Set(retentionTargets().map((target) => target.table));
    for (const entry of COMPACTION_TARGETS) {
      for (const window of entry.windows) {
        expect(tables.has(`${entry.base}_${window}`)).toBe(true);
      }
    }
  });
});
