import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  MemoryDiagnostics,
  captureMemorySnapshot,
  type MemorySnapshot,
} from '../../src/lib/memory-diagnostics.js';

describe('Memory Diagnostics & Multi-Sample Monitoring Unit Tests', () => {
  let mockLogger: {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    child: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('captureMemorySnapshot', () => {
    it('captures heapUsed, heapTotal, rss, external, and arrayBuffers in MB', () => {
      const snapshot = captureMemorySnapshot();

      expect(snapshot).toHaveProperty('heapUsedMB');
      expect(snapshot).toHaveProperty('heapTotalMB');
      expect(snapshot).toHaveProperty('rssMB');
      expect(snapshot).toHaveProperty('externalMB');
      expect(snapshot).toHaveProperty('arrayBuffersMB');
      expect(snapshot).toHaveProperty('timestamp');

      expect(typeof snapshot.heapUsedMB).toBe('number');
      expect(typeof snapshot.heapTotalMB).toBe('number');
      expect(typeof snapshot.rssMB).toBe('number');
      expect(typeof snapshot.externalMB).toBe('number');
      expect(typeof snapshot.arrayBuffersMB).toBe('number');

      expect(snapshot.heapUsedMB).toBeGreaterThan(0);
      expect(snapshot.heapTotalMB).toBeGreaterThan(0);
      expect(snapshot.rssMB).toBeGreaterThan(0);
      expect(new Date(snapshot.timestamp).getTime()).not.toBeNaN();
    });
  });

  describe('Multi-Sample Growth Alerting (Eliminating False Positives)', () => {
    it('does NOT trigger growth warning on single-interval allocation jump', () => {
      const diagnostics = new MemoryDiagnostics({
        growthThreshold: 0.20,
        consecutiveSamplesRequired: 3,
        minHeapThresholdMB: 50,
        loggerInstance: mockLogger as any,
      });

      diagnostics.markStartupComplete();

      // Sample 1: Jumps by 50% in a single interval
      const originalMemoryUsage = process.memoryUsage;
      const baseMem = originalMemoryUsage();

      vi.spyOn(process, 'memoryUsage').mockReturnValue({
        ...baseMem,
        heapUsed: baseMem.heapUsed * 1.5, // 50% single spike
      });

      diagnostics.sample();

      // Should NOT have warned because consecutive growth count is only 1 (< 3 required)
      const warnings = mockLogger.warn.mock.calls.filter(
        ([, msg]) => msg === 'Significant heap growth detected',
      );
      expect(warnings.length).toBe(0);
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(1);
    });

    it('does NOT trigger growth warning when heap is below minHeapThresholdMB', () => {
      const diagnostics = new MemoryDiagnostics({
        growthThreshold: 0.15,
        consecutiveSamplesRequired: 2,
        minHeapThresholdMB: 200, // High threshold
        loggerInstance: mockLogger as any,
      });

      diagnostics.markStartupComplete();

      // Simulate 3 consecutive growths but with low heap (e.g. 20MB -> 25MB -> 30MB)
      const fakeHeap = (mb: number) => ({
        heapUsed: mb * 1024 * 1024,
        heapTotal: (mb + 20) * 1024 * 1024,
        rss: (mb + 40) * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      });

      vi.spyOn(process, 'memoryUsage')
        .mockReturnValueOnce(fakeHeap(30))
        .mockReturnValueOnce(fakeHeap(40))
        .mockReturnValueOnce(fakeHeap(50));

      diagnostics.sample();
      diagnostics.sample();
      diagnostics.sample();

      // Below 200MB minHeapThresholdMB, so no alert
      const warnings = mockLogger.warn.mock.calls.filter(
        ([, msg]) => msg === 'Significant heap growth detected',
      );
      expect(warnings.length).toBe(0);
    });

    it('triggers growth warning when sustained multi-sample growth exceeds threshold', () => {
      const diagnostics = new MemoryDiagnostics({
        growthThreshold: 0.20, // 20%
        consecutiveSamplesRequired: 3,
        minHeapThresholdMB: 50,
        loggerInstance: mockLogger as any,
      });

      const fakeHeap = (mb: number) => ({
        heapUsed: mb * 1024 * 1024,
        heapTotal: (mb + 30) * 1024 * 1024,
        rss: (mb + 50) * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      });

      // Startup baseline: 60 MB
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(60));
      diagnostics.markStartupComplete();

      // Sample 1: 65 MB (growth 1)
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(65));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(1);

      // Sample 2: 72 MB (growth 2)
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(72));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(2);

      // Sample 3: 80 MB (growth 3: (80 - 60) / 60 = +33% > 20% threshold)
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(80));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(3);

      // Sustained growth detected!
      const warnings = mockLogger.warn.mock.calls.filter(
        ([, msg]) => msg === 'Significant heap growth detected',
      );
      expect(warnings.length).toBe(1);
      const loggedData = warnings[0][0];
      expect(loggedData).toHaveProperty('heapUsedMB', 80);
      expect(loggedData).toHaveProperty('growthPercent');
      expect(loggedData.consecutiveGrowthIntervals).toBe(3);
      expect(loggedData).toHaveProperty('arrayBuffersMB');
      expect(loggedData).toHaveProperty('externalMB');
    });

    it('resets consecutive growth count when memory drops after GC', () => {
      const diagnostics = new MemoryDiagnostics({
        growthThreshold: 0.20,
        consecutiveSamplesRequired: 3,
        minHeapThresholdMB: 50,
        loggerInstance: mockLogger as any,
      });

      const fakeHeap = (mb: number) => ({
        heapUsed: mb * 1024 * 1024,
        heapTotal: (mb + 30) * 1024 * 1024,
        rss: (mb + 50) * 1024 * 1024,
        external: 5 * 1024 * 1024,
        arrayBuffers: 2 * 1024 * 1024,
      });

      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(60));
      diagnostics.markStartupComplete();

      // Growth 1: 70 MB
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(70));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(1);

      // Growth 2: 78 MB
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(78));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(2);

      // Memory drop (GC ran): drops to 55 MB
      vi.spyOn(process, 'memoryUsage').mockReturnValue(fakeHeap(55));
      diagnostics.sample();
      expect(diagnostics.getConsecutiveGrowthCount()).toBe(0);

      // Should NOT have triggered warning
      const warnings = mockLogger.warn.mock.calls.filter(
        ([, msg]) => msg === 'Significant heap growth detected',
      );
      expect(warnings.length).toBe(0);
    });
  });

  describe('Diagnostic GC & Production Protection Guard', () => {
    it('strictly prohibits explicit GC in production mode', () => {
      const originalEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = 'production';
        const diagnostics = new MemoryDiagnostics({
          loggerInstance: mockLogger as any,
        });

        const result = diagnostics.triggerDiagnosticGC('test_call');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('PROHIBITED_IN_PRODUCTION');
        expect(mockLogger.warn).toHaveBeenCalledWith(
          expect.objectContaining({ callerContext: 'test_call' }),
          expect.stringContaining('strictly prohibited in production'),
        );
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('handles non-production diagnostic GC safely when exposed', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalGc = (globalThis as any).gc;
      try {
        process.env.NODE_ENV = 'development';
        const mockGc = vi.fn();
        (globalThis as any).gc = mockGc;

        const diagnostics = new MemoryDiagnostics({
          loggerInstance: mockLogger as any,
        });

        const result = diagnostics.triggerDiagnosticGC('stress_test');
        expect(result.success).toBe(true);
        expect(mockGc).toHaveBeenCalledTimes(1);
        expect(result).toHaveProperty('before');
        expect(result).toHaveProperty('after');
        expect(result).toHaveProperty('freedMB');
        expect(diagnostics.getPostGcMemory()).not.toBeNull();
      } finally {
        process.env.NODE_ENV = originalEnv;
        (globalThis as any).gc = originalGc;
      }
    });

    it('returns GC_NOT_EXPOSED when --expose-gc is not enabled', () => {
      const originalEnv = process.env.NODE_ENV;
      const originalGc = (globalThis as any).gc;
      try {
        process.env.NODE_ENV = 'development';
        delete (globalThis as any).gc;

        const diagnostics = new MemoryDiagnostics({
          loggerInstance: mockLogger as any,
        });

        const result = diagnostics.triggerDiagnosticGC('check_gc');
        expect(result.success).toBe(false);
        expect(result.reason).toBe('GC_NOT_EXPOSED');
      } finally {
        process.env.NODE_ENV = originalEnv;
        (globalThis as any).gc = originalGc;
      }
    });
  });

  describe('getReport', () => {
    it('returns comprehensive memory metrics and delta structure', () => {
      const diagnostics = new MemoryDiagnostics({
        loggerInstance: mockLogger as any,
      });

      diagnostics.markStartupComplete();
      const report = diagnostics.getReport();

      expect(report).toHaveProperty('startup');
      expect(report).toHaveProperty('current');
      expect(report).toHaveProperty('postGc');
      expect(report).toHaveProperty('deltas');
      expect(report).toHaveProperty('history');
      expect(report.deltas).toHaveProperty('deltaFromStartupMB');
      expect(report.deltas).toHaveProperty('deltaFromPreviousMB');
      expect(report.deltas).toHaveProperty('consecutiveGrowthCount');
      expect(report.deltas).toHaveProperty('sustainedGrowthPercent');
      expect(Array.isArray(report.history)).toBe(true);
    });
  });
});
