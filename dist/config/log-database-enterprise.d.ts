/**
 * Enterprise-Grade TimescaleDB Log Database Manager
 *
 * Enhancements over original log-database.ts:
 * 1. TimescaleDB hypertable auto-creation with compression
 * 2. Continuous aggregates for performance
 * 3. Automated retention policies
 * 4. Connection pooling with circuit breaker
 * 5. Query performance monitoring
 * 6. Automatic failover to replica
 * 7. Statement timeout management (never timeout ingestion)
 * 8. Distributed tracing integration
 * 9. Metrics collection
 * 10. Health check with degraded state
 */
export type DbOperation = 'read' | 'write';
export interface QueryOptions {
    maxRetries?: number;
    operation?: DbOperation;
    projectId?: string | undefined;
    timeout?: number;
    traceId?: string;
    spanId?: string;
}
export interface PoolStats {
    total: number;
    idle: number;
    waiting: number;
}
export interface LogEvent {
    project_id: string;
    type: string;
    timestamp: Date;
    payload: Record<string, unknown>;
}
export interface HealthStatus {
    healthy: boolean;
    degraded: boolean;
    primary?: Date;
    replica?: Date;
    timescaleVersion?: string;
    extensions?: string[];
    errors?: string[];
}
//# sourceMappingURL=log-database-enterprise.d.ts.map