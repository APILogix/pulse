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
    growthThreshold?: number;
    consecutiveSamplesRequired?: number;
    minHeapThresholdMB?: number;
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
export declare function captureMemorySnapshot(): MemorySnapshot;
export declare class MemoryDiagnostics {
    private startupMemory;
    private postGcMemory;
    private previousSnapshot;
    private readonly history;
    private timer;
    private consecutiveGrowthCount;
    private runStartHeapMB;
    private isStartupComplete;
    private readonly log;
    private readonly config;
    constructor(customConfig?: MemoryDiagnosticsConfig);
    /**
     * Start the periodic background memory monitoring interval.
     */
    startMonitoring(): void;
    /**
     * Stop the monitoring timer for clean teardown during shutdown.
     */
    stopMonitoring(): void;
    /**
     * Called once bootstrap has connected to datastores and completed initial
     * setup. Establishes the authoritative startup baseline for subsequent delta
     * tracking.
     */
    markStartupComplete(): MemorySnapshot;
    /**
     * Execute a single measurement cycle and perform multi-sample growth evaluation.
     */
    sample(): MemorySnapshot;
    /**
     * Diagnostic GC trigger — STRICTLY PROHIBITED in production execution paths.
     * Only allows execution when Node.js runs with --expose-gc in non-production.
     */
    triggerDiagnosticGC(callerContext?: string): DiagnosticGcResult;
    /**
     * Capture a post-GC memory reference, either by executing diagnostic GC
     * (if available) or taking a current snapshot after natural GC.
     */
    recordPostGcMemory(snapshot?: MemorySnapshot): MemorySnapshot;
    /**
     * Comprehensive memory report covering startup, current, post-GC, and deltas.
     */
    getReport(): MemoryDiagnosticReport;
    getStartupMemory(): MemorySnapshot | null;
    getPostGcMemory(): MemorySnapshot | null;
    getConsecutiveGrowthCount(): number;
    private recordHistory;
}
export declare const memoryDiagnostics: MemoryDiagnostics;
//# sourceMappingURL=memory-diagnostics.d.ts.map