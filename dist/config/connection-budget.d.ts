/**
 * Connection Budget Registry.
 *
 * This is an observability model of the pools each process actually constructs.
 * It does not enforce a provider limit; deployment capacity must multiply these
 * per-process values by the configured process counts.
 */
import type { Logger } from 'pino';
export type ProcessRole = 'api' | 'ingestion' | 'worker' | 'alert-worker' | 'analytics' | 'cron' | 'migration';
export type PoolingMode = 'transaction' | 'session' | 'direct';
export interface PoolBudgetItem {
    name: string;
    max: number;
    min: number;
    idleTimeoutMs: number;
    acquireTimeoutMs: number;
    purpose: string;
    poolingMode: PoolingMode;
    targetEnvVar: string;
}
export interface ProcessBudget {
    role: ProcessRole;
    description: string;
    pools: PoolBudgetItem[];
    totalMaxConnections: number;
}
export declare function sanitizeDatabaseTarget(connectionString?: string): string;
export declare function getProcessBudget(role: ProcessRole): ProcessBudget;
export declare function logProcessConnectionBudget(role: ProcessRole, log: Logger): void;
//# sourceMappingURL=connection-budget.d.ts.map