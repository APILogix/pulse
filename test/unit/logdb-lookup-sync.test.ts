/**
 * Unit tests for the Log DB lookup-snapshot sync helpers.
 *
 * Doc reference (docs/distributed-ingestion-routing-master-prompt.md,
 * "Log DB lookup snapshot"): organization_lookup, project_lookup,
 * environment_lookup, and api_key_lookup are denormalized Log DB snapshots kept
 * in sync from the PRIMARY DB after a mutation, with NO cross-database foreign
 * keys and best-effort (never-blocking) delivery.
 *
 * These tests exercise the REAL sync functions with the three config singletons
 * they import (`pool`, `logDB`, `logger`) mocked, so the suite is hermetic — no
 * database, no queue, no environment variables. They assert that:
 *   - the primary DB is the read source and the Log DB is the write target,
 *   - the write always uses the Log DB PRIMARY pool ({ operation: 'write' }),
 *   - a missing source row is a no-op (returns false, no Log DB write),
 *   - the best-effort wrapper never throws even when the Log DB is down,
 *   - queries contain ON CONFLICT WHERE clauses to avoid unnecessary row-locking and WAL bloat,
 *   - in-flight calls are single-flight coalesced,
 *   - read-path init triggers are throttled by TTL while mutation triggers bypass cache.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mock fns so the (hoisted) vi.mock factories can capture them. Kept as
// untyped vi.fn()s so mockResolvedValue/mockRejectedValue accept any shape.
const { poolQuery, logQuery } = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  logQuery: vi.fn(),
}));

// lookup-sync.ts imports exactly these three runtime singletons.
vi.mock('../../src/config/database.js', () => ({ pool: { query: poolQuery } }));
vi.mock('../../src/config/log-database.js', () => ({ logDB: { queryWithRetry: logQuery } }));
vi.mock('../../src/config/logger.js', () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

import {
  syncProjectLookupToLogDb,
  syncProjectLookupToLogDbBestEffort,
  syncEnvironmentLookupToLogDb,
  syncApiKeyLookupToLogDb,
  syncEnvironmentSdkConfigLookupToLogDb,
  resetLookupSyncCachesForTest,
} from '../../src/shared/logdb/lookup-sync.js';

const PROJECT_ROW = {
  project_id: '11111111-1111-1111-1111-111111111111',
  organization_id: '22222222-2222-2222-2222-222222222222',
  name: 'Test Project',
  slug: 'test-project',
  status: 'active',
  deleted_at: null,
};

const ENVIRONMENT_ROW = {
  environment_id: '33333333-3333-3333-3333-333333333333',
  organization_id: '22222222-2222-2222-2222-222222222222',
  project_id: '11111111-1111-1111-1111-111111111111',
  name: 'Production',
  slug: 'production',
  type: 'production',
  is_default: true,
  is_active: true,
  deleted_at: null,
};

const API_KEY_ROW = {
  api_key_id: '44444444-4444-4444-4444-444444444444',
  organization_id: '22222222-2222-2222-2222-222222222222',
  project_id: '11111111-1111-1111-1111-111111111111',
  environment_id: '33333333-3333-3333-3333-333333333333',
  key_prefix: 'pk_live_abc',
  name: 'Production Default Key',
  status: 'active',
};

const SDK_CONFIG_ROW = {
  organization_id: PROJECT_ROW.organization_id,
  project_id: PROJECT_ROW.project_id,
  environment_id: ENVIRONMENT_ROW.environment_id,
  revision_number: 7,
  config_hash: 'abc123',
  compiled_snapshot: {
    schemaVersion: 1,
    sdk: { projectId: PROJECT_ROW.project_id, environment: 'production' },
  },
  environment_name: 'Production',
  environment_slug: 'production',
};

beforeEach(() => {
  resetLookupSyncCachesForTest();
  poolQuery.mockReset();
  logQuery.mockReset();
  logQuery.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('syncProjectLookupToLogDb', () => {
  it('reads the primary DB and upserts project_lookup on the Log DB primary pool with conditional WHERE guard', async () => {
    poolQuery.mockResolvedValue({ rows: [PROJECT_ROW], rowCount: 1 });

    const ok = await syncProjectLookupToLogDb(PROJECT_ROW.project_id, 'project.created');

    expect(ok).toBe(true);
    // Source read hit the primary DB pool.
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(poolQuery.mock.calls[0][0]).toContain('FROM projects');
    // Destination write hit the Log DB with the PRIMARY pool.
    expect(logQuery).toHaveBeenCalledTimes(1);
    const [sql, params, options] = logQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO project_lookup');
    expect(sql).toContain('WHERE project_lookup.organization_id IS DISTINCT FROM EXCLUDED.organization_id');
    expect(params.slice(0, 4)).toEqual([
      PROJECT_ROW.project_id,
      PROJECT_ROW.organization_id,
      PROJECT_ROW.name,
      PROJECT_ROW.slug,
    ]);
    expect(options).toEqual({ operation: 'write' });
    // Plan/status snapshot travels in the JSONB metadata column.
    const metadata = JSON.parse(params[4]);
    expect(metadata).toMatchObject({
      source: 'primary_db',
      reason: 'project.created',
      status: 'active',
      deletedAt: null,
    });
  });

  it('is a no-op when the source row is missing (returns false, no Log DB write)', async () => {
    poolQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    const ok = await syncProjectLookupToLogDb('missing', 'project.updated');

    expect(ok).toBe(false);
    expect(logQuery).not.toHaveBeenCalled();
  });

  it('best-effort wrapper never throws even when the Log DB write fails', async () => {
    poolQuery.mockResolvedValue({ rows: [PROJECT_ROW], rowCount: 1 });
    logQuery.mockRejectedValue(new Error('log db unavailable'));

    expect(() =>
      syncProjectLookupToLogDbBestEffort(PROJECT_ROW.project_id, 'project.created'),
    ).not.toThrow();
    // Let the fire-and-forget rejection settle so it cannot surface as unhandled.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});

describe('syncEnvironmentLookupToLogDb', () => {
  it('upserts environment_lookup with org + project scope, status metadata, and conditional WHERE guard', async () => {
    poolQuery.mockResolvedValue({ rows: [ENVIRONMENT_ROW], rowCount: 1 });

    const ok = await syncEnvironmentLookupToLogDb(ENVIRONMENT_ROW.environment_id, 'environment.created');

    expect(ok).toBe(true);
    expect(poolQuery.mock.calls[0][0]).toContain('FROM project_environments');
    const [sql, params, options] = logQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO environment_lookup');
    expect(sql).toContain('WHERE environment_lookup.organization_id IS DISTINCT FROM EXCLUDED.organization_id');
    expect(params.slice(0, 5)).toEqual([
      ENVIRONMENT_ROW.environment_id,
      ENVIRONMENT_ROW.organization_id,
      ENVIRONMENT_ROW.project_id,
      ENVIRONMENT_ROW.name,
      ENVIRONMENT_ROW.slug,
    ]);
    expect(options).toEqual({ operation: 'write' });
    const metadata = JSON.parse(params[5]);
    expect(metadata).toMatchObject({
      source: 'primary_db',
      reason: 'environment.created',
      type: 'production',
      isDefault: true,
      isActive: true,
    });
  });
});

describe('syncApiKeyLookupToLogDb', () => {
  it('upserts api_key_lookup with flat columns and conditional WHERE guard', async () => {
    poolQuery.mockResolvedValue({ rows: [API_KEY_ROW], rowCount: 1 });

    const ok = await syncApiKeyLookupToLogDb(API_KEY_ROW.api_key_id, 'api_key.created');

    expect(ok).toBe(true);
    expect(poolQuery.mock.calls[0][0]).toContain('FROM project_api_keys');
    const [sql, params, options] = logQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO api_key_lookup');
    expect(sql).toContain('WHERE api_key_lookup.organization_id IS DISTINCT FROM EXCLUDED.organization_id');
    expect(params).toEqual([
      API_KEY_ROW.api_key_id,
      API_KEY_ROW.organization_id,
      API_KEY_ROW.project_id,
      API_KEY_ROW.environment_id,
      API_KEY_ROW.key_prefix,
      API_KEY_ROW.name,
      API_KEY_ROW.status,
    ]);
    expect(options).toEqual({ operation: 'write' });
  });
});

describe('syncEnvironmentSdkConfigLookupToLogDb', () => {
  it('upserts the published SDK config snapshot for the environment with conditional WHERE guard', async () => {
    poolQuery.mockResolvedValue({ rows: [SDK_CONFIG_ROW], rowCount: 1 });

    const ok = await syncEnvironmentSdkConfigLookupToLogDb(
      SDK_CONFIG_ROW.environment_id,
      'sdk.init',
    );

    expect(ok).toBe(true);
    expect(poolQuery.mock.calls[0][0]).toContain('FROM project_environment_sdk_configs');
    const [sql, params, options] = logQuery.mock.calls[0];
    expect(sql).toContain('INSERT INTO environment_sdk_config_lookup');
    expect(sql).toContain('WHERE environment_sdk_config_lookup.revision_number IS DISTINCT FROM EXCLUDED.revision_number');
    expect(params.slice(0, 5)).toEqual([
      SDK_CONFIG_ROW.environment_id,
      SDK_CONFIG_ROW.organization_id,
      SDK_CONFIG_ROW.project_id,
      SDK_CONFIG_ROW.revision_number,
      SDK_CONFIG_ROW.config_hash,
    ]);
    expect(JSON.parse(params[5])).toEqual(SDK_CONFIG_ROW.compiled_snapshot);
    expect(JSON.parse(params[6])).toMatchObject({
      source: 'primary_db',
      reason: 'sdk.init',
      environment: { name: 'Production', slug: 'production' },
    });
    expect(options).toEqual({ operation: 'write' });
  });

  it('coalesces concurrent in-flight sync requests into a single execution', async () => {
    let resolveQuery: (val: unknown) => void;
    poolQuery.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveQuery = resolve;
        }),
    );

    const promise1 = syncEnvironmentSdkConfigLookupToLogDb(SDK_CONFIG_ROW.environment_id, 'sdk.init');
    const promise2 = syncEnvironmentSdkConfigLookupToLogDb(SDK_CONFIG_ROW.environment_id, 'sdk.init');
    const promise3 = syncEnvironmentSdkConfigLookupToLogDb(SDK_CONFIG_ROW.environment_id, 'sdk.init');

    resolveQuery!({ rows: [SDK_CONFIG_ROW], rowCount: 1 });

    const [res1, res2, res3] = await Promise.all([promise1, promise2, promise3]);

    expect(res1).toBe(true);
    expect(res2).toBe(true);
    expect(res3).toBe(true);
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(logQuery).toHaveBeenCalledTimes(1);
  });

  it('skips redundant database queries on repeated sdk.init within TTL cache window', async () => {
    poolQuery.mockResolvedValue({ rows: [SDK_CONFIG_ROW], rowCount: 1 });

    const first = await syncEnvironmentSdkConfigLookupToLogDb(SDK_CONFIG_ROW.environment_id, 'sdk.init');
    expect(first).toBe(true);
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(logQuery).toHaveBeenCalledTimes(1);

    // Second call with sdk.init immediately hits TTL cache without DB query
    const second = await syncEnvironmentSdkConfigLookupToLogDb(SDK_CONFIG_ROW.environment_id, 'sdk.init');
    expect(second).toBe(true);
    expect(poolQuery).toHaveBeenCalledTimes(1);
    expect(logQuery).toHaveBeenCalledTimes(1);

    // Mutation call (e.g. sdk_config.published) bypasses cache and syncs immediately
    const published = await syncEnvironmentSdkConfigLookupToLogDb(
      SDK_CONFIG_ROW.environment_id,
      'sdk_config.published',
    );
    expect(published).toBe(true);
    expect(poolQuery).toHaveBeenCalledTimes(2);
    expect(logQuery).toHaveBeenCalledTimes(2);
  });
});
