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
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
export var RequestTier;
(function (RequestTier) {
    RequestTier["CRITICAL"] = "critical";
    RequestTier["STANDARD"] = "standard";
    RequestTier["SHEDDABLE"] = "sheddable";
})(RequestTier || (RequestTier = {}));
export var AdmissionPressureState;
(function (AdmissionPressureState) {
    AdmissionPressureState["HEALTHY"] = "HEALTHY";
    AdmissionPressureState["ELEVATED"] = "ELEVATED";
    AdmissionPressureState["SATURATED"] = "SATURATED";
    AdmissionPressureState["EMERGENCY"] = "EMERGENCY";
})(AdmissionPressureState || (AdmissionPressureState = {}));
/**
 * Classifies an incoming HTTP request into an operational priority tier.
 */
export function classifyRequestTier(url, method = 'GET') {
    if (method === 'OPTIONS') {
        return RequestTier.CRITICAL;
    }
    // Normalize path without query parameters or trailing slashes
    const path = (url.split('?')[0] ?? '').toLowerCase().replace(/\/+$/, '') || '/';
    // ── Tier 0: Critical (Must not be shed during elevated/saturated load) ──
    // Liveness, readiness, metrics, diagnostics
    if (path === '/health' ||
        path.startsWith('/health/') ||
        path === '/live' ||
        path.startsWith('/live/') ||
        path === '/ready' ||
        path.startsWith('/ready/') ||
        path === '/healthz' ||
        path.startsWith('/healthz/') ||
        path === '/metrics' ||
        path.startsWith('/diagnostics/')) {
        return RequestTier.CRITICAL;
    }
    // Core Authentication & Session lifecycle
    if (path.startsWith('/auth/login') ||
        path.startsWith('/auth/session') ||
        path.startsWith('/auth/refresh') ||
        path.startsWith('/auth/mfa') ||
        path.startsWith('/auth/logout') ||
        path.startsWith('/auth/oauth') ||
        path.startsWith('/auth/saml')) {
        return RequestTier.CRITICAL;
    }
    // Critical external webhooks (e.g. Stripe payment events)
    if (path.startsWith('/billing/webhook') || path.startsWith('/webhooks/stripe')) {
        return RequestTier.CRITICAL;
    }
    // ── Tier 2: Sheddable (High-volume ingestion & analytics) ──
    // Telemetry, SDK event ingestion, and live tracing have built-in client retries/buffering
    if (path.startsWith('/api/v1/telemetry') ||
        path.startsWith('/api/v1/ingest') ||
        path.startsWith('/ingest') ||
        path.includes('/observability/live') ||
        path.includes('/analytics/export')) {
        return RequestTier.SHEDDABLE;
    }
    // ── Tier 1: Standard (Regular API requests) ──
    return RequestTier.STANDARD;
}
export class EnterpriseAdmissionController {
    config;
    logger;
    histogramFactory;
    readElu;
    histogram = null;
    previousElu = performance.eventLoopUtilization();
    timer = null;
    rawDelayMs = 0;
    smoothedDelayMs = 0;
    recentUtilization = 0;
    consecutiveBreaches = 0;
    currentState = AdmissionPressureState.HEALTHY;
    lastLogAt = 0;
    suppressedLogCount = 0;
    lastSampleTime = performance.now();
    constructor(config, logger, histogramFactory = () => monitorEventLoopDelay({ resolution: 10 }), readElu = () => performance.eventLoopUtilization()) {
        this.config = config;
        this.logger = logger;
        this.histogramFactory = histogramFactory;
        this.readElu = readElu;
        this.previousElu = this.readElu();
        try {
            this.histogram = this.histogramFactory();
            this.histogram.enable();
        }
        catch {
            this.histogram = null;
        }
    }
    /**
     * Starts the background sampling timer.
     */
    start() {
        if (this.timer)
            return;
        this.timer = setInterval(() => {
            this.sample();
        }, this.config.samplingIntervalMs);
        this.timer.unref();
    }
    /**
     * Stops the sampling timer and disables the histogram.
     */
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        if (this.histogram) {
            try {
                this.histogram.disable();
            }
            catch {
                // Ignore errors during shutdown
            }
        }
    }
    /**
     * Samples event loop delay and utilization.
     * Uses EWMA (alpha = 0.35) for smooth tracking and avoids false-positive traps.
     */
    sample() {
        // 1. Sample Event Loop Delay
        if (this.histogram) {
            if (this.histogram.count > 0) {
                // Convert nanoseconds to milliseconds, subtracting resolution
                const measured = Math.max(0, this.histogram.mean / 1e6 - 10);
                this.rawDelayMs = Number.isFinite(measured) ? measured : 0;
            }
            else {
                // Zero samples recorded in interval -> idle or zero tick drift
                this.rawDelayMs = 0;
            }
            this.histogram.reset();
        }
        else {
            this.rawDelayMs = 0;
        }
        // 2. EWMA Smoothing
        const alpha = 0.35;
        if (this.rawDelayMs > 0) {
            this.smoothedDelayMs =
                this.smoothedDelayMs === 0
                    ? this.rawDelayMs
                    : this.smoothedDelayMs * (1 - alpha) + this.rawDelayMs * alpha;
        }
        else {
            // Fast decay when event loop is running smoothly
            this.smoothedDelayMs *= 0.5;
            if (this.smoothedDelayMs < 1)
                this.smoothedDelayMs = 0;
        }
        // 3. Sample Event Loop Utilization (ELU)
        const now = performance.now();
        const elapsedWallMs = Math.max(1, now - this.lastSampleTime);
        this.lastSampleTime = now;
        const currentElu = this.readElu();
        const active = Math.max(0, currentElu.active - this.previousElu.active);
        const idle = Math.max(0, currentElu.idle - this.previousElu.idle);
        this.previousElu = currentElu;
        const totalRecorded = active + idle;
        // Guard against near-zero elapsed time and zero-idle artifacts:
        // When idle or when only a sparse timer fires without I/O descriptors, libuv's idle
        // delta can be 0. Dividing active / (active + 0) produces 1.0 even if active was only 0.2ms.
        // If active execution time is negligible (< 10ms) or total recorded time is < 10ms, true utilization is 0.
        // For non-negligible active time, normalize against the max of recorded time and 50% of the elapsed window.
        if (totalRecorded < 10 || active < 10) {
            this.recentUtilization = 0;
        }
        else {
            const effectiveWindow = Math.max(totalRecorded, elapsedWallMs * 0.5);
            this.recentUtilization = Math.min(1, active / effectiveWindow);
        }
        // 4. Consecutive Breach Tracking & State Transitions
        const delayBreached = this.smoothedDelayMs > this.config.maxEventLoopDelayMs ||
            this.rawDelayMs > this.config.maxEventLoopDelayMs;
        const eluBreached = this.recentUtilization > this.config.maxEventLoopUtilization;
        if (delayBreached || eluBreached) {
            this.consecutiveBreaches += 1;
        }
        else {
            this.consecutiveBreaches = Math.max(0, this.consecutiveBreaches - 1);
        }
        // Determine current AdmissionPressureState
        const memory = process.memoryUsage();
        const isHeapCritical = this.config.maxHeapBytes > 0 && memory.heapUsed >= this.config.maxHeapBytes * 0.95;
        const isDelayEmergency = this.smoothedDelayMs >= this.config.criticalEventLoopDelayMs ||
            this.rawDelayMs >= this.config.criticalEventLoopDelayMs;
        if (isHeapCritical || isDelayEmergency) {
            this.currentState = AdmissionPressureState.EMERGENCY;
        }
        else if (this.consecutiveBreaches >= this.config.consecutiveBreachesRequired &&
            (delayBreached || eluBreached)) {
            this.currentState = AdmissionPressureState.SATURATED;
        }
        else if (delayBreached ||
            eluBreached ||
            this.smoothedDelayMs > this.config.maxEventLoopDelayMs * 0.5 ||
            this.rawDelayMs > this.config.maxEventLoopDelayMs * 0.75 ||
            this.recentUtilization > 0.85) {
            this.currentState = AdmissionPressureState.ELEVATED;
        }
        else {
            this.currentState = AdmissionPressureState.HEALTHY;
        }
        return this.getMetrics();
    }
    getMetrics() {
        const memory = process.memoryUsage();
        return {
            rawDelayMs: Math.round(this.rawDelayMs),
            smoothedDelayMs: Math.round(this.smoothedDelayMs),
            utilization: Math.round(this.recentUtilization * 100) / 100,
            consecutiveBreaches: this.consecutiveBreaches,
            state: this.currentState,
            heapUsedMB: Math.round(memory.heapUsed / 1024 / 1024),
            rssMB: Math.round(memory.rss / 1024 / 1024),
        };
    }
    /**
     * Evaluates an incoming request and determines if it should be shed.
     * Returns null if allowed, or the 503 response payload if rejected.
     */
    evaluateRequest(request, reply) {
        if (request.method === 'OPTIONS')
            return null;
        if (this.currentState === AdmissionPressureState.HEALTHY)
            return null;
        // Check custom route-level exemption (e.g. registered by health probes)
        const routeConfig = request.routeOptions?.config;
        if (typeof routeConfig?.pressureHandler === 'function') {
            return null;
        }
        const tier = classifyRequestTier(request.url, request.method);
        let shouldShed = false;
        let retryAfter = 10;
        if (!this.config.tieredSheddingEnabled) {
            // Fallback: blunt shedding if tiered shedding is explicitly disabled
            shouldShed = tier !== RequestTier.CRITICAL;
        }
        else {
            switch (this.currentState) {
                case AdmissionPressureState.ELEVATED:
                    // Shed only low-priority sheddable work (telemetry/ingestion)
                    if (tier === RequestTier.SHEDDABLE) {
                        shouldShed = true;
                        retryAfter = 5;
                    }
                    break;
                case AdmissionPressureState.SATURATED:
                    // Shed sheddable and standard work; protect critical auth & billing
                    if (tier === RequestTier.SHEDDABLE || tier === RequestTier.STANDARD) {
                        shouldShed = true;
                        retryAfter = 10;
                    }
                    break;
                case AdmissionPressureState.EMERGENCY:
                    // Shed all except critical health & auth probes to prevent OOM
                    if (tier !== RequestTier.CRITICAL) {
                        shouldShed = true;
                        retryAfter = 15;
                    }
                    break;
                default:
                    shouldShed = false;
            }
        }
        if (!shouldShed) {
            return null;
        }
        // Rate-limited warning log
        const now = Date.now();
        const metrics = this.getMetrics();
        const reason = metrics.smoothedDelayMs > this.config.maxEventLoopDelayMs
            ? 'eventLoopDelay'
            : metrics.utilization > this.config.maxEventLoopUtilization
                ? 'eventLoopUtilization'
                : 'systemSaturation';
        if (now - this.lastLogAt >= this.config.logIntervalMs) {
            this.logger.warn({
                state: this.currentState,
                tier,
                type: reason,
                rawDelayMs: metrics.rawDelayMs,
                smoothedDelayMs: metrics.smoothedDelayMs,
                utilization: metrics.utilization,
                consecutiveBreaches: metrics.consecutiveBreaches,
                heapUsedMB: metrics.heapUsedMB,
                rssMB: metrics.rssMB,
                suppressedSinceLastLog: this.suppressedLogCount,
            }, `Admission control active — shedding ${tier} traffic (${this.currentState})`);
            this.lastLogAt = now;
            this.suppressedLogCount = 0;
        }
        else {
            this.suppressedLogCount += 1;
        }
        reply.header('Retry-After', String(retryAfter)).status(503);
        return {
            error: 'Server busy',
            retryAfter,
            reason,
            tier,
        };
    }
}
//# sourceMappingURL=admission-control.js.map