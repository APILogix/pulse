import { type HealthCheckRow, type HealthState } from '../types.js';
export declare class ConnectorMetricsRepository {
    private readonly db;
    recordSuccess(connectorId: string): Promise<void>;
    /** Increment failures; flip to 'error' once the threshold is crossed. */
    recordFailure(connectorId: string): Promise<{
        consecutiveFailures: number;
        tripped: boolean;
    }>;
    insertHealthCheck(connectorId: string, state: HealthState, responseTimeMs: number | null, errorMessage: string | null, details: Record<string, unknown>): Promise<HealthCheckRow>;
}
//# sourceMappingURL=metrics.repository.d.ts.map