/**
 * Latency Budgets as Code.
 *
 * Defines explicit SLO thresholds (p95 and p99 budgets in milliseconds)
 * for every registered query type in the system.
 *
 * Validated at startup to guarantee that no query runs without an agreed budget.
 */

import { DB_QUERY_NAMES, type DbQueryName } from './query-names.js';
import { logger } from '../logger.js';

const perfLogger = logger.child({ component: 'perf-budgets' });

export interface QueryLatencyBudget {
  p95Ms: number;
  p99Ms: number;
  maxAllowedMs?: number;
  description?: string;
}

export const DB_QUERY_BUDGETS: Record<DbQueryName, QueryLatencyBudget> = {
  // ── Control-Plane Queries (PrimaryDB) ──────────────────────────────────
  [DB_QUERY_NAMES.AUTH_API_KEY_LOOKUP]: {
    p95Ms: 5,
    p99Ms: 15,
    maxAllowedMs: 50,
    description: 'Ultra fast index lookup for API key validation on incoming requests',
  },
  [DB_QUERY_NAMES.AUTH_USER_LOOKUP_BY_EMAIL]: {
    p95Ms: 10,
    p99Ms: 25,
    maxAllowedMs: 100,
    description: 'Indexed email lookup during login flow',
  },
  [DB_QUERY_NAMES.AUTH_USER_LOOKUP_BY_ID]: {
    p95Ms: 8,
    p99Ms: 20,
    maxAllowedMs: 50,
    description: 'Primary key user record fetch',
  },
  [DB_QUERY_NAMES.AUTH_CREATE_SESSION]: {
    p95Ms: 15,
    p99Ms: 40,
    maxAllowedMs: 150,
    description: 'Insert session row and security event',
  },
  [DB_QUERY_NAMES.AUTH_VALIDATE_SESSION]: {
    p95Ms: 10,
    p99Ms: 25,
    maxAllowedMs: 60,
    description: 'Session validation token query',
  },
  [DB_QUERY_NAMES.AUTH_REFRESH_TOKEN]: {
    p95Ms: 15,
    p99Ms: 35,
    maxAllowedMs: 100,
    description: 'Session refresh token update',
  },
  [DB_QUERY_NAMES.ORG_GET_BY_ID]: {
    p95Ms: 10,
    p99Ms: 25,
    maxAllowedMs: 80,
    description: 'Primary key lookup of organization details',
  },
  [DB_QUERY_NAMES.ORG_GET_BY_SLUG]: {
    p95Ms: 12,
    p99Ms: 30,
    maxAllowedMs: 100,
    description: 'Unique index lookup of organization by slug',
  },
  [DB_QUERY_NAMES.ORG_CREATE]: {
    p95Ms: 25,
    p99Ms: 60,
    maxAllowedMs: 200,
    description: 'Create organization and initial membership transaction',
  },
  [DB_QUERY_NAMES.ORG_LIST_MEMBERS]: {
    p95Ms: 20,
    p99Ms: 50,
    maxAllowedMs: 150,
    description: 'List members and roles of an organization',
  },
  [DB_QUERY_NAMES.ORG_UPDATE_SETTINGS]: {
    p95Ms: 20,
    p99Ms: 50,
    maxAllowedMs: 150,
    description: 'Update organization settings and audit log entry',
  },
  [DB_QUERY_NAMES.PROJECT_GET_BY_ID]: {
    p95Ms: 10,
    p99Ms: 25,
    maxAllowedMs: 80,
    description: 'Fetch project details by ID',
  },
  [DB_QUERY_NAMES.PROJECT_LIST_BY_ORG]: {
    p95Ms: 15,
    p99Ms: 35,
    maxAllowedMs: 120,
    description: 'List projects belonging to an organization',
  },
  [DB_QUERY_NAMES.PROJECT_SDK_CONFIG_LOOKUP]: {
    p95Ms: 12,
    p99Ms: 30,
    maxAllowedMs: 100,
    description: 'Project SDK configuration schema fetch',
  },
  [DB_QUERY_NAMES.BILLING_GET_SUBSCRIPTION]: {
    p95Ms: 15,
    p99Ms: 40,
    maxAllowedMs: 120,
    description: 'Get active subscription and entitlement records',
  },
  [DB_QUERY_NAMES.BILLING_UPDATE_USAGE]: {
    p95Ms: 20,
    p99Ms: 50,
    maxAllowedMs: 150,
    description: 'Increment usage counter record for billing',
  },
  [DB_QUERY_NAMES.BILLING_RECORD_INVOICE]: {
    p95Ms: 25,
    p99Ms: 60,
    maxAllowedMs: 200,
    description: 'Persist invoice and payment state',
  },
  [DB_QUERY_NAMES.ALERTS_LIST_RULES]: {
    p95Ms: 20,
    p99Ms: 50,
    maxAllowedMs: 150,
    description: 'List active alert rules for project/org',
  },
  [DB_QUERY_NAMES.ALERTS_EVALUATE_RULE]: {
    p95Ms: 30,
    p99Ms: 80,
    maxAllowedMs: 250,
    description: 'Fetch rule criteria and state for evaluation',
  },
  [DB_QUERY_NAMES.ALERTS_CREATE_INCIDENT]: {
    p95Ms: 25,
    p99Ms: 60,
    maxAllowedMs: 200,
    description: 'Insert new alert incident record',
  },
  [DB_QUERY_NAMES.CONNECTORS_GET_BY_ID]: {
    p95Ms: 12,
    p99Ms: 30,
    maxAllowedMs: 100,
    description: 'Connector configuration lookup',
  },
  [DB_QUERY_NAMES.CONNECTORS_LIST]: {
    p95Ms: 18,
    p99Ms: 45,
    maxAllowedMs: 150,
    description: 'List connectors for an organization',
  },
  [DB_QUERY_NAMES.PGMQ_ENQUEUE]: {
    p95Ms: 10,
    p99Ms: 25,
    maxAllowedMs: 80,
    description: 'Send message into PGMQ queue',
  },
  [DB_QUERY_NAMES.PGMQ_DEQUEUE]: {
    p95Ms: 15,
    p99Ms: 40,
    maxAllowedMs: 100,
    description: 'Poll/read messages from PGMQ queue',
  },
  [DB_QUERY_NAMES.CONTROL_HEALTH_CHECK]: {
    p95Ms: 5,
    p99Ms: 15,
    maxAllowedMs: 50,
    description: 'Primary database ping/readiness check',
  },

  // ── Telemetry Queries (LogDB / TimescaleDB) ───────────────────────────
  [DB_QUERY_NAMES.INGEST_BATCH_INSERT_EVENTS]: {
    p95Ms: 100,
    p99Ms: 300,
    maxAllowedMs: 1000,
    description: 'Batch insert telemetry events (UNNEST array)',
  },
  [DB_QUERY_NAMES.INGEST_BATCH_INSERT_SPANS]: {
    p95Ms: 120,
    p99Ms: 350,
    maxAllowedMs: 1200,
    description: 'Batch insert distributed tracing spans',
  },
  [DB_QUERY_NAMES.INGEST_BATCH_INSERT_LOGS]: {
    p95Ms: 100,
    p99Ms: 300,
    maxAllowedMs: 1000,
    description: 'Batch insert structured application logs',
  },
  [DB_QUERY_NAMES.INGEST_BATCH_INSERT_ERRORS]: {
    p95Ms: 80,
    p99Ms: 250,
    maxAllowedMs: 800,
    description: 'Batch insert error occurrences',
  },
  [DB_QUERY_NAMES.INGEST_FLUSH_USAGE]: {
    p95Ms: 50,
    p99Ms: 150,
    maxAllowedMs: 500,
    description: 'Flush ingestion usage aggregates',
  },
  [DB_QUERY_NAMES.DASHBOARD_WIDGET_ROLLUP]: {
    p95Ms: 200,
    p99Ms: 500,
    maxAllowedMs: 2000,
    description: 'Continuous aggregate rollup query for dashboard widgets',
  },
  [DB_QUERY_NAMES.DASHBOARD_RAW_METRICS]: {
    p95Ms: 300,
    p99Ms: 800,
    maxAllowedMs: 3000,
    description: 'Raw metrics time-bucket query with project filter',
  },
  [DB_QUERY_NAMES.TRACES_GET_BY_ID]: {
    p95Ms: 20,
    p99Ms: 50,
    maxAllowedMs: 200,
    description: 'Fetch trace by trace_id and tenant project scope',
  },
  [DB_QUERY_NAMES.TRACES_SEARCH_SPANS]: {
    p95Ms: 150,
    p99Ms: 400,
    maxAllowedMs: 1500,
    description: 'Filtered span search with time-window bounding',
  },
  [DB_QUERY_NAMES.LOGS_SEARCH_BOUNDED]: {
    p95Ms: 150,
    p99Ms: 450,
    maxAllowedMs: 2000,
    description: 'Time-window and text filtered log query',
  },
  [DB_QUERY_NAMES.ERRORS_GET_GROUP]: {
    p95Ms: 30,
    p99Ms: 80,
    maxAllowedMs: 300,
    description: 'Get error group details and statistics',
  },
  [DB_QUERY_NAMES.ERRORS_LIST_RECENT]: {
    p95Ms: 50,
    p99Ms: 120,
    maxAllowedMs: 500,
    description: 'List recent unique error groups for project',
  },
  [DB_QUERY_NAMES.ANALYTICS_WATERMARK_CHECK]: {
    p95Ms: 25,
    p99Ms: 70,
    maxAllowedMs: 250,
    description: 'Check last processed telemetry watermark',
  },
  [DB_QUERY_NAMES.ANALYTICS_ROLLUP_EXECUTION]: {
    p95Ms: 500,
    p99Ms: 1500,
    maxAllowedMs: 5000,
    description: 'Execute hourly/daily continuous rollup aggregate calculation',
  },
  [DB_QUERY_NAMES.ANALYTICS_MAINTENANCE_PARTITIONS]: {
    p95Ms: 1000,
    p99Ms: 3000,
    maxAllowedMs: 10000,
    description: 'Partition maintenance, compression, and retention check',
  },
  [DB_QUERY_NAMES.TELEMETRY_HEALTH_CHECK]: {
    p95Ms: 8,
    p99Ms: 20,
    maxAllowedMs: 60,
    description: 'TimescaleDB / LogDB ping and replica health check',
  },
};

/**
 * Validates that every registered query has a defined latency budget.
 * In development or testing, throws immediately if a query is missing a budget.
 */
export function validateQueryBudgets(): void {
  const missingBudgets: string[] = [];
  const registeredNames = Object.values(DB_QUERY_NAMES);

  for (const name of registeredNames) {
    if (!DB_QUERY_BUDGETS[name]) {
      missingBudgets.push(name);
    }
  }

  if (missingBudgets.length > 0) {
    const errorMsg = `Performance Budget Validation Failed: Missing latency budgets for registered queries: ${missingBudgets.join(', ')}`;
    perfLogger.error({ missingBudgets }, errorMsg);

    const isStrict = process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development';
    if (isStrict) {
      throw new Error(errorMsg);
    }
  } else {
    perfLogger.info(
      { totalBudgets: Object.keys(DB_QUERY_BUDGETS).length },
      'All database query latency budgets successfully validated',
    );
  }
}

/**
 * Retrieve budget for a query name.
 */
export function getQueryBudget(name: DbQueryName | string): QueryLatencyBudget | undefined {
  return DB_QUERY_BUDGETS[name as DbQueryName];
}

/**
 * Checks if a query execution time breached its p95 budget.
 */
export function isBudgetBreached(name: DbQueryName | string, durationMs: number): boolean {
  const budget = getQueryBudget(name);
  if (!budget) return false;
  return durationMs > budget.p95Ms;
}
