import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AlertRuntimeEngines } from '../../src/modules/alerting/runtime/engines.js';
import { AlertRedisStateService } from '../../src/modules/alerting/runtime/alert-redis-state.js';
import { AlertCatalogSnapshot, AlertRuntimeRuleCatalog, type RuntimeRuleRow } from '../../src/modules/alerting/runtime/rule-catalog.js';
import type { AlertRuleConditionRow } from '../../src/modules/alerting/rules/rules.types.js';
import type { AlertRuleBindingRow } from '../../src/modules/alerting/policy/resolve-rule.js';
import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { Redis } from 'ioredis';

const ORG = '00000000-0000-4000-8000-000000000001';
const PROJECT = '00000000-0000-4000-8000-000000000002';
const RULE = '00000000-0000-4000-8000-000000000003';

class MockRedis {
  public store = new Map<string, { value: string; expiresAt: number | null }>();

  async set(key: string, value: string, ...args: (string | number)[]): Promise<'OK' | null> {
    const isNx = args.includes('NX');
    const exIdx = args.indexOf('EX');
    const ttlSeconds = exIdx !== -1 ? Number(args[exIdx + 1]) : null;

    const now = Date.now();
    const existing = this.store.get(key);
    if (existing && (existing.expiresAt === null || existing.expiresAt > now)) {
      if (isNx) {
        return null;
      }
    }

    const expiresAt = ttlSeconds !== null ? now + ttlSeconds * 1000 : null;
    this.store.set(key, { value, expiresAt });
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    const item = this.store.get(key);
    if (!item) return null;
    if (item.expiresAt !== null && item.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return item.value;
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async exists(key: string): Promise<number> {
    return (await this.get(key)) !== null ? 1 : 0;
  }
}

function mockLogger(): FastifyBaseLogger {
  const log: any = {
    trace: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: () => log,
  };
  return log as FastifyBaseLogger;
}

/**
 * Cooldown gating integration.
 *
 * Correctness contract under test: the DATABASE is the authoritative fire gate
 * (atomic `claimBreachDecision`), and Redis is only a cheap fast-path filter.
 * A duplicate fire must be suppressed whether or not Redis participates.
 */
describe('AlertRuntimeEngines + Cooldown Integration', () => {
  let mockRedis: MockRedis;
  let redisState: AlertRedisStateService;
  let mockLogDb: any;
  let mockControlDb: any;
  let logger: FastifyBaseLogger;

  beforeEach(() => {
    mockRedis = new MockRedis();
    logger = mockLogger();
    redisState = new AlertRedisStateService({
      redisClient: mockRedis as unknown as Redis,
      logger,
      enabled: true,
    });

    const evalStateStore = new Map<string, any>();

    mockLogDb = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[] = []) => {
        // Faithful emulation of AlertRuntimeRepository.claimBreachDecision():
        // the single atomic statement that is now the AUTHORITATIVE fire gate.
        // Params: [scopeHash, org, rule, binding, project, env, service,
        //          endpoint, evaluatedAt, requiredBreaches, cooldownSeconds]
        // claimBreachDecision passes 11 params; claimRecovery passes 9.
        if (sql.includes('alert_rule_eval_state') && sql.includes('WITH locked') && params.length === 11) {
          const [scopeHash, orgId, ruleId, , , , , , evaluatedAt, requiredBreaches, cooldownSeconds] = params;
          const prev = evalStateStore.get(scopeHash);
          const prevBreaching = prev?.is_breaching === true;
          const prevFiredAt: Date | null = prev?.last_fired_at ?? null;
          const now = new Date(evaluatedAt);

          const nextBreaches = prevBreaching ? Number(prev.consecutive_breaches) + 1 : 1;
          const cooldownElapsed = Number(cooldownSeconds) <= 0
            || prevFiredAt === null
            || prevFiredAt.getTime() <= now.getTime() - Number(cooldownSeconds) * 1000;
          const fired = nextBreaches >= Number(requiredBreaches) && cooldownElapsed;

          evalStateStore.set(scopeHash, {
            scope_hash: scopeHash,
            organization_id: orgId,
            rule_id: ruleId,
            consecutive_breaches: nextBreaches,
            is_breaching: true,
            last_evaluated_at: now,
            last_fired_at: fired ? now : prevFiredAt,
          });

          return {
            rows: [{
              consecutive_breaches: nextBreaches,
              fired,
              last_fired_at: fired ? now : prevFiredAt,
            }],
          };
        }
        // Emulation of claimRecovery().
        if (sql.includes('alert_rule_eval_state') && sql.includes('WITH locked') && params.length === 9) {
          const scopeHash = params[0];
          const prev = evalStateStore.get(scopeHash);
          const recovered = prev?.is_breaching === true;
          if (prev) {
            evalStateStore.set(scopeHash, { ...prev, consecutive_breaches: 0, is_breaching: false });
          }
          return { rows: [{ recovered }] };
        }
        return { rows: [] };
      }),
      connect: vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      }),
    };

    mockControlDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };
  });

  it('acquires Redis cooldown and suppresses duplicate fires during cooldown window', async () => {
    const rule: RuntimeRuleRow = {
      id: RULE,
      organization_id: ORG,
      name: 'High CPU Usage',
      description: null,
      severity: 'critical',
      enabled: true,
      evaluation_interval_seconds: 1,
      cooldown_seconds: 300,
      auto_resolve_after_minutes: null,
      deduplication_window_seconds: 3600,
      deduplication_key_template: null,
      grouping_enabled: false,
      grouping_key_template: null,
      grouping_wait_seconds: 300,
      labels: {},
      annotations: {},
      metadata: {},
      created_by: '00000000-0000-4000-8000-000000000004',
      updated_by: null,
      enabled_at: new Date(),
      disabled_at: null,
      created_at: new Date(),
      updated_at: new Date(),
      deleted_at: null,
      project_id: null,
      preset_key: null,
      is_default: false,
      last_evaluated_at: null,
      current_revision: 1,
    };

    const conditionRow: AlertRuleConditionRow = {
      id: '00000000-0000-4000-8000-000000000005',
      rule_id: RULE,
      condition_type: 'threshold',
      condition_group_id: null,
      field_path: 'errors.fatal',
      operator: 'eq',
      threshold_value: true,
      lookback_minutes: 0,
      aggregate_function: null,
      is_required: true,
      order_index: 0,
      created_at: new Date(),
    };

    const conditions = [conditionRow];

    const bindings: AlertRuleBindingRow[] = [
      {
        id: '00000000-0000-4000-8000-000000000006',
        organization_id: ORG,
        rule_id: RULE,
        scope_type: 'project',
        scope_level: 2,
        project_id: PROJECT,
        environment: null,
        service: null,
        endpoint: null,
        mode: 'override',
        enabled: true,
        priority: 100,
        severity: null,
        cooldown_seconds: 300,
        deduplication_window_seconds: null,
        auto_resolve_after_minutes: null,
        evaluation_interval_seconds: null,
        consecutive_breaches: 1,
        threshold_overrides: {},
        action_mode: 'inherit',
        requested_channels: null,
        recipient_overrides: null,
        escalation_policy_id: null,
        notes: null,
        created_at: new Date(),
        deleted_at: null,
      },
    ];

    const conditionsMap = new Map([[RULE, conditions]]);
    const bindingsMap = new Map([[RULE, bindings]]);

    const snapshot = new AlertCatalogSnapshot(ORG, 'fast', [rule], conditionsMap, bindingsMap);
    const mockCatalog = {
      loadCatalogSnapshot: vi.fn().mockResolvedValue(snapshot),
    } as unknown as AlertRuntimeRuleCatalog;

    const engines = new AlertRuntimeEngines(
      logger,
      mockLogDb as unknown as Pool,
      mockControlDb as unknown as Pool,
      undefined,
      redisState,
      mockCatalog,
    );

    // Mock decision engine internal decide
    (engines as any).decision = {
      decide: vi.fn().mockResolvedValue({
        alertKey: 'key1',
        duplicate: false,
        suppressed: false,
        state: 'firing',
        event: { id: 'evt-1' },
        notificationJobs: [],
      }),
    };

    // First evaluation: fatal error occurs -> breaches, fires, acquires Redis cooldown
    const summary1 = await engines.evaluateFast({
      organizationId: ORG,
      projectId: PROJECT,
      events: [
        {
          organizationId: ORG,
          projectId: PROJECT,
          environment: 'production',
          service: 'api',
          endpoint: '/data',
          source: 'ingestion',
          timestamp: new Date(),
          event: {
            type: 'error',
            severity: 'critical',
            message: 'Fatal DB failure',
            timestamp: Date.now(),
          } as any,
        } as any,
      ],
    });

    expect(summary1.fired).toBe(1);
    expect(summary1.suppressed).toBe(0);

    // Second evaluation 10 seconds later: same fatal error -> breaches, but suppressed by Redis cooldown gate!
    const summary2 = await engines.evaluateFast({
      organizationId: ORG,
      projectId: PROJECT,
      events: [
        {
          organizationId: ORG,
          projectId: PROJECT,
          environment: 'production',
          service: 'api',
          endpoint: '/data',
          source: 'ingestion',
          timestamp: new Date(Date.now() + 10_000),
          event: {
            type: 'error',
            severity: 'critical',
            message: 'Fatal DB failure',
            timestamp: Date.now() + 10_000,
          } as any,
        } as any,
      ],
    });

    expect(summary2.fired).toBe(0);
    expect(summary2.suppressed).toBe(1);
  });
});
