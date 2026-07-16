/**
 * In-process metrics collector for the Connector Worker system.
 *
 * Exposes runtime counts for observability, avoiding a full Prometheus
 * dependency while providing enough data for /health or /metrics endpoints.
 */

export interface ConnectorMetricsSnapshot {
  timestamp: string;
  counters: {
    jobsProcessed: number;
    jobsFailed: number;
    jobsRetried: number;
  };
  gauges: {
    activeJobs: number;
  };
  circuitStates: Record<string, 'open' | 'closed' | 'half_open'>;
}

class WorkerMetrics {
  private jobsProcessed = 0;
  private jobsFailed = 0;
  private jobsRetried = 0;
  private activeJobs = 0;

  recordJobStarted(): void {
    this.activeJobs++;
  }

  recordJobCompleted(): void {
    this.activeJobs = Math.max(0, this.activeJobs - 1);
    this.jobsProcessed++;
  }

  recordJobFailed(retryable: boolean): void {
    this.activeJobs = Math.max(0, this.activeJobs - 1);
    this.jobsFailed++;
    if (retryable) {
      this.jobsRetried++;
    }
  }

  getSnapshot(circuitStates: Record<string, 'open' | 'closed' | 'half_open'> = {}): ConnectorMetricsSnapshot {
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
