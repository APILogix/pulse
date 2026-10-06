import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
function toMB(bytes) {
    return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}
export function captureMemorySnapshot() {
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
    startupMemory = null;
    postGcMemory = null;
    previousSnapshot = null;
    history = [];
    timer = null;
    consecutiveGrowthCount = 0;
    runStartHeapMB = 0;
    isStartupComplete = false;
    log;
    config;
    constructor(customConfig) {
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
    startMonitoring() {
        if (!this.config.enabled || this.timer)
            return;
        this.timer = setInterval(() => {
            this.sample();
        }, this.config.checkIntervalMs);
        this.timer.unref?.();
        this.log.debug({
            intervalMs: this.config.checkIntervalMs,
            thresholdPercent: Math.round(this.config.growthThreshold * 100),
            consecutiveRequired: this.config.consecutiveSamplesRequired,
            minHeapMB: this.config.minHeapThresholdMB,
        }, 'Memory diagnostics monitoring started');
    }
    /**
     * Stop the monitoring timer for clean teardown during shutdown.
     */
    stopMonitoring() {
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
    markStartupComplete() {
        this.isStartupComplete = true;
        const current = captureMemorySnapshot();
        this.startupMemory = current;
        this.previousSnapshot = current;
        this.consecutiveGrowthCount = 0;
        this.runStartHeapMB = current.heapUsedMB;
        this.recordHistory(current);
        this.log.info({
            startupHeapUsedMB: current.heapUsedMB,
            startupHeapTotalMB: current.heapTotalMB,
            startupRssMB: current.rssMB,
            startupExternalMB: current.externalMB,
            startupArrayBuffersMB: current.arrayBuffersMB,
        }, 'Startup memory baseline established');
        return current;
    }
    /**
     * Execute a single measurement cycle and perform multi-sample growth evaluation.
     */
    sample() {
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
            }
            else if (currentHeap < prevHeap * 0.96) {
                // Meaningful reduction in heap (>4% drop), typically from GC sweep
                this.consecutiveGrowthCount = 0;
                this.runStartHeapMB = currentHeap;
            }
            else {
                // Stable within +-4% plateau
                this.consecutiveGrowthCount = 0;
                this.runStartHeapMB = currentHeap;
            }
            // Evaluate sustained multi-sample growth
            const sustainedGrowth = this.runStartHeapMB > 0
                ? (currentHeap - this.runStartHeapMB) / this.runStartHeapMB
                : 0;
            if (this.isStartupComplete &&
                this.consecutiveGrowthCount >= this.config.consecutiveSamplesRequired &&
                sustainedGrowth >= this.config.growthThreshold &&
                currentHeap >= this.config.minHeapThresholdMB) {
                this.log.warn({
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
                }, 'Significant heap growth detected');
            }
            else if (this.config.logSamples) {
                this.log.debug({
                    heapUsedMB: current.heapUsedMB,
                    heapTotalMB: current.heapTotalMB,
                    rssMB: current.rssMB,
                    externalMB: current.externalMB,
                    arrayBuffersMB: current.arrayBuffersMB,
                    consecutiveGrowthCount: this.consecutiveGrowthCount,
                }, 'Memory sample captured');
            }
        }
        this.previousSnapshot = current;
        return current;
    }
    /**
     * Diagnostic GC trigger — STRICTLY PROHIBITED in production execution paths.
     * Only allows execution when Node.js runs with --expose-gc in non-production.
     */
    triggerDiagnosticGC(callerContext = 'diagnostic_call') {
        if (process.env.NODE_ENV === 'production') {
            this.log.warn({ callerContext }, 'Explicit GC invocation is strictly prohibited in production mode');
            return { success: false, reason: 'PROHIBITED_IN_PRODUCTION' };
        }
        const gc = globalThis.gc;
        if (typeof gc !== 'function') {
            this.log.debug({ callerContext }, 'Explicit GC requested but process was not started with --expose-gc');
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
        this.log.info({
            callerContext,
            heapBeforeMB: before.heapUsedMB,
            heapAfterMB: after.heapUsedMB,
            freedMB,
            rssMB: after.rssMB,
        }, 'Diagnostic GC executed successfully');
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
    recordPostGcMemory(snapshot) {
        const s = snapshot ?? captureMemorySnapshot();
        this.postGcMemory = s;
        this.consecutiveGrowthCount = 0;
        this.runStartHeapMB = s.heapUsedMB;
        return s;
    }
    /**
     * Comprehensive memory report covering startup, current, post-GC, and deltas.
     */
    getReport() {
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
            isGcAvailable: typeof globalThis.gc === 'function',
            monitoringActive: this.timer !== null,
            consecutiveGrowthCount: this.consecutiveGrowthCount,
            alertThresholdPercent: Math.round(this.config.growthThreshold * 100),
            consecutiveSamplesRequired: this.config.consecutiveSamplesRequired,
            minHeapThresholdMB: this.config.minHeapThresholdMB,
        };
    }
    getStartupMemory() {
        return this.startupMemory;
    }
    getPostGcMemory() {
        return this.postGcMemory;
    }
    getConsecutiveGrowthCount() {
        return this.consecutiveGrowthCount;
    }
    recordHistory(snapshot) {
        this.history.push(snapshot);
        if (this.history.length > this.config.maxHistoryLength) {
            this.history.shift();
        }
    }
}
export const memoryDiagnostics = new MemoryDiagnostics();
//# sourceMappingURL=memory-diagnostics.js.map