/**
 * Enterprise Admission Control & Tiered Load Shedding.
 *
 * Implements high-throughput SRE admission control patterns (Google SRE / Netflix):
 * 1. Rolling EWMA (Exponential Weighted Moving Average) event loop delay smoothing:
 *    Eliminates false-positive jitter caused by single-tick GC sweeps, timer drift,
 *    or cold-start JIT bursts.
 * 2. Multi-sample sustained breach confirmation:
 *    Requires consecutive intervals above threshold before triggering shedding,
 *    preventing flapping and oscillation.
 * 3. Tiered Priority-Aware Load Shedding:
 *    - CRITICAL: Health probes, Auth (login/session), Billing webhooks. Protected at all times.
 *    - STANDARD: Regular REST APIs (dashboards, projects, org settings).
 *    - SHEDDABLE: Telemetry, event ingestion, batch logs, live spans. Shed FIRST
 *      under elevated pressure because SDKs buffer and retry with exponential backoff.
 * 4. Fast adaptive recovery:
 *    Samples every 500ms (configurable) and rapidly recovers once pressure clears,
 *    preventing the server from being trapped in 1-second rejection lockups.
 */
import type { IntervalHistogram } from 'node:perf_hooks';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { Logger } from 'pino';
export declare enum RequestTier {
    CRITICAL = "critical",
    STANDARD = "standard",
    SHEDDABLE = "sheddable"
}
export declare enum AdmissionPressureState {
    HEALTHY = "HEALTHY",
    ELEVATED = "ELEVATED",
    SATURATED = "SATURATED",
    EMERGENCY = "EMERGENCY"
}
export interface AdmissionControlConfig {
    maxEventLoopDelayMs: number;
    criticalEventLoopDelayMs: number;
    maxEventLoopUtilization: number;
    maxHeapBytes: number;
    maxRssBytes: number;
    samplingIntervalMs: number;
    consecutiveBreachesRequired: number;
    tieredSheddingEnabled: boolean;
    logIntervalMs: number;
}
export interface AdmissionMetrics {
    rawDelayMs: number;
    smoothedDelayMs: number;
    utilization: number;
    consecutiveBreaches: number;
    state: AdmissionPressureState;
    heapUsedMB: number;
    rssMB: number;
}
/**
 * Classifies an incoming HTTP request into an operational priority tier.
 */
export declare function classifyRequestTier(url: string, method?: string): RequestTier;
export declare class EnterpriseAdmissionController {
    private readonly config;
    private readonly logger;
    private readonly histogramFactory;
    private readonly readElu;
    private histogram;
    private previousElu;
    private timer;
    private rawDelayMs;
    private smoothedDelayMs;
    private recentUtilization;
    private consecutiveBreaches;
    private currentState;
    private lastLogAt;
    private suppressedLogCount;
    private lastSampleTime;
    constructor(config: AdmissionControlConfig, logger: Logger, histogramFactory?: () => IntervalHistogram, readElu?: () => {
        active: number;
        idle: number;
        utilization: number;
    });
    /**
     * Starts the background sampling timer.
     */
    start(): void;
    /**
     * Stops the sampling timer and disables the histogram.
     */
    stop(): void;
    /**
     * Samples event loop delay and utilization.
     * Uses EWMA (alpha = 0.35) for smooth tracking and avoids false-positive traps.
     */
    sample(): AdmissionMetrics;
    getMetrics(): AdmissionMetrics;
    /**
     * Evaluates an incoming request and determines if it should be shed.
     * Returns null if allowed, or the 503 response payload if rejected.
     */
    evaluateRequest(request: FastifyRequest, reply: FastifyReply): {
        error: string;
        retryAfter: number;
        reason: string;
        tier: RequestTier;
    } | null;
}
//# sourceMappingURL=admission-control.d.ts.map