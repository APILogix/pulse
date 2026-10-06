import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Logger } from 'pino';
import {
  TelemetryMaintenanceWorker,
  PARTITIONED_TABLES,
  DEFAULT_RETENTION_MONTHS,
  partitionName,
  monthBounds,
} from '../../src/shared/workers/telemetry-maintenance.processor.js';

describe('TelemetryMaintenanceWorker', () => {
  const mockLogger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;

  describe('monthBounds and partitionName', () => {
    it('computes correct start and end boundaries for regular months', () => {
      expect(monthBounds(2026, 9)).toEqual({
        from: '2026-09-01',
        to: '2026-10-01',
      });
    });

    it('handles year rollover on December boundary correctly', () => {
      expect(monthBounds(2026, 12)).toEqual({
        from: '2026-12-01',
        to: '2027-01-01',
      });
    });

    it('formats canonical partition names with zero-padded months', () => {
      expect(partitionName('events_requests', 2026, 4)).toBe('events_requests_y2026_m04');
      expect(partitionName('events_errors', 2026, 11)).toBe('events_errors_y2026_m11');
    });

    it('targets all 10 canonical events_* tables in Log DB', () => {
      expect(PARTITIONED_TABLES).toEqual([
        'events_errors',
        'events_requests',
        'events_logs',
        'events_metrics',
        'events_spans',
        'events_traces',
        'events_messages',
        'events_profiles',
        'events_replays',
        'events_cron_checkins',
      ]);
    });
  });

  describe('ensureFuturePartitions', () => {
    it('issues CREATE TABLE IF NOT EXISTS for each canonical table across current and future months', async () => {
      const executedQueries: string[] = [];
      const mockPool = {
        query: vi.fn(async (sql: string) => {
          executedQueries.push(sql);
          return { rows: [] };
        }),
      } as unknown as Pool;

      const worker = new TelemetryMaintenanceWorker(mockPool, mockLogger);
      await (worker as any).ensureFuturePartitions();

      expect(mockPool.query).toHaveBeenCalled();
      // Should create partitions for all 10 tables
      for (const table of PARTITIONED_TABLES) {
        const tableQueries = executedQueries.filter((q) => q.includes(`PARTITION OF ${table}`));
        expect(tableQueries.length).toBeGreaterThanOrEqual(2);
        expect(tableQueries[0]).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}_y\\d{4}_m\\d{2}`));
      }
    });

    it('safely handles and ignores partition range conflicts with default partition without throwing', async () => {
      const mockPool = {
        query: vi.fn(async () => {
          throw new Error('updated partition constraint for default partition would be violated by some row');
        }),
      } as unknown as Pool;

      const worker = new TelemetryMaintenanceWorker(mockPool, mockLogger);
      await expect((worker as any).ensureFuturePartitions()).resolves.not.toThrow();
    });
  });

  describe('dropExpiredPartitions', () => {
    it('drops expired partitions older than retention cutoff while protecting DEFAULT and non-conventional partitions', async () => {
      const droppedTables: string[] = [];
      const mockPool = {
        query: vi.fn(async (sql: string, params?: unknown[]) => {
          if (sql.includes('FROM pg_inherits')) {
            const table = params?.[0] as string;
            return {
              rows: [
                { child: `${table}_default` },             // MUST NOT BE DROPPED
                { child: `${table}_custom_2020` },          // MUST NOT BE DROPPED
                { child: `${table}_y2020_m01` },            // EXPIRED - MUST BE DROPPED
                { child: `${table}_y2099_m12` },            // FUTURE - MUST NOT BE DROPPED
              ],
            };
          }
          if (sql.includes('DROP TABLE IF EXISTS')) {
            droppedTables.push(sql);
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Pool;

      const worker = new TelemetryMaintenanceWorker(mockPool, mockLogger, { retentionMonths: 3 });
      await (worker as any).dropExpiredPartitions();

      // Verify that only the expired _y2020_m01 tables were dropped
      for (const table of PARTITIONED_TABLES) {
        expect(droppedTables).toContain(`DROP TABLE IF EXISTS ${table}_y2020_m01`);
        expect(droppedTables).not.toContain(`DROP TABLE IF EXISTS ${table}_default`);
        expect(droppedTables).not.toContain(`DROP TABLE IF EXISTS ${table}_custom_2020`);
        expect(droppedTables).not.toContain(`DROP TABLE IF EXISTS ${table}_y2099_m12`);
      }
    });
  });
});
