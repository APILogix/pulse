/**
 * In-process metrics collector for the Connector Worker system.
 *
 * Exposes runtime counts for observability, avoiding a full Prometheus
 * dependency while providing enough data for /health or /metrics endpoints.
 */
class WorkerMetrics {
    jobsProcessed = 0;
    jobsFailed = 0;
    jobsRetried = 0;
    activeJobs = 0;
    recordJobStarted() {
        this.activeJobs++;
    }
    recordJobCompleted() {
        this.activeJobs = Math.max(0, this.activeJobs - 1);
        this.jobsProcessed++;
    }
    recordJobFailed(retryable) {
        this.activeJobs = Math.max(0, this.activeJobs - 1);
        this.jobsFailed++;
        if (retryable) {
            this.jobsRetried++;
        }
    }
    getSnapshot(circuitStates = {}) {
        return {
            timestamp: new Date().toISOString(),
            counters: {
                jobsProcessed: this.jobsProcessed,
                jobsFailed: this.jobsFailed,
                jobsRetried: this.jobsRetried,
            },
            gauges: {
                activeJobs: this.activeJobs,
            },
            circuitStates,
        };
    }
}
export const workerMetrics = new WorkerMetrics();
//# sourceMappingURL=worker-metrics.js.map