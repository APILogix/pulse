/**
 * Alerting runtime pool guard.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 1)
 *
 * ADR-0006 enforcing rule:
 *   "All telemetry reads use an injected `telemetryPool`. A boot-time assertion
 *    fails fast if the alerting runtime pool cannot see `events_requests` — this
 *    converts audit finding B1 from a silent failure into a startup crash."
 *
 * Audit finding B1: ingestion writes `events_*` through the Log DB pool while the
 * alert evaluator read them through the control-plane pool. That only works when
 * the Log DB falls back to DATABASE_URL. If LOG_DB_PRIMARY is a genuinely separate
 * database, telemetry-driven alerting silently stops firing. This module makes that
 * condition loud: the worker refuses to boot.
 *
 * It also publishes `alerting_runtime_pool_target` so operators can prove which
 * database the alerting runtime is actually attached to (Increment 1 "Ops").
 */
import type { Pool } from 'pg';
import type { Logger } from 'pino';
/** Logical role of a pool handed to the alerting module. */
export type AlertingPoolRole = 'alerting_runtime' | 'alerting_config';
/**
 * Tables the alerting RUNTIME pool must be able to resolve.
 *
 * - `events_requests` proves the pool sees telemetry (audit B1).
 * - `alert_events_v2` proves the Log DB alerting migrations (L1/L3) were applied.
 *
 * Both are checked with `to_regclass`, which resolves through the active
 * search_path exactly the way the repositories' own queries will.
 */
export declare const ALERTING_RUNTIME_REQUIRED_TABLES: readonly string[];
/** Tables the alerting CONFIG pool must be able to resolve. */
export declare const ALERTING_CONFIG_REQUIRED_TABLES: readonly string[];
export interface AlertingPoolTarget {
    role: AlertingPoolRole;
    database: string;
    serverVersion: string;
    /** Tables from the required list that resolved successfully. */
    present: string[];
    /** Tables from the required list that did not resolve. */
    missing: string[];
}
export declare class AlertingRuntimePoolError extends Error {
    readonly role: AlertingPoolRole;
    readonly database: string;
    readonly missing: string[];
    constructor(role: AlertingPoolRole, database: string, missing: string[]);
}
/**
 * Inspect a pool: which database is it on, and can it resolve the tables its role
 * requires? Pure observation — never throws for a missing table.
 */
export declare function inspectAlertingPool(pool: Pool, role: AlertingPoolRole): Promise<AlertingPoolTarget>;
/**
 * Boot assertion. Verifies the pool can resolve every table its role requires and
 * publishes `alerting_runtime_pool_target`.
 *
 * Throws {@link AlertingRuntimePoolError} when a required table is missing, unless
 * ALERTING_RUNTIME_POOL_ASSERT=false, in which case it logs at error level, records
 * the gauge as 0, and allows boot to continue.
 */
export declare function assertAlertingPool(pool: Pool, role: AlertingPoolRole, logger: Logger): Promise<AlertingPoolTarget>;
//# sourceMappingURL=runtime-pool.d.ts.map