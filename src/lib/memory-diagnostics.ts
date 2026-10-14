/**
 * Memory Diagnostics & Multi-Sample Heap Monitoring.
 *
 * Provides high-fidelity memory instrumentation using process.memoryUsage():
 *   - Captures heapUsed, heapTotal, rss, external, and arrayBuffers in MB.
 *   - Distinguishes between startup baseline memory, current memory, post-GC
 *     memory, and multi-sample growth deltas.
 *   - Refines heap growth alerting to detect sustained multi-sample growth
 *     across multiple consecutive check intervals, eliminating false alarms
 *     from single-interval allocations or normal startup ramp-up.
 *   - Provides safe diagnostic GC triggering strictly limited to non-production
 *     environments running with --expose-gc (strictly prohibited in production).
 */
import type { Logger } from 'pino';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export interface MemorySnapshot {
  heapUsedMB: number;
  heapTotalMB: number;
  rssMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  timestamp: string;
}

export interface MemoryGrowthDeltas {
  deltaFromStartupMB: number;
  deltaFromPreviousMB: number;
  deltaFromPostGcMB: number | null;
  consecutiveGrowthCount: number;
  sustainedGrowthPercent: number;
}

export interface MemoryDiagnosticReport {
  startup: MemorySnapshot | null;
  current: MemorySnapshot;
  postGc: MemorySnapshot | null;
  deltas: MemoryGrowthDeltas;
  history: MemorySnapshot[];
  isDiagnosticMode: boolean;
  isGcAvailable: boolean;
  monitoringActive: boolean;
  consecutiveGrowthCount: number;
  alertThresholdPercent: number;
  consecutiveSamplesRequired: number;
  minHeapThresholdMB: number;
}

export interface MemoryDiagnosticsConfig {
  enabled?: boolean;
  checkIntervalMs?: number;
  growthThreshold?: number; // e.g. 0.20 for 20%
  consecutiveSamplesRequired?: number; // e.g. 3
  minHeapThresholdMB?: number; // e.g. 128 MB
  logSamples?: boolean;
  maxHistoryLength?: number;
  loggerInstance?: Logger;
}

export interface DiagnosticGcResult {
  success: boolean;
  reason?: string;
  before?: MemorySnapshot;
  after?: MemorySnapshot;
  freedMB?: number;
}

function toMB(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

export function captureMemorySnapshot(): MemorySnapshot {
  const mem = process.memoryUsage();
  return {
    heapUsedMB: toMB(mem.heapUsed),
    heapTotalMB: toMB(mem.heapTotal),
    rssMB: toMB(mem.rss),
    externalMB: toMB(mem.external),
    arrayBuffersMB: toMB(mem.arrayBuffers),
    timestamp: new Date().toISOString(),
  };
}

export class MemoryDiagnostics {
  private startupMemory: MemorySnapshot | null = null;
  private postGcMemory: MemorySnapshot | null = null;
  private previousSnapshot: MemorySnapshot | null = null;
  private readonly history: MemorySnapshot[] = [];
  private timer: NodeJS.Timeout | null = null;
  private consecutiveGrowthCount = 0;
  private runStartHeapMB = 0;
  private isStartupComplete = false;
  private readonly log: Logger;
  private readonly config: Required<MemoryDiagnosticsConfig>;

  constructor(customConfig?: MemoryDiagnosticsConfig) {
    this.log = customConfig?.loggerInstance ?? logger.child({ component: 'memory-diagnostics' });
    this.config = {
      enabled: customConfig?.enabled ?? (env.MEMORY_DIAGNOSTICS_ENABLED ?? true),
      checkIntervalMs: customConfig?.checkIntervalMs ?? (env.MEMORY_CHECK_INTERVAL_MS ?? 60_000),
      growthThreshold: customConfig?.growthThreshold ?? (env.MEMORY_GROWTH_THRESHOLD ?? 0.20),
      consecutiveSamplesRequired: customConfig?.consecutiveSamplesRequired ?? (env.MEMORY_CONSECUTIVE_SAMPLES ?? 3),
      minHeapThresholdMB: customConfig?.minHeapThresholdMB ?? (env.MEMORY_MIN_HEAP_THRESHOLD_MB ?? 128),
      logSamples: customConfig?.logSamples ?? (env.MEMORY_DIAGNOSTIC_LOG_SAMPLES ?? false),
      maxHistoryLength: customConfig?.maxHistoryLength ?? 60,
      loggerInstance: this.log,
    };
  }

  /**
   * Start the periodic background memory monitoring interval.
   */
  startMonitoring(): void {
    if (!this.config.enabled || this.timer) return;

    this.timer = setInterval(() => {
      this.sample();
    }, this.config.checkIntervalMs);
    this.timer.unref?.();

    this.log.debug(
      {
        intervalMs: this.config.checkIntervalMs,
        thresholdPercent: Math.round(this.config.growthThreshold * 100),
        consecutiveRequired: this.config.consecutiveSamplesRequired,
        minHeapMB: this.config.minHeapThresholdMB,
      },
      'Memory diagnostics monitoring started',
    );
  }

  /**
   * Stop the monitoring timer for clean teardown during shutdown.
   */
  stopMonitoring(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.debug('Memory diagnostics monitoring stopped');
    }
  }

  /**
   * Called once bootstrap has connected to datastores and completed initial
   * setup. Establishes the authoritative startup baseline for subsequent delta
   * tracking.
   */
  markStartupComplete(): MemorySnapshot {
    this.isStartupComplete = true;
    const current = captureMemorySnapshot();
    this.startupMemory = current;
    this.previousSnapshot = current;
    this.consecutiveGrowthCount = 0;
    this.runStartHeapMB = current.heapUsedMB;
    this.recordHistory(current);

    this.log.info(
      {
        startupHeapUsedMB: current.heapUsedMB,
        startupHeapTotalMB: current.heapTotalMB,
        startupRssMB: current.rssMB,
        startupExternalMB: current.externalMB,
        startupArrayBuffersMB: current.arrayBuffersMB,
      },
      'Startup memory baseline established',
    );

    return current;
  }

  /**
   * Execute a single measurement cycle and perform multi-sample growth evaluation.
   */
  sample(): MemorySnapshot {
    const current = captureMemorySnapshot();
    this.recordHistory(current);

    // If startup has not yet been marked complete, establish temporary initial reference
    if (!this.startupMemory) {
      this.startupMemory = current;
      this.previousSnapshot = current;
      this.runStartHeapMB = current.heapUsedMB;
      return current;
    }

    if (this.previousSnapshot) {
      const prevHeap = this.previousSnapshot.heapUsedMB;
      const currentHeap = current.heapUsedMB;

      // Determine directional trajectory
      if (currentHeap > prevHeap) {
        if (this.consecutiveGrowthCount === 0) {
          this.runStartHeapMB = prevHeap;
        }
        this.consecutiveGrowthCount += 1;
      } else if (currentHeap < prevHeap * 0.96) {
        // Meaningful reduction in heap (>4% drop), typically from GC sweep
        this.consecutiveGrowthCount = 0;
        this.runStartHeapMB = currentHeap;
      } else {
        // Stable within +-4% plateau
        this.consecutiveGrowthCount = 0;
        this.runStartHeapMB = currentHeap;
      }

      // Evaluate sustained multi-sample growth
      const sustainedGrowth = this.runStartHeapMB > 0
        ? (currentHeap - this.runStartHeapMB) / this.runStartHeapMB
        : 0;

      if (
        this.isStartupComplete &&
        this.consecutiveGrowthCount >= this.config.consecutiveSamplesRequired &&
        sustainedGrowth >= this.config.growthThreshold &&
        currentHeap >= this.config.minHeapThresholdMB
      ) {
        this.log.warn(
          {
            heapUsedMB: current.heapUsedMB,
            heapTotalMB: current.heapTotalMB,
            rssMB: current.rssMB,
            externalMB: current.externalMB,
            arrayBuffersMB: current.arrayBuffersMB,
            growthPercent: Math.round(sustainedGrowth * 100),
            consecutiveGrowthIntervals: this.consecutiveGrowthCount,
            startupHeapUsedMB: this.startupMemory.heapUsedMB,
            postGcHeapUsedMB: this.postGcMemory?.heapUsedMB ?? null,
            deltaFromStartupMB: Math.round((current.heapUsedMB - this.startupMemory.heapUsedMB) * 100) / 100,
          },
          'Significant heap growth detected',
        );
      } else if (this.config.logSamples) {
        this.log.debug(
          {
            heapUsedMB: current.heapUsedMB,
            heapTotalMB: current.heapTotalMB,
            rssMB: current.rssMB,
            externalMB: current.externalMB,
            arrayBuffersMB: current.arrayBuffersMB,
            consecutiveGrowthCount: this.consecutiveGrowthCount,
          },
          'Memory sample captured',
        );
      }
    }

    this.previousSnapshot = current;
    return current;
  }

  /**
   * Diagnostic GC trigger — STRICTLY PROHIBITED in production execution paths.
   * Only allows execution when Node.js runs with --expose-gc in non-production.
   */
  triggerDiagnosticGC(callerContext = 'diagnostic_call'): DiagnosticGcResult {
    if (process.env.NODE_ENV === 'production') {
      this.log.warn(
        { callerContext },
        'Explicit GC invocation is strictly prohibited in production mode',
      );
      return { success: false, reason: 'PROHIBITED_IN_PRODUCTION' };
    }

    const gc = (globalThis as unknown as { gc?: () => void }).gc;
    if (typeof gc !== 'function') {
      this.log.debug(
        { callerContext },
        'Explicit GC requested but process was not started with --expose-gc',
      );
      return { success: false, reason: 'GC_NOT_EXPOSED' };
    }

    const before = captureMemorySnapshot();
    gc();
    const after = captureMemorySnapshot();

    this.postGcMemory = after;
    this.previousSnapshot = after;
    this.consecutiveGrowthCount = 0;
    this.runStartHeapMB = after.heapUsedMB;
    this.recordHistory(after);

    const freedMB = Math.round((before.heapUsedMB - after.heapUsedMB) * 100) / 100;
    this.log.info(
      {
        callerContext,
        heapBeforeMB: before.heapUsedMB,
        heapAfterMB: after.heapUsedMB,
        freedMB,
        rssMB: after.rssMB,
      },
      'Diagnostic GC executed successfully',
    );

    return {
      success: true,
      before,
      after,
      freedMB,
    };
  }

  /**
   * Capture a post-GC memory reference, either by executing diagnostic GC
   * (if available) or taking a current snapshot after natural GC.
   */
  recordPostGcMemory(snapshot?: MemorySnapshot): MemorySnapshot {
    const s = snapshot ?? captureMemorySnapshot();
    this.postGcMemory = s;
    this.consecutiveGrowthCount = 0;
    this.runStartHeapMB = s.heapUsedMB;
    return s;
  }

  /**
   * Comprehensive memory report covering startup, current, post-GC, and deltas.
   */
  getReport(): MemoryDiagnosticReport {
    const current = captureMemorySnapshot();
    const startup = this.startupMemory;
    const postGc = this.postGcMemory;

    const deltaFromStartupMB = startup
      ? Math.round((current.heapUsedMB - startup.heapUsedMB) * 100) / 100
      : 0;
    const deltaFromPreviousMB = this.previousSnapshot
      ? Math.round((current.heapUsedMB - this.previousSnapshot.heapUsedMB) * 100) / 100
      : 0;
    const deltaFromPostGcMB = postGc
      ? Math.round((current.heapUsedMB - postGc.heapUsedMB) * 100) / 100
      : null;

    const sustainedGrowthPercent = this.runStartHeapMB > 0
      ? Math.round(((current.heapUsedMB - this.runStartHeapMB) / this.runStartHeapMB) * 100)
      : 0;

    return {
      startup,
      current,
      postGc,
      deltas: {
        deltaFromStartupMB,
        deltaFromPreviousMB,
        deltaFromPostGcMB,
        consecutiveGrowthCount: this.consecutiveGrowthCount,
        sustainedGrowthPercent,
      },
      history: [...this.history],
      isDiagnosticMode: env.NODE_ENV !== 'production' || Boolean(this.config.enabled),
      isGcAvailable: typeof (globalThis as unknown as { gc?: unknown }).gc === 'function',
      monitoringActive: this.timer !== null,
      consecutiveGrowthCount: this.consecutiveGrowthCount,
      alertThresholdPercent: Math.round(this.config.growthThreshold * 100),
      consecutiveSamplesRequired: this.config.consecutiveSamplesRequired,
      minHeapThresholdMB: this.config.minHeapThresholdMB,
    };
  }

  getStartupMemory(): MemorySnapshot | null {
    return this.startupMemory;
  }

  getPostGcMemory(): MemorySnapshot | null {
    return this.postGcMemory;
  }

  getConsecutiveGrowthCount(): number {
    return this.consecutiveGrowthCount;
  }

  private recordHistory(snapshot: MemorySnapshot): void {
    this.history.push(snapshot);
    if (this.history.length > this.config.maxHistoryLength) {
      this.history.shift();
    }
  }
}

export const memoryDiagnostics = new MemoryDiagnostics();
