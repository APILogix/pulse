/**
 * Capture EXPLAIN plans for the real TelemetryWriter insert/outbox SQL.
 *
 * The script wraps each writer-emitted mutation in a savepoint, runs
 * EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON), rolls the savepoint back, then lets
 * the original statement execute so writer behavior and RETURNING row counts
 * remain intact. The outer transaction is rolled back unless --commit is set.
 */
import { randomUUID } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { dirname } from 'path';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import type { Logger } from 'pino';
import { logDB } from '../src/config/log-database.js';
import { TelemetryWriter, type ScopedEvent } from '../src/modules/ingestion/pipeline/telemetry-writer.js';
import type { SdkEventType } from '../src/modules/ingestion/pipeline/event-normalizer.js';

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
  outPath: string | null;
}

interface CapturedPlan {
  label: string;
  statement: string;
  valueCount: number;
  plan: unknown;
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
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
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

async function captureExplains(client: PoolClient, config: ExplainConfig, plans: CapturedPlan[]): Promise<() => void> {
  const originalQuery = client.query.bind(client);
  const callOriginal = originalQuery as unknown as (...args: unknown[]) => Promise<QueryResult>;
  let explainIndex = 0;

  (client as unknown as { query: (...args: unknown[]) => Promise<QueryResult> }).query = async (...args: unknown[]): Promise<QueryResult> => {
    const sql = args[0];
    const values = Array.isArray(args[1]) ? args[1] : [];
    if (!shouldExplain(sql)) {
      return callOriginal(...args);
    }

    explainIndex += 1;
    const savepoint = `ingestion_explain_${explainIndex}`;
    await callOriginal(`SAVEPOINT ${savepoint}`);
    try {
      const explainResult = await callOriginal(explainSql(config, sql), values) as QueryResult<QueryResultRow>;
      plans.push({
        label: statementLabel(sql),
        statement: statementSummary(sql),
        valueCount: values.length,
        plan: explainResult.rows[0]?.['QUERY PLAN'] ?? null,
      });
    } finally {
      await callOriginal(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      await callOriginal(`RELEASE SAVEPOINT ${savepoint}`);
    }

    return callOriginal(...args);
  };

  return () => {
    (client as unknown as { query: PoolClient['query'] }).query = originalQuery as PoolClient['query'];
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  const runId = randomUUID().slice(0, 8);
  const writer = new TelemetryWriter(logDB.getPrimaryPool(), noopLogger);
  const plans: CapturedPlan[] = [];

  await logDB.connect();
  const client = await logDB.getPrimaryPool().connect();
  const restoreQuery = await captureExplains(client, config, plans);
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
      plans,
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
