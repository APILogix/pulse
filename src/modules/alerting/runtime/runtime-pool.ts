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
import promClient from 'prom-client';
import { register } from '../../../config/metrics.js';
import { env } from '../../../config/env.js';

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
export const ALERTING_RUNTIME_REQUIRED_TABLES: readonly string[] = [
  'events_requests',
  'alert_events_v2',
];

/** Tables the alerting CONFIG pool must be able to resolve. */
export const ALERTING_CONFIG_REQUIRED_TABLES: readonly string[] = [
  'alert_rules',
  'alert_rule_conditions',
  'alert_rule_actions',
];

export interface AlertingPoolTarget {
  role: AlertingPoolRole;
  database: string;
  serverVersion: string;
  /** Tables from the required list that resolved successfully. */
  present: string[];
  /** Tables from the required list that did not resolve. */
  missing: string[];
}

export class AlertingRuntimePoolError extends Error {
  constructor(
    readonly role: AlertingPoolRole,
    readonly database: string,
    readonly missing: string[],
  ) {
    super(
      `Alerting ${role} pool is attached to database "${database}" but cannot resolve `
      + `required table(s): ${missing.join(', ')}. `
      + 'This is the ADR-0006 boot assertion: the alerting runtime must see the '
      + 'telemetry and v2 runtime tables, otherwise telemetry-driven alerts silently '
      + 'never fire. Apply the Log DB migrations (npm run db:migrate:logdb) or point '
      + 'the pool at the correct database. Set ALERTING_RUNTIME_POOL_ASSERT=false only '
      + 'for local bootstrap.',
    );
    this.name = 'AlertingRuntimePoolError';
  }
}

const POOL_TARGET_METRIC = 'alerting_runtime_pool_target';

/**
 * Idempotent metric accessor. The guard can run in several processes and is
 * exercised repeatedly by tests, so re-registering would throw.
 */
function poolTargetGauge(): promClient.Gauge<string> {
  const existing = register.getSingleMetric(POOL_TARGET_METRIC);
  if (existing) return existing as promClient.Gauge<string>;
  return new promClient.Gauge({
    name: POOL_TARGET_METRIC,
    help:
      'Which database each alerting pool is attached to. 1 = attached and all required '
      + 'tables resolved, 0 = attached with missing tables (assertion bypassed).',
    labelNames: ['role', 'db'],
    registers: [register],
  });
}

/**
 * Inspect a pool: which database is it on, and can it resolve the tables its role
 * requires? Pure observation — never throws for a missing table.
 */
export async function inspectAlertingPool(
  pool: Pool,
  role: AlertingPoolRole,
): Promise<AlertingPoolTarget> {
  const required = role === 'alerting_runtime'
    ? ALERTING_RUNTIME_REQUIRED_TABLES
    : ALERTING_CONFIG_REQUIRED_TABLES;

  const result = await pool.query<{
    db: string;
    server_version: string;
    resolved: (string | null)[];
  }>(
    `SELECT current_database() AS db,
            current_setting('server_version') AS server_version,
            ARRAY(SELECT to_regclass(t)::text FROM unnest($1::text[]) AS t) AS resolved`,
    [[...required]],
  );

  const row = result.rows[0];
  if (!row) {
    // A single-row query returning nothing means the connection is unusable.
    throw new Error(`Alerting ${role} pool health probe returned no rows`);
  }

  const present: string[] = [];
  const missing: string[] = [];
  required.forEach((table, index) => {
    if (row.resolved[index]) present.push(table);
    else missing.push(table);
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
export async function assertAlertingPool(
  pool: Pool,
  role: AlertingPoolRole,
  logger: Logger,
): Promise<AlertingPoolTarget> {
  const target = await inspectAlertingPool(pool, role);
  const healthy = target.missing.length === 0;

  poolTargetGauge().set({ role, db: target.database }, healthy ? 1 : 0);

  if (healthy) {
    logger.info(
      { role, database: target.database, serverVersion: target.serverVersion },
      'Alerting pool verified',
    );
    return target;
  }

  if (env.ALERTING_RUNTIME_POOL_ASSERT) {
    throw new AlertingRuntimePoolError(role, target.database, target.missing);
  }

  logger.error(
    { role, database: target.database, missing: target.missing },
    'Alerting pool is missing required tables — continuing because '
    + 'ALERTING_RUNTIME_POOL_ASSERT=false. Telemetry-driven alerts may silently not fire.',
  );
  return target;
}
