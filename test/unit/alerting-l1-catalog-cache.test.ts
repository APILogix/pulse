import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertRuntimeRuleCatalog } from '../../src/modules/alerting/runtime/rule-catalog.js';
import type { Pool } from 'pg';

describe('AlertRuntimeRuleCatalog L1 Cache', () => {
  beforeEach(() => {
    AlertRuntimeRuleCatalog.clearGlobalCache();
  });

  it('populates cache on miss and serves subsequent requests from L1 memory', async () => {
    let queryCount = 0;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queryCount += 1;
        if (sql.includes('FROM alert_rules')) {
          return {
            rows: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                organization_id: 'org-cache-test',
                project_id: null,
                name: 'High CPU',
                severity: 'warning',
                enabled: true,
                current_revision: 1,
                evaluation_interval_seconds: 60,
                cooldown_seconds: 300,
                deduplication_window_seconds: 300,
                auto_resolve_after_minutes: null,
                grouping_enabled: false,
                labels: {},
                annotations: {},
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
              },
            ],
          };
        }
        if (sql.includes('FROM alert_rule_conditions')) {
          return {
            rows: [
              {
                id: '22222222-2222-4222-8222-222222222222',
                rule_id: '11111111-1111-4111-8111-111111111111',
                condition_type: 'threshold',
                condition_group_id: 1,
                field_path: 'host.cpu.usage',
                operator: 'gt',
                threshold_value: 90,
                lookback_minutes: 5,
                aggregate_function: 'avg',
                is_required: true,
                order_index: 0,
              },
            ],
          };
        }
        if (sql.includes('FROM alert_rule_bindings')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const catalog = new AlertRuntimeRuleCatalog(mockDb, { isolatedCache: true });

    // Initial load: Cache miss -> executes 3 DB queries (rules, conditions, bindings)
    const snapshot1 = await catalog.loadCatalogSnapshot('org-cache-test', 'fast');
    expect(snapshot1.rules).toHaveLength(1);
    expect(queryCount).toBe(3);

    // Second load: Cache hit -> 0 additional DB queries
    const snapshot2 = await catalog.loadCatalogSnapshot('org-cache-test', 'fast');
    expect(snapshot2.rules).toHaveLength(1);
    expect(queryCount).toBe(3); // Unchanged!
  });

  it('deduplicates concurrent loads for the same scope using single-flight coalescing', async () => {
    let rulesQueryCount = 0;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('FROM alert_rules')) {
          rulesQueryCount += 1;
          // Add small delay to simulate database latency
          await new Promise((r) => setTimeout(r, 10));
          return {
            rows: [
              {
                id: '11111111-1111-4111-8111-111111111111',
                organization_id: 'org-single-flight',
                project_id: null,
                name: 'Rule 1',
                severity: 'critical',
                enabled: true,
                current_revision: 1,
                evaluation_interval_seconds: 60,
                cooldown_seconds: 300,
                deduplication_window_seconds: 300,
                auto_resolve_after_minutes: null,
                grouping_enabled: false,
                labels: {},
                annotations: {},
                metadata: {},
                created_at: new Date(),
                updated_at: new Date(),
                deleted_at: null,
              },
            ],
          };
        }
        return { rows: [] };
      }),
    } as unknown as Pool;

    const catalog = new AlertRuntimeRuleCatalog(mockDb, { isolatedCache: true });

    // Fire 10 simultaneous snapshot requests
    const promises = Array.from({ length: 10 }, () =>
      catalog.loadCatalogSnapshot('org-single-flight', 'fast'),
    );

    const snapshots = await Promise.all(promises);
    expect(snapshots).toHaveLength(10);
    // Even though 10 workers requested the snapshot at the exact same moment, exactly 1 DB query was issued
    expect(rulesQueryCount).toBe(1);
  });

  it('invalidates cache correctly when rules are updated', async () => {
    let queryCount = 0;
    const mockDb = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        queryCount += 1;
        return { rows: [] };
      }),
    } as unknown as Pool;

    const catalog = new AlertRuntimeRuleCatalog(mockDb, { isolatedCache: true });

    await catalog.loadCatalogSnapshot('org-inval', 'fast');
    expect(queryCount).toBe(1); // 1 for rules (0 conditions, 0 bindings)

    // Invalidate
    catalog.invalidate('org-inval', 'fast');

    // Next load re-queries database
    await catalog.loadCatalogSnapshot('org-inval', 'fast');
    expect(queryCount).toBe(2);
  });
});
