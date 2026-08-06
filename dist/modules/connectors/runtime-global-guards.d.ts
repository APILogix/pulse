import type { Pool } from 'pg';
export interface GlobalGuardDecision {
    allowed: boolean;
    circuitState: 'closed' | 'open' | 'half_open';
    remainingTokens: number;
    usedFallback: boolean;
}
export interface GlobalGuardConfig {
    limit: number;
    windowSeconds: number;
    failureThreshold: number;
    resetSeconds: number;
}
export declare class ConnectorGlobalGuards {
    private readonly db;
    constructor(db: Pool);
    acquire(connectorId: string, config: GlobalGuardConfig): Promise<GlobalGuardDecision>;
    recordSuccess(connectorId: string): Promise<void>;
    recordFailure(connectorId: string, failureThreshold: number): Promise<void>;
}
//# sourceMappingURL=runtime-global-guards.d.ts.map