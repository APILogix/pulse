/**
 * Latency Budgets as Code.
 *
 * Defines explicit SLO thresholds (p95 and p99 budgets in milliseconds)
 * for every registered query type in the system.
 *
 * Validated at startup to guarantee that no query runs without an agreed budget.
 */
import { type DbQueryName } from './query-names.js';
export interface QueryLatencyBudget {
    p95Ms: number;
    p99Ms: number;
    maxAllowedMs?: number;
    description?: string;
}
export declare const DB_QUERY_BUDGETS: Record<DbQueryName, QueryLatencyBudget>;
/**
 * Validates that every registered query has a defined latency budget.
 * In development or testing, throws immediately if a query is missing a budget.
 */
export declare function validateQueryBudgets(): void;
/**
 * Retrieve budget for a query name.
 */
export declare function getQueryBudget(name: DbQueryName | string): QueryLatencyBudget | undefined;
/**
 * Checks if a query execution time breached its p95 budget.
 */
export declare function isBudgetBreached(name: DbQueryName | string, durationMs: number): boolean;
//# sourceMappingURL=perf-budgets.d.ts.map