import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { Logger } from 'pino';
import { CreditWeightService, CreditWeightResolver, DEFAULT_CREDIT_WEIGHTS } from '../../src/modules/ingestion/usage/credit-weights.js';
import { UsageCounter } from '../../src/modules/ingestion/usage/usage-counter.js';
import { UsageRollup } from '../../src/modules/ingestion/workers/usage-rollup.js';
import { InternalBillingService } from '../../src/modules/billing/internal/service.js';
import type { InternalBillingRepository } from '../../src/modules/billing/internal/repository.js';

describe('Weighted Event Credit Pipeline', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  describe('CreditWeightService', () => {
    it('provides synchronous O(1) lookup with default fallback', () => {
      const mockPool = { query: vi.fn() } as unknown as Pool;
      const service = new CreditWeightService(mockPool, mockLogger);

      expect(service.getWeightSync('request')).toBe(1.0);
      expect(service.getWeightSync('span')).toBe(0.25);
      expect(service.getWeightSync('error')).toBe(1.5);
      expect(service.getWeightSync('unknown_event')).toBe(1.0); // default fallback
    });

    it('provides asynchronous getWeight resolving to credit weight', async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rowCount: 2,
          rows: [
            { event_type: 'span', credit_weight: '0.2500' },
            { event_type: 'custom_ai_call', credit_weight: '5.0000' },
          ],
        }),
      } as unknown as Pool;
      const service = new CreditWeightService(mockPool, mockLogger);

      const weight = await service.getWeight('custom_ai_call');
      expect(weight).toBe(5.0);
      expect(service.getWeightSync('span')).toBe(0.25);
    });

    it('coalesces concurrent refreshCache calls into a single database query (stampede safety)', async () => {
      let queryCount = 0;
      const mockPool = {
        query: vi.fn(async () => {
          queryCount++;
          await new Promise((r) => setTimeout(r, 20));
          return {
            rowCount: 1,
            rows: [{ event_type: 'span', credit_weight: '0.2500' }],
          };
        }),
      } as unknown as Pool;
      const service = new CreditWeightService(mockPool, mockLogger);

      // Launch 10 concurrent refreshes
      await Promise.all([
        service.refreshCache(),
        service.refreshCache(),
        service.refreshCache(),
        service.refreshCache(),
        service.refreshCache(),
      ]);

      expect(queryCount).toBe(1);
    });

    it('handles database failures gracefully by retaining cached/default weights', async () => {
      const mockPool = {
        query: vi.fn().mockRejectedValue(new Error('connection timeout')),
      } as unknown as Pool;
      const service = new CreditWeightService(mockPool, mockLogger);

      // Trigger refresh on failing database
      await service.refreshCache();

      // Gracefully falls back without throwing
      expect(service.getWeightSync('request')).toBe(1.0);
      expect(service.getWeightSync('span')).toBe(0.25);
      expect(service.getWeightSync('error')).toBe(1.5);
    });

    it('supports singleton instance and lifecycle management', () => {
      const mockPool = { query: vi.fn() } as unknown as Pool;
      const instance1 = CreditWeightService.getInstance(mockPool, mockLogger);
      const instance2 = CreditWeightService.getInstance();

      expect(instance1).toBe(instance2);

      // Lifecycle start and stop
      instance1.start();
      instance1.stop();
    });
  });

  describe('UsageCounter decimal increments', () => {
    it('buffers decimal credit weights and inserts NUMERIC increments to staging', async () => {
      const executed: Array<{ sql: string; params: unknown[] }> = [];
      const mockPool = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          executed.push({ sql, params: params ?? [] });
          if (sql.includes('SELECT flushed_count')) return { rowCount: 0, rows: [] };
          return { rowCount: 1, rows: [] };
        }),
      } as unknown as Pool;

      const counter = new UsageCounter(mockPool, mockLogger, {
        bufferLimit: 5,
        driveRollup: false,
      });

      // Increment 4 spans at 0.25 each = 1.0 total
      counter.increment('proj-1', 'org-1', 'billing:events:span', 0.25);
      counter.increment('proj-1', 'org-1', 'billing:events:span', 0.25);
      counter.increment('proj-1', 'org-1', 'billing:events:span', 0.50);

      // Raw unweighted count = 4
      counter.increment('proj-1', 'org-1', 'billing:raw:span', 4);

      await counter.flush();

      const insertQuery = executed.find((q) => q.sql.includes('INSERT INTO usage_counter_staging'));
      expect(insertQuery).toBeDefined();

      // Check params: billing:events:span has 1.0 (0.25 + 0.25 + 0.50)
      const spanParamIdx = insertQuery!.params.indexOf('billing:events:span');
      expect(spanParamIdx).toBeGreaterThanOrEqual(0);
      expect(insertQuery!.params[spanParamIdx + 1]).toBe(1.0);

      // Check params: billing:raw:span has 4
      const rawSpanParamIdx = insertQuery!.params.indexOf('billing:raw:span');
      expect(rawSpanParamIdx).toBeGreaterThanOrEqual(0);
      expect(insertQuery!.params[rawSpanParamIdx + 1]).toBe(4);
    });
  });

  describe('UsageRollup dual weighted/raw aggregation', () => {
    it('aggregates weighted credits into events_used and raw counts into raw_events_count', async () => {
      const executedQueries: Array<{ text: string; values: unknown[] }> = [];

      const mockClient = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          executedQueries.push({ text: sql, values: params ?? [] });
          if (sql.includes('DELETE FROM usage_counter_staging')) {
            return {
              rowCount: 4,
              rows: [
                // 100 spans @ 0.25 = 25.0 weighted credits
                {
                  org_id: '11111111-1111-1111-1111-111111111111',
                  project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                  counter_type: 'billing:events:span',
                  increment_by: '25.0000',
                },
                // 100 raw spans
                {
                  org_id: '11111111-1111-1111-1111-111111111111',
                  project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                  counter_type: 'billing:raw:span',
                  increment_by: '100',
                },
                // 10 errors @ 1.5 = 15.0 weighted credits
                {
                  org_id: '11111111-1111-1111-1111-111111111111',
                  project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                  counter_type: 'billing:events:error',
                  increment_by: '15.0000',
                },
                // 10 raw errors
                {
                  org_id: '11111111-1111-1111-1111-111111111111',
                  project_id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
                  counter_type: 'billing:raw:error',
                  increment_by: '10',
                },
              ],
            };
          }
          return { rows: [], rowCount: 1 };
        }),
        release: vi.fn(),
      } as unknown as PoolClient;

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
        query: vi.fn().mockResolvedValue({ rows: [] }),
      } as unknown as Pool;

      const mockMetrics = {
        recordRollupSuccess: vi.fn(),
        recordRollupFailure: vi.fn(),
      };

      const rollup = new UsageRollup(mockPool, mockMetrics as any, mockLogger);
      await rollup.run();

      const entitlementQuery = executedQueries.find((q) =>
        q.text.includes('UPDATE organization_usage_current_period'),
      );
      expect(entitlementQuery).toBeDefined();

      const orgIds = entitlementQuery!.values[0] as string[];
      const weightedDeltas = entitlementQuery!.values[1] as number[];
      const rawDeltas = entitlementQuery!.values[2] as number[];

      expect(orgIds).toEqual(['11111111-1111-1111-1111-111111111111']);
      // Weighted credits: 25.0 (spans) + 15.0 (errors) = 40.0
      expect(weightedDeltas).toEqual([40.0]);
      // Raw events: 100 (spans) + 10 (errors) = 110
      expect(rawDeltas).toEqual([110]);
    });
  });

  describe('InternalBillingService consumeEvents credit weighting', () => {
    it('applies credit weight and passes both weightedCredits and rawCount to repository', async () => {
      const incrementCalls: Array<{
        body: any;
        requested: number;
        overageRequested: number;
        rawCount?: number;
      }> = [];

      const mockRepo = {
        withTransaction: vi.fn(async (cb: (client: any) => Promise<any>) => cb({} as any)),
        getCurrentUsageForUpdate: vi.fn().mockResolvedValue({
          events_used: '50.0000',
          overage_events: '0',
          event_limit: '1000',
        }),
        getCreditWeight: vi.fn().mockResolvedValue(0.25), // span weight
        incrementEventUsage: vi.fn(async (body, requested, overageRequested, _db, rawCount) => {
          incrementCalls.push({ body, requested, overageRequested, rawCount });
        }),
      } as unknown as InternalBillingRepository;

      const service = new InternalBillingService(mockRepo);

      // Mock getQuotaFeature to allow unlimited or high limit
      (service as any).getQuotaFeature = vi.fn().mockResolvedValue({
        configured_value: { limit: 10000 },
        usage_behavior: 'overage',
      });

      const res = await service.consumeEvents({
        organizationId: '11111111-1111-1111-1111-111111111111',
        eventType: 'span',
        count: 100, // 100 spans
      });

      expect(res.accepted).toBe(true);
      expect(res.rawEventsCount).toBe(100);
      expect(res.weightedCredits).toBe(25.0); // 100 * 0.25

      expect(incrementCalls.length).toBe(1);
      expect(incrementCalls[0].requested).toBe(25.0);
      expect(incrementCalls[0].rawCount).toBe(100);
    });

    it('falls back to weight 1.0 when eventType is omitted', async () => {
      const incrementCalls: Array<{
        body: any;
        requested: number;
        overageRequested: number;
        rawCount?: number;
      }> = [];

      const mockRepo = {
        withTransaction: vi.fn(async (cb: (client: any) => Promise<any>) => cb({} as any)),
        getCurrentUsageForUpdate: vi.fn().mockResolvedValue({
          events_used: '0',
          overage_events: '0',
          event_limit: '1000',
        }),
        getCreditWeight: vi.fn(),
        incrementEventUsage: vi.fn(async (body, requested, overageRequested, _db, rawCount) => {
          incrementCalls.push({ body, requested, overageRequested, rawCount });
        }),
      } as unknown as InternalBillingRepository;

      const service = new InternalBillingService(mockRepo);
      (service as any).getQuotaFeature = vi.fn().mockResolvedValue({
        integer_value: 1000,
        usage_behavior: 'hard_limit',
      });

      const res = await service.consumeEvents({
        organizationId: '11111111-1111-1111-1111-111111111111',
        count: 50,
      });

      expect(res.accepted).toBe(true);
      expect(res.rawEventsCount).toBe(50);
      expect(res.weightedCredits).toBe(50); // 1:1 fallback
      expect(mockRepo.getCreditWeight).not.toHaveBeenCalled();
      expect(incrementCalls[0].requested).toBe(50);
      expect(incrementCalls[0].rawCount).toBe(50);
    });
  });
});
