/**
 * Capture EXPLAIN plans for the real TelemetryWriter insert/outbox SQL.
 *
 * The script wraps each writer-emitted mutation in a savepoint, runs
 * EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON), rolls the savepoint back, then lets
 * the original statement execute so writer behavior and RETURNING row counts
 * remain intact. The outer transaction is rolled back unless --commit is set.
 *
 * Phase 2 additions (design §1.1, §Component map):
 *
 *   - `statements` — the nested per-plan JSON flattened by
 *     `scripts/lib/explain-plan-flatten.ts` into one row per captured statement,
 *     exposing WAL records/bytes/FPI, plan node types and the index names **as
 *     they appear in the plan** (Requirement 8.3, and Requirement 4.5, which
 *     needs the index name as EXPLAIN prints it rather than as source reading
 *     infers it).
 *   - `statementTotals` — the same rows grouped by statement digest, giving the
 *     execution count and mean duration Requirement 8.3 asks for when one
 *     statement is captured more than once in a run.
 *   - `assertBenchEnvironment()` is called before the pool is opened, so a run
 *     against a non-allowlisted environment exits non-zero having executed no
 *     `EXPLAIN ANALYZE` and written no rows (Requirement 8.5).
 *   - A statement whose plan cannot be captured here — because `EXPLAIN` failed,
 *     or because the operator declared it obtainable only from production via
 *     `--production-only` — has its plan omitted and records the
 *     Unmeasured_Declaration plus the reason instead (Requirement 8.6). No plan
 *     is ever substituted from a production environment.
 *
 * `plans` keeps its existing shape and its existing meaning of *successfully
 * captured* plans, so `scripts/summarize-ingestion-explain.ts` and
 * `scripts/validate-ingestion-evidence-bundle.ts` keep parsing older and newer
 * bundles identically. Omitted plans surface in `statements` as `unmeasured`
 * rows, which is where the Requirement 17.4 gate reads them.
 */
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { Logger } from 'pino';
import { logDB } from '../src/config/log-database.js';
import { TelemetryWriter, type ScopedEvent } from '../src/modules/ingestion/pipeline/telemetry-writer.js';
import type { SdkEventType } from '../src/modules/ingestion/pipeline/event-normalizer.js';
import {
  assertBenchEnvironment,
  captureProvenance,
  EvidenceError,
  type Provenance,
} from './lib/ingestion-evidence.js';
import {
  matchProductionOnly,
  measuredStatementRow,
  statementDigest,
  statementTotals,
  unmeasuredStatementRow,
  type StatementEvidenceRow,
  type StatementIdentity,
} from './lib/explain-plan-flatten.js';

type ExplainEventType = SdkEventType | 'mixed';

interface ExplainConfig {
  type: ExplainEventType;
  batchSize: number;
  tenants: number;
  analyze: boolean;
  wal: boolean;
  commit: boolean;
  orgId: string;
  projectId: string;
  apiKeyName: string;
  environment: string;
  /** Label or statement substrings whose plan is obtainable only from production (Requirement 8.6). */
  productionOnly: string[];
  outPath: string | null;
}

interface CapturedPlan {
  label: string;
  statement: string;
  valueCount: number;
  plan: unknown;
}

interface ExplainCapture {
  plans: CapturedPlan[];
  statements: StatementEvidenceRow[];
}

const eventTypes = new Set<SdkEventType>([
  'error',
  'message',
  'request',
  'span',
  'trace',
  'metric',
  'log',
  'profile',
  'cron_checkin',
  'replay',
]);
const mixedEventTypes = [...eventTypes];

const noopLogger = {
  child: () => noopLogger,
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  fatal: () => undefined,
} as unknown as Logger;

function parseArgs(): ExplainConfig {
  const args: Record<string, string | boolean> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = process.argv[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }

  const type = String(args.type ?? 'request') as ExplainEventType;
  if (type !== 'mixed' && !eventTypes.has(type)) throw new Error(`Unsupported --type ${type}`);

  return {
    type,
    batchSize: positiveInt(args['batch-size'] ?? args.batchSize, 200),
    tenants: positiveInt(args.tenants ?? args.tenantCount, 1),
    analyze: args.analyze !== false && args.analyze !== 'false' && args['no-analyze'] !== true,
    wal: args.wal !== false && args.wal !== 'false' && args['no-wal'] !== true,
    commit: args.commit === true || args.commit === 'true',
    orgId: String(args.org ?? args.orgId ?? '11111111-1111-4111-8111-111111111111'),
    projectId: String(args.project ?? args.projectId ?? '22222222-2222-4222-8222-222222222222'),
    apiKeyName: String(args.apiKeyName ?? 'explain_ingestion_key'),
    environment: String(args.environment ?? 'benchmark'),
    productionOnly: csvList(args['production-only'] ?? args.productionOnly),
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function csvList(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/** The exact argv of this run, recorded as `Provenance.command` (Requirement 8.4). */
function commandLine(): string {
  return process.argv
    .map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg))
    .join(' ');
}

function eventTypeFor(config: ExplainConfig, index: number): SdkEventType {
  if (config.type !== 'mixed') return config.type;
  return mixedEventTypes[index % mixedEventTypes.length] as SdkEventType;
}

function tenantContext(config: ExplainConfig, index: number): Pick<ExplainConfig, 'orgId' | 'projectId' | 'apiKeyName'> {
  if (config.tenants <= 1) {
    return {
      orgId: config.orgId,
      projectId: config.projectId,
      apiKeyName: config.apiKeyName,
    };
  }

  const tenantNumber = (index % config.tenants) + 1;
  const suffix = String(tenantNumber).padStart(12, '0');
  return {
    orgId: `11111111-1111-4111-8111-${suffix}`,
    projectId: `22222222-2222-4222-8222-${suffix}`,
    apiKeyName: `${config.apiKeyName}_${tenantNumber}`,
  };
}

function buildEvent(type: SdkEventType, index: number, runId: string): Record<string, unknown> {
  const timestamp = Date.now() - index;
  const eventId = `explain-${runId}-${type}-${index}`;
  const traceId = `trace-${runId}-${index}`;
  const spanId = `span-${runId}-${index}`;
  const base = { type, eventId, timestamp, traceId, spanId, service: 'ingestion-explain', release: 'explain' };

  switch (type) {
    case 'error':
      return { ...base, message: `explain error ${index}`, name: 'ExplainError', severity: 'error', stack: [] };
    case 'message':
      return { ...base, message: `explain message ${index}`, severity: 'info' };
    case 'request':
      return { ...base, requestId: `req-${runId}-${index}`, method: 'GET', url: '/explain', route: '/explain', statusCode: 200, latency: 12 };
    case 'span':
      return { ...base, name: 'explain-span', startTime: timestamp, endTime: timestamp + 12, duration: 12 };
    case 'trace':
      return {
        ...base,
        spanCount: 1,
        rootSpan: { id: spanId, name: 'explain-root', startTime: timestamp, endTime: timestamp + 12, duration: 12 },
      };
    case 'metric':
      return { ...base, metricName: 'explain.counter', metricType: 'counter', value: 1 };
    case 'log':
      return { ...base, level: 'info', message: `explain log ${index}` };
    case 'profile':
      return { ...base, profileType: 'cpu', startTime: timestamp, endTime: timestamp + 10, duration: 10, profile: { samples: [] } };
    case 'cron_checkin':
      return { ...base, monitorSlug: 'explain-monitor', status: 'ok', duration: 10, startedAt: timestamp, finishedAt: timestamp + 10 };
    case 'replay':
      return { ...base, sessionId: `session-${runId}`, segmentId: index, events: [] };
  }
}

function scopedBatch(config: ExplainConfig, runId: string): ScopedEvent[] {
  return Array.from({ length: config.batchSize }, (_, index) => {
    const type = eventTypeFor(config, index);
    const tenant = tenantContext(config, index);
    return {
      orgId: tenant.orgId,
      projectId: tenant.projectId,
      orgSlug: 'explain-org',
      projectSlug: 'explain-project',
      apiKeyName: tenant.apiKeyName,
      environment: config.environment,
      event: buildEvent(type, index, runId) as ScopedEvent['event'],
    };
  });
}

function explainSql(config: ExplainConfig, sql: string): string {
  const analyze = config.analyze ? 'ANALYZE, ' : '';
  const wal = config.wal ? 'WAL, ' : '';
  return `EXPLAIN (${analyze}BUFFERS, ${wal}FORMAT JSON) ${sql}`;
}

function shouldExplain(sql: unknown): sql is string {
  if (typeof sql !== 'string') return false;
  const normalized = sql.trim().toLowerCase();
  if (!/^(insert|update|with)\b/.test(normalized)) return false;
  return normalized.includes('events_')
    || normalized.includes('telemetry_outbox')
    || normalized.includes('alert_runtime_idempotency_keys');
}

function statementLabel(sql: string): string {
  const normalized = sql.replace(/\s+/g, ' ').trim();
  const insertTable = normalized.match(/\bINSERT\s+INTO\s+([a-zA-Z0-9_]+)/i)?.[1];
  if (insertTable) return `insert:${insertTable}`;
  const updateTable = normalized.match(/\bUPDATE\s+([a-zA-Z0-9_]+)/i)?.[1];
  if (updateTable) return `update:${updateTable}`;
  if (/\btelemetry_outbox\b/i.test(normalized)) return 'cte:telemetry_outbox';
  return normalized.slice(0, 80);
}

function statementSummary(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

async function captureExplains(
  client: PoolClient,
  config: ExplainConfig,
  capture: ExplainCapture,
  provenance: Provenance,
): Promise<() => void> {
  const originalQuery = client.query.bind(client);
  const callOriginal = originalQuery as unknown as (...args: unknown[]) => Promise<QueryResult>;
  const digestOccurrences = new Map<string, number>();
  let captureIndex = 0;

  (client as unknown as { query: (...args: unknown[]) => Promise<QueryResult> }).query = async (...args: unknown[]): Promise<QueryResult> => {
    const sql = args[0];
    const values = Array.isArray(args[1]) ? args[1] : [];
    if (!shouldExplain(sql)) {
      return callOriginal(...args);
    }

    const label = statementLabel(sql);
    const statement = statementSummary(sql);
    const digest = statementDigest(statement);
    const occurrence = (digestOccurrences.get(digest) ?? 0) + 1;
    digestOccurrences.set(digest, occurrence);
    captureIndex += 1;
    const identity: StatementIdentity = {
      statementKey: `${label}#${captureIndex}`,
      statementDigest: digest,
      captureIndex,
      occurrence,
      label,
      statement,
      valueCount: values.length,
    };

    // Requirement 8.6: a plan declared obtainable only from production is omitted
    // without attempting a capture, and is never substituted from production.
    const productionOnlyPattern = matchProductionOnly(config.productionOnly, label, statement);
    if (productionOnlyPattern !== null) {
      capture.statements.push(unmeasuredStatementRow(
        identity,
        `Plan omitted: the statement matched --production-only=${productionOnlyPattern}, so its plan is `
          + `obtainable only from a production environment. No EXPLAIN was executed against `
          + `${provenance.environment} and no production plan was substituted.`,
        provenance,
      ));
      return callOriginal(...args);
    }

    const savepoint = `ingestion_explain_${captureIndex}`;
    await callOriginal(`SAVEPOINT ${savepoint}`);
    let planData: unknown = null;
    let failure: string | null = null;
    try {
      const explainResult = await callOriginal(explainSql(config, sql), values) as QueryResult<QueryResultRow>;
      planData = explainResult.rows[0]?.['QUERY PLAN'] ?? null;
    } catch (err) {
      // A statement that cannot be explained here degrades to an unmeasured row
      // rather than aborting the run, so one unexplainable statement does not
      // discard the plans already captured for every other statement.
      failure = err instanceof Error ? err.message : String(err);
    } finally {
      await callOriginal(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await callOriginal(`RELEASE SAVEPOINT ${savepoint}`);
    }

    if (planData === null) {
      const cause = failure ?? 'EXPLAIN returned no plan row';
      capture.statements.push(unmeasuredStatementRow(
        identity,
        `Plan omitted: the plan could not be captured in the ${provenance.environment} staging or `
          + `benchmark environment (${cause}). No production plan was substituted.`,
        provenance,
      ));
      return callOriginal(...args);
    }

    capture.plans.push({
      label,
      statement,
      valueCount: values.length,
      plan: planData,
    });
    capture.statements.push(measuredStatementRow(identity, planData, provenance));

    return callOriginal(...args);
  };

  return () => {
    (client as unknown as { query: PoolClient['query'] }).query = originalQuery as PoolClient['query'];
  };
}

async function main(): Promise<void> {
  const config = parseArgs();

  // Requirement 8.5: refuse before the pool is opened, so a non-allowlisted
  // environment sees no EXPLAIN ANALYZE and no writer statement at all.
  const environment = assertBenchEnvironment(config.environment);
  const { provenance } = captureProvenance({
    command: commandLine(),
    environment,
    repetitions: 1,
  });

  const runId = randomUUID().slice(0, 8);
  const writer = new TelemetryWriter(logDB.getPrimaryPool(), noopLogger);
  const capture: ExplainCapture = { plans: [], statements: [] };

  await logDB.connect();
  const client = await logDB.getPrimaryPool().connect();
  const restoreQuery = await captureExplains(client, config, capture, provenance);
  try {
    await client.query('BEGIN');
    const result = await writer.writeBatchDetailedWithOutbox(client, scopedBatch(config, runId));
    await client.query(config.commit ? 'COMMIT' : 'ROLLBACK');

    const output = JSON.stringify({
      runId,
      type: config.type,
      batchSize: config.batchSize,
      tenants: config.tenants,
      analyze: config.analyze,
      wal: config.wal,
      committed: config.commit,
      result,
      plans: capture.plans,
      environment: provenance.environment,
      provenance,
      statements: capture.statements,
      statementTotals: statementTotals(capture.statements),
      unmeasuredStatementCount: capture.statements.filter((row) => row.status === 'unmeasured').length,
    }, null, 2);
    if (config.outPath) {
      await mkdir(dirname(config.outPath), { recursive: true });
      await writeFile(config.outPath, `${output}\n`, 'utf8');
    }
    console.log(output);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    restoreQuery();
    client.release();
    await logDB.close().catch(() => undefined);
  }
}

main().catch((err: unknown) => {
  if (err instanceof EvidenceError) {
    console.error(err.message);
    process.exit(err.exitCode);
  }
  console.error(err);
  process.exit(1);
});
