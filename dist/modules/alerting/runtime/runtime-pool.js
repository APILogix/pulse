import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';
import { env } from '../../../config/env.js';
/**
 * Tables the alerting RUNTIME pool must be able to resolve.
 *
 * - `events_requests` proves the pool sees telemetry (audit B1).
 * - `alert_events_v2` proves the Log DB alerting migrations (L1/L3) were applied.
 *
 * Both are checked with `to_regclass`, which resolves through the active
 * search_path exactly the way the repositories' own queries will.
 */
export const ALERTING_RUNTIME_REQUIRED_TABLES = [
    'events_requests',
    'alert_events_v2',
];
/** Tables the alerting CONFIG pool must be able to resolve. */
export const ALERTING_CONFIG_REQUIRED_TABLES = [
    'alert_rules',
    'alert_rule_conditions',
    'alert_rule_actions',
];
export class AlertingRuntimePoolError extends Error {
    role;
    database;
    missing;
    constructor(role, database, missing) {
        super(`Alerting ${role} pool is attached to database "${database}" but cannot resolve `
            + `required table(s): ${missing.join(', ')}. `
            + 'This is the ADR-0006 boot assertion: the alerting runtime must see the '
            + 'telemetry and v2 runtime tables, otherwise telemetry-driven alerts silently '
            + 'never fire. Apply the Log DB migrations (npm run db:migrate:logdb) or point '
            + 'the pool at the correct database. Set ALERTING_RUNTIME_POOL_ASSERT=false only '
            + 'for local bootstrap.');
        this.role = role;
        this.database = database;
        this.missing = missing;
        this.name = 'AlertingRuntimePoolError';
    }
}
const POOL_TARGET_METRIC = 'alerting_runtime_pool_target';
/**
 * Idempotent metric accessor. The guard can run in several processes and is
 * exercised repeatedly by tests, so re-registering would throw.
 */
function poolTargetGauge() {
    const existing = register.getSingleMetric(POOL_TARGET_METRIC);
    if (existing)
        return existing;
    return new promClient.Gauge({
        name: POOL_TARGET_METRIC,
        help: 'Which database each alerting pool is attached to. 1 = attached and all required '
            + 'tables resolved, 0 = attached with missing tables (assertion bypassed).',
        labelNames: ['role', 'db'],
        registers: [register],
    });
}
/**
 * Inspect a pool: which database is it on, and can it resolve the tables its role
 * requires? Pure observation — never throws for a missing table.
 */
export async function inspectAlertingPool(pool, role) {
    const required = role === 'alerting_runtime'
        ? ALERTING_RUNTIME_REQUIRED_TABLES
        : ALERTING_CONFIG_REQUIRED_TABLES;
    const result = await pool.query(`SELECT current_database() AS db,
            current_setting('server_version') AS server_version,
            ARRAY(SELECT to_regclass(t)::text FROM unnest($1::text[]) AS t) AS resolved`, [[...required]]);
    const row = result.rows[0];
    if (!row) {
        // A single-row query returning nothing means the connection is unusable.
        throw new Error(`Alerting ${role} pool health probe returned no rows`);
    }
    const present = [];
    const missing = [];
    required.forEach((table, index) => {
        if (row.resolved[index])
            present.push(table);
        else
            missing.push(table);
    });
    return {
        role,
        database: row.db,
        serverVersion: row.server_version,
        present,
        missing,
    };
}
/**
 * Boot assertion. Verifies the pool can resolve every table its role requires and
 * publishes `alerting_runtime_pool_target`.
 *
 * Throws {@link AlertingRuntimePoolError} when a required table is missing, unless
 * ALERTING_RUNTIME_POOL_ASSERT=false, in which case it logs at error level, records
 * the gauge as 0, and allows boot to continue.
 */
export async function assertAlertingPool(pool, role, logger) {
    const target = await inspectAlertingPool(pool, role);
    const healthy = target.missing.length === 0;
    poolTargetGauge().set({ role, db: target.database }, healthy ? 1 : 0);
    if (healthy) {
        logger.info({ role, database: target.database, serverVersion: target.serverVersion }, 'Alerting pool verified');
        return target;
    }
    if (env.ALERTING_RUNTIME_POOL_ASSERT) {
        throw new AlertingRuntimePoolError(role, target.database, target.missing);
    }
    logger.error({ role, database: target.database, missing: target.missing }, 'Alerting pool is missing required tables — continuing because '
        + 'ALERTING_RUNTIME_POOL_ASSERT=false. Telemetry-driven alerts may silently not fire.');
    return target;
}
//# sourceMappingURL=runtime-pool.js.map