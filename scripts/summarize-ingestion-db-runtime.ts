/**
 * Summarize ingestion:db:runtime JSON into Database/Bottleneck Report evidence.
 */
import { readFile, writeFile } from 'fs/promises';

type OutputFormat = 'markdown' | 'json';

interface SummaryConfig {
  runtimePath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface RuntimeSnapshot {
  sampledAt?: string;
  logDb?: {
    waitingActivity?: unknown[];
    locks?: unknown[];
    relationStats?: Record<string, unknown>[];
    relationSizes?: Record<string, unknown>[];
    optionalStatsUnavailable?: string[];
  };
  primaryDb?: {
    pgbossQueues?: Record<string, unknown>[];
    waitingActivity?: unknown[];
    locks?: unknown[];
    pgbossRelationSizes?: Record<string, unknown>[];
    optionalStatsUnavailable?: string[];
  };
}

interface RuntimeReport {
  generatedAt?: string;
  intervalMs?: number;
  tables?: string[];
  snapshots?: RuntimeSnapshot[];
  deltas?: Record<string, unknown>[];
}

interface RuntimeSummary {
  generatedAt: string | null;
  samples: number;
  intervalMs: number | null;
  totalInsertedDelta: number;
  requestInsertedDelta: number;
  totalDeadTupleDelta: number;
  requestHeapBytesDelta: number | null;
  requestIndexBytesDelta: number | null;
  requestIndexBytesPerInsertedRow: number | null;
  walBytesDelta: number | null;
  walSyncTimeMsDelta: number | null;
  walSyncTimeMsPerCommit: number | null;
  logDbXactCommitDelta: number | null;
  logDbXactRollbackDelta: number | null;
  logDbBlocksReadDelta: number | null;
  logDbBlocksHitDelta: number | null;
  logDbCacheHitPct: number | null;
  logDbTempBytesDelta: number | null;
  primaryWalBytesDelta: number | null;
  primaryWalSyncTimeMsDelta: number | null;
  primaryWalSyncTimeMsPerCommit: number | null;
  primaryXactCommitDelta: number | null;
  primaryXactRollbackDelta: number | null;
  primaryBlocksReadDelta: number | null;
  primaryBlocksHitDelta: number | null;
  primaryCacheHitPct: number | null;
  primaryTempBytesDelta: number | null;
  waitingActivityCount: number;
  lockWaitCount: number;
  primaryWaitingActivityCount: number;
  primaryLockWaitCount: number;
  pgbossPendingJobs: number;
  pgbossActiveJobs: number;
  pgbossInsertedDelta: number;
  pgbossUpdatedDelta: number;
  pgbossIndexBytesDelta: number | null;
  largestRelations: Array<{ relation: string; totalMb: number; indexMb: number }>;
  largestPgbossRelations: Array<{ relation: string; totalMb: number; indexMb: number }>;
  topRelationGrowth: Array<{ relation: string; totalKb: number; heapKb: number; indexKb: number }>;
  topPgbossRelationGrowth: Array<{ relation: string; totalKb: number; heapKb: number; indexKb: number }>;
  topInsertTables: Array<{ relation: string; inserted: number }>;
  topPgbossWriteTables: Array<{ relation: string; inserted: number; updated: number }>;
  findings: string[];
  optionalStatsUnavailable: string[];
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:db:runtime:summary -- --runtime artifacts/ingestion-db-runtime.json [--format markdown|json] [--out artifacts/ingestion-db-runtime-summary.md]
`);
  process.exit(2);
}

function parseArgs(): SummaryConfig {
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

  const runtimePath = args.runtime;
  if (typeof runtimePath !== 'string') usage();
  if (typeof runtimePath !== 'string') process.exit(2);
  return {
    runtimePath,
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function deltaValue(deltas: Record<string, unknown>[], scope: string, metric: string, relation?: string): number | null {
  const matching = deltas
    .filter((row) => row.scope === scope && row.metric === metric && (relation === undefined || row.relation === relation))
    .map((row) => finite(row.delta))
    .filter((value): value is number => value !== null);
  if (matching.length === 0) return null;
  return matching.reduce((sum, value) => sum + value, 0);
}

function relationName(row: Record<string, unknown>): string {
  const schema = typeof row.schema_name === 'string'
    ? row.schema_name
    : typeof row.schemaname === 'string'
      ? row.schemaname
      : 'public';
  const relation = typeof row.relation_name === 'string'
    ? row.relation_name
    : typeof row.relname === 'string'
      ? row.relname
      : 'unknown';
  return `${schema}.${relation}`;
}

function mb(value: unknown): number {
  const bytes = finite(value) ?? 0;
  return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

function kb(value: number | null): number {
  return Math.round(((value ?? 0) / 1024) * 100) / 100;
}

function summarize(report: RuntimeReport): RuntimeSummary {
  const snapshots = Array.isArray(report.snapshots) ? report.snapshots : [];
  const last = snapshots[snapshots.length - 1] ?? {};
  const deltas = Array.isArray(report.deltas)
    ? report.deltas.map(object).filter((row): row is Record<string, unknown> => row !== null)
    : [];
  const relationSizes = Array.isArray(last.logDb?.relationSizes) ? last.logDb.relationSizes : [];
  const queues = Array.isArray(last.primaryDb?.pgbossQueues) ? last.primaryDb.pgbossQueues : [];
  const pgbossRelationSizes = Array.isArray(last.primaryDb?.pgbossRelationSizes) ? last.primaryDb.pgbossRelationSizes : [];

  const tableInsertDeltas = deltas
    .filter((row) => row.scope === 'log_db_table' && row.metric === 'n_tup_ins')
    .map((row) => ({ relation: String(row.relation ?? 'unknown'), inserted: finite(row.delta) ?? 0 }))
    .filter((row) => row.inserted > 0)
    .sort((a, b) => b.inserted - a.inserted);

  const totalInsertedDelta = tableInsertDeltas.reduce((sum, row) => sum + row.inserted, 0);
  const requestInsertedDelta = deltaValue(deltas, 'log_db_table', 'n_tup_ins', 'public.events_requests')
    ?? deltaValue(deltas, 'log_db_table', 'n_tup_ins', 'events_requests')
    ?? 0;
  const totalDeadTupleDelta = deltas
    .filter((row) => row.scope === 'log_db_table' && row.metric === 'n_dead_tup')
    .reduce((sum, row) => sum + (finite(row.delta) ?? 0), 0);
  const requestHeapBytesDelta = deltaValue(deltas, 'log_db_relation_size', 'heap_bytes', 'public.events_requests')
    ?? deltaValue(deltas, 'log_db_relation_size', 'heap_bytes', 'events_requests');
  const requestIndexBytesDelta = deltaValue(deltas, 'log_db_relation_size', 'indexes_bytes', 'public.events_requests')
    ?? deltaValue(deltas, 'log_db_relation_size', 'indexes_bytes', 'events_requests');
  const requestIndexBytesPerInsertedRow = requestInsertedDelta > 0 && requestIndexBytesDelta !== null
    ? requestIndexBytesDelta / requestInsertedDelta
    : null;
  const walBytesDelta = deltaValue(deltas, 'log_db_wal', 'wal_bytes');
  const walSyncTimeMsDelta = deltaValue(deltas, 'log_db_wal', 'wal_sync_time');
  const logDbXactCommitDelta = deltaValue(deltas, 'log_db_database', 'xact_commit');
  const logDbXactRollbackDelta = deltaValue(deltas, 'log_db_database', 'xact_rollback');
  const logDbBlocksReadDelta = deltaValue(deltas, 'log_db_database', 'blks_read');
  const logDbBlocksHitDelta = deltaValue(deltas, 'log_db_database', 'blks_hit');
  const logDbTempBytesDelta = deltaValue(deltas, 'log_db_database', 'temp_bytes');
  const walSyncTimeMsPerCommit = walSyncTimeMsDelta !== null && (logDbXactCommitDelta ?? 0) > 0
    ? walSyncTimeMsDelta / logDbXactCommitDelta!
    : null;
  const logDbCacheHitPct = (logDbBlocksReadDelta ?? 0) + (logDbBlocksHitDelta ?? 0) > 0
    ? ((logDbBlocksHitDelta ?? 0) / ((logDbBlocksReadDelta ?? 0) + (logDbBlocksHitDelta ?? 0))) * 100
    : null;
  const primaryWalBytesDelta = deltaValue(deltas, 'primary_db_wal', 'wal_bytes');
  const primaryWalSyncTimeMsDelta = deltaValue(deltas, 'primary_db_wal', 'wal_sync_time');
  const primaryXactCommitDelta = deltaValue(deltas, 'primary_db_database', 'xact_commit');
  const primaryXactRollbackDelta = deltaValue(deltas, 'primary_db_database', 'xact_rollback');
  const primaryBlocksReadDelta = deltaValue(deltas, 'primary_db_database', 'blks_read');
  const primaryBlocksHitDelta = deltaValue(deltas, 'primary_db_database', 'blks_hit');
  const primaryTempBytesDelta = deltaValue(deltas, 'primary_db_database', 'temp_bytes');
  const primaryWalSyncTimeMsPerCommit = primaryWalSyncTimeMsDelta !== null && (primaryXactCommitDelta ?? 0) > 0
    ? primaryWalSyncTimeMsDelta / primaryXactCommitDelta!
    : null;
  const primaryCacheHitPct = (primaryBlocksReadDelta ?? 0) + (primaryBlocksHitDelta ?? 0) > 0
    ? ((primaryBlocksHitDelta ?? 0) / ((primaryBlocksReadDelta ?? 0) + (primaryBlocksHitDelta ?? 0))) * 100
    : null;
  const waitingActivityCount = Array.isArray(last.logDb?.waitingActivity) ? last.logDb.waitingActivity.length : 0;
  const lockWaitCount = Array.isArray(last.logDb?.locks) ? last.logDb.locks.length : 0;
  const primaryWaitingActivityCount = Array.isArray(last.primaryDb?.waitingActivity) ? last.primaryDb.waitingActivity.length : 0;
  const primaryLockWaitCount = Array.isArray(last.primaryDb?.locks) ? last.primaryDb.locks.length : 0;
  const pgbossPendingJobs = queues.reduce((sum, row) => sum + (finite(row.queued_count) ?? 0) + (finite(row.retry_count) ?? 0), 0);
  const pgbossActiveJobs = queues.reduce((sum, row) => sum + (finite(row.active_count) ?? 0), 0);
  const pgbossInsertedDelta = deltas
    .filter((row) => row.scope === 'primary_pgboss_table' && row.metric === 'n_tup_ins')
    .reduce((sum, row) => sum + (finite(row.delta) ?? 0), 0);
  const pgbossUpdatedDelta = deltas
    .filter((row) => row.scope === 'primary_pgboss_table' && row.metric === 'n_tup_upd')
    .reduce((sum, row) => sum + (finite(row.delta) ?? 0), 0);
  const pgbossIndexBytesDelta = deltaValue(deltas, 'primary_pgboss_relation_size', 'indexes_bytes', 'pgboss.job')
    ?? deltaValue(deltas, 'primary_pgboss_relation_size', 'indexes_bytes', 'pgboss.job_common');
  const largestRelations = relationSizes
    .map((row) => ({
      relation: relationName(row),
      totalMb: mb(row.total_bytes),
      indexMb: mb(row.indexes_bytes),
    }))
    .sort((a, b) => b.totalMb - a.totalMb)
    .slice(0, 8);
  const largestPgbossRelations = pgbossRelationSizes
    .map((row) => ({
      relation: relationName(row),
      totalMb: mb(row.total_bytes),
      indexMb: mb(row.indexes_bytes),
    }))
    .sort((a, b) => b.totalMb - a.totalMb)
    .slice(0, 8);
  const relationGrowthByName = new Map<string, { relation: string; total: number | null; heap: number | null; index: number | null }>();
  for (const row of deltas.filter((delta) => delta.scope === 'log_db_relation_size')) {
    const relation = String(row.relation ?? 'unknown');
    const current = relationGrowthByName.get(relation) ?? { relation, total: null, heap: null, index: null };
    if (row.metric === 'total_bytes') current.total = finite(row.delta);
    if (row.metric === 'heap_bytes') current.heap = finite(row.delta);
    if (row.metric === 'indexes_bytes') current.index = finite(row.delta);
    relationGrowthByName.set(relation, current);
  }
  const topRelationGrowth = [...relationGrowthByName.values()]
    .map((row) => ({
      relation: row.relation,
      totalKb: kb(row.total),
      heapKb: kb(row.heap),
      indexKb: kb(row.index),
    }))
    .filter((row) => row.totalKb !== 0 || row.heapKb !== 0 || row.indexKb !== 0)
    .sort((a, b) => b.totalKb - a.totalKb)
    .slice(0, 8);
  const pgbossRelationGrowthByName = new Map<string, { relation: string; total: number | null; heap: number | null; index: number | null }>();
  for (const row of deltas.filter((delta) => delta.scope === 'primary_pgboss_relation_size')) {
    const relation = String(row.relation ?? 'unknown');
    const current = pgbossRelationGrowthByName.get(relation) ?? { relation, total: null, heap: null, index: null };
    if (row.metric === 'total_bytes') current.total = finite(row.delta);
    if (row.metric === 'heap_bytes') current.heap = finite(row.delta);
    if (row.metric === 'indexes_bytes') current.index = finite(row.delta);
    pgbossRelationGrowthByName.set(relation, current);
  }
  const topPgbossRelationGrowth = [...pgbossRelationGrowthByName.values()]
    .map((row) => ({
      relation: row.relation,
      totalKb: kb(row.total),
      heapKb: kb(row.heap),
      indexKb: kb(row.index),
    }))
    .filter((row) => row.totalKb !== 0 || row.heapKb !== 0 || row.indexKb !== 0)
    .sort((a, b) => b.totalKb - a.totalKb)
    .slice(0, 8);
  const pgbossWritesByRelation = new Map<string, { relation: string; inserted: number; updated: number }>();
  for (const row of deltas.filter((delta) => delta.scope === 'primary_pgboss_table')) {
    const relation = String(row.relation ?? 'unknown');
    const current = pgbossWritesByRelation.get(relation) ?? { relation, inserted: 0, updated: 0 };
    if (row.metric === 'n_tup_ins') current.inserted += finite(row.delta) ?? 0;
    if (row.metric === 'n_tup_upd') current.updated += finite(row.delta) ?? 0;
    pgbossWritesByRelation.set(relation, current);
  }
  const topPgbossWriteTables = [...pgbossWritesByRelation.values()]
    .filter((row) => row.inserted > 0 || row.updated > 0)
    .sort((a, b) => (b.inserted + b.updated) - (a.inserted + a.updated))
    .slice(0, 8);

  const findings: string[] = [];
  if (totalInsertedDelta <= 0) {
    findings.push('No positive Log DB insert delta was captured; rerun during a committed ingestion benchmark.');
  }
  if (requestInsertedDelta <= 0) {
    findings.push('No positive events_requests insert delta was captured; rerun during a committed request or mixed ingestion benchmark before judging request insert latency.');
  }
  if (lockWaitCount > 0 || waitingActivityCount > 0) {
    findings.push(`Runtime snapshot captured ${waitingActivityCount} waiting session(s) and ${lockWaitCount} lock waiter row(s); inspect query samples before changing indexes or concurrency.`);
  }
  if ((walSyncTimeMsDelta ?? 0) > 0) {
    findings.push(`WAL sync time increased by ${Math.round((walSyncTimeMsDelta ?? 0) * 100) / 100}ms during the capture; commit latency may be storage/fsync related.`);
  }
  if ((walSyncTimeMsPerCommit ?? 0) > 10) {
    findings.push(`Log DB WAL sync averaged ${Math.round((walSyncTimeMsPerCommit ?? 0) * 100) / 100}ms per committed transaction; high worker commitMs is likely fsync/storage/checkpoint sensitive.`);
  }
  if ((logDbTempBytesDelta ?? 0) > 0) {
    findings.push(`Log DB temp bytes increased by ${logDbTempBytesDelta}; inspect query plans for sorts/hash spills during ingestion.`);
  }
  if (logDbCacheHitPct !== null && logDbCacheHitPct < 99) {
    findings.push(`Log DB cache hit rate during capture was ${Math.round(logDbCacheHitPct * 100) / 100}%; buffer reads may be contributing to insert latency.`);
  }
  if ((walBytesDelta ?? 0) > 0 && totalInsertedDelta > 0) {
    findings.push(`WAL generated per inserted row was approximately ${Math.round((walBytesDelta! / totalInsertedDelta) * 100) / 100} bytes; use this with index-size deltas to judge write amplification.`);
  }
  if (requestIndexBytesPerInsertedRow !== null) {
    findings.push(`events_requests index growth was approximately ${Math.round(requestIndexBytesPerInsertedRow * 100) / 100} bytes per inserted request row during the capture.`);
  }
  if (totalDeadTupleDelta > 0) {
    findings.push(`Dead tuple count increased by ${totalDeadTupleDelta}; check autovacuum pressure if latency rises with table age.`);
  }
  if (pgbossPendingJobs > 0) {
    findings.push(`Primary pg-boss had ${pgbossPendingJobs} pending ingest job(s); queue backlog may be contributing to end-to-end latency.`);
  }
  if (primaryLockWaitCount > 0 || primaryWaitingActivityCount > 0) {
    findings.push(`Primary pg-boss snapshot captured ${primaryWaitingActivityCount} waiting session(s) and ${primaryLockWaitCount} lock waiter row(s); inspect query samples when API enqueueMs is high.`);
  }
  if ((primaryWalSyncTimeMsDelta ?? 0) > 0) {
    findings.push(`Primary DB WAL sync time increased by ${Math.round((primaryWalSyncTimeMsDelta ?? 0) * 100) / 100}ms during the capture; slow enqueueMs may be primary storage/fsync related.`);
  }
  if ((primaryWalSyncTimeMsPerCommit ?? 0) > 10) {
    findings.push(`Primary DB WAL sync averaged ${Math.round((primaryWalSyncTimeMsPerCommit ?? 0) * 100) / 100}ms per committed transaction; high enqueueMs may be fsync/storage/checkpoint sensitive.`);
  }
  if ((primaryTempBytesDelta ?? 0) > 0) {
    findings.push(`Primary DB temp bytes increased by ${primaryTempBytesDelta}; inspect pg-boss/query plans for sorts/hash spills during enqueue.`);
  }
  if (primaryCacheHitPct !== null && primaryCacheHitPct < 99) {
    findings.push(`Primary DB cache hit rate during capture was ${Math.round(primaryCacheHitPct * 100) / 100}%; buffer reads may be contributing to enqueue latency.`);
  }
  if ((primaryWalBytesDelta ?? 0) > 0 && pgbossInsertedDelta > 0) {
    findings.push(`Primary pg-boss WAL generated per inserted queue row was approximately ${Math.round((primaryWalBytesDelta! / pgbossInsertedDelta) * 100) / 100} bytes.`);
  }
  if ((pgbossIndexBytesDelta ?? 0) > 0 && pgbossInsertedDelta > 0) {
    findings.push(`Primary pg-boss index growth was approximately ${Math.round((pgbossIndexBytesDelta! / pgbossInsertedDelta) * 100) / 100} bytes per inserted queue row.`);
  }
  if (findings.length === 0) {
    findings.push('No lock, queue, dead-tuple, or WAL-sync pressure was obvious in this capture; compare EXPLAIN execution time and storage metrics next.');
  }

  return {
    generatedAt: report.generatedAt ?? null,
    samples: snapshots.length,
    intervalMs: finite(report.intervalMs),
    totalInsertedDelta,
    requestInsertedDelta,
    totalDeadTupleDelta,
    requestHeapBytesDelta,
    requestIndexBytesDelta,
    requestIndexBytesPerInsertedRow,
    walBytesDelta,
    walSyncTimeMsDelta,
    walSyncTimeMsPerCommit,
    logDbXactCommitDelta,
    logDbXactRollbackDelta,
    logDbBlocksReadDelta,
    logDbBlocksHitDelta,
    logDbCacheHitPct,
    logDbTempBytesDelta,
    primaryWalBytesDelta,
    primaryWalSyncTimeMsDelta,
    primaryWalSyncTimeMsPerCommit,
    primaryXactCommitDelta,
    primaryXactRollbackDelta,
    primaryBlocksReadDelta,
    primaryBlocksHitDelta,
    primaryCacheHitPct,
    primaryTempBytesDelta,
    waitingActivityCount,
    lockWaitCount,
    primaryWaitingActivityCount,
    primaryLockWaitCount,
    pgbossPendingJobs,
    pgbossActiveJobs,
    pgbossInsertedDelta,
    pgbossUpdatedDelta,
    pgbossIndexBytesDelta,
    largestRelations,
    largestPgbossRelations,
    topRelationGrowth,
    topPgbossRelationGrowth,
    topInsertTables: tableInsertDeltas.slice(0, 8),
    topPgbossWriteTables,
    findings,
    optionalStatsUnavailable: [
      ...(Array.isArray(last.logDb?.optionalStatsUnavailable)
        ? last.logDb.optionalStatsUnavailable.filter((item): item is string => typeof item === 'string')
        : []),
      ...(Array.isArray(last.primaryDb?.optionalStatsUnavailable)
        ? last.primaryDb.optionalStatsUnavailable.filter((item): item is string => typeof item === 'string')
        : []),
    ],
  };
}

function renderNumber(value: number | null): string {
  if (value === null) return '';
  return String(Math.round(value * 100) / 100);
}

function renderMarkdown(summary: RuntimeSummary): string {
  return [
    '# Ingestion Runtime DB Summary',
    '',
    `Generated at: ${summary.generatedAt ?? ''}`,
    `Samples: ${summary.samples}`,
    `Interval ms: ${summary.intervalMs ?? ''}`,
    '',
    '## Pressure Summary',
    '',
    '| Metric | Value |',
    '| --- | ---: |',
    `| Log DB inserted row delta | ${summary.totalInsertedDelta} |`,
    `| events_requests inserted row delta | ${summary.requestInsertedDelta} |`,
    `| events_requests heap bytes delta | ${renderNumber(summary.requestHeapBytesDelta)} |`,
    `| events_requests index bytes delta | ${renderNumber(summary.requestIndexBytesDelta)} |`,
    `| events_requests index bytes per inserted row | ${renderNumber(summary.requestIndexBytesPerInsertedRow)} |`,
    `| Log DB dead tuple delta | ${summary.totalDeadTupleDelta} |`,
    `| WAL bytes delta | ${renderNumber(summary.walBytesDelta)} |`,
    `| WAL sync time ms delta | ${renderNumber(summary.walSyncTimeMsDelta)} |`,
    `| WAL sync time ms per Log DB commit | ${renderNumber(summary.walSyncTimeMsPerCommit)} |`,
    `| Log DB committed transaction delta | ${renderNumber(summary.logDbXactCommitDelta)} |`,
    `| Log DB rollback transaction delta | ${renderNumber(summary.logDbXactRollbackDelta)} |`,
    `| Log DB block read delta | ${renderNumber(summary.logDbBlocksReadDelta)} |`,
    `| Log DB block hit delta | ${renderNumber(summary.logDbBlocksHitDelta)} |`,
    `| Log DB cache hit pct | ${renderNumber(summary.logDbCacheHitPct)} |`,
    `| Log DB temp bytes delta | ${renderNumber(summary.logDbTempBytesDelta)} |`,
    `| Waiting Log DB sessions | ${summary.waitingActivityCount} |`,
    `| Log DB lock waiter rows | ${summary.lockWaitCount} |`,
    `| pg-boss pending jobs | ${summary.pgbossPendingJobs} |`,
    `| pg-boss active jobs | ${summary.pgbossActiveJobs} |`,
    `| Primary DB WAL bytes delta | ${renderNumber(summary.primaryWalBytesDelta)} |`,
    `| Primary DB WAL sync time ms delta | ${renderNumber(summary.primaryWalSyncTimeMsDelta)} |`,
    `| Primary DB WAL sync time ms per commit | ${renderNumber(summary.primaryWalSyncTimeMsPerCommit)} |`,
    `| Primary DB committed transaction delta | ${renderNumber(summary.primaryXactCommitDelta)} |`,
    `| Primary DB rollback transaction delta | ${renderNumber(summary.primaryXactRollbackDelta)} |`,
    `| Primary DB block read delta | ${renderNumber(summary.primaryBlocksReadDelta)} |`,
    `| Primary DB block hit delta | ${renderNumber(summary.primaryBlocksHitDelta)} |`,
    `| Primary DB cache hit pct | ${renderNumber(summary.primaryCacheHitPct)} |`,
    `| Primary DB temp bytes delta | ${renderNumber(summary.primaryTempBytesDelta)} |`,
    `| Waiting Primary DB pg-boss sessions | ${summary.primaryWaitingActivityCount} |`,
    `| Primary DB pg-boss lock waiter rows | ${summary.primaryLockWaitCount} |`,
    `| Primary pg-boss inserted row delta | ${summary.pgbossInsertedDelta} |`,
    `| Primary pg-boss updated row delta | ${summary.pgbossUpdatedDelta} |`,
    `| Primary pg-boss index bytes delta | ${renderNumber(summary.pgbossIndexBytesDelta)} |`,
    '',
    '## Findings',
    '',
    ...summary.findings.map((finding) => `- ${finding}`),
    '',
    '## Top Insert Tables',
    '',
    '| Relation | Inserted delta |',
    '| --- | ---: |',
    ...summary.topInsertTables.map((row) => `| ${row.relation} | ${row.inserted} |`),
    '',
    '## Top Primary pg-boss Write Tables',
    '',
    '| Relation | Inserted delta | Updated delta |',
    '| --- | ---: | ---: |',
    ...summary.topPgbossWriteTables.map((row) => `| ${row.relation} | ${row.inserted} | ${row.updated} |`),
    '',
    '## Top Relation Growth',
    '',
    '| Relation | Total KB delta | Heap KB delta | Index KB delta |',
    '| --- | ---: | ---: | ---: |',
    ...summary.topRelationGrowth.map((row) => `| ${row.relation} | ${row.totalKb} | ${row.heapKb} | ${row.indexKb} |`),
    '',
    '## Top Primary pg-boss Relation Growth',
    '',
    '| Relation | Total KB delta | Heap KB delta | Index KB delta |',
    '| --- | ---: | ---: | ---: |',
    ...summary.topPgbossRelationGrowth.map((row) => `| ${row.relation} | ${row.totalKb} | ${row.heapKb} | ${row.indexKb} |`),
    '',
    '## Largest Relations',
    '',
    '| Relation | Total MB | Index MB |',
    '| --- | ---: | ---: |',
    ...summary.largestRelations.map((row) => `| ${row.relation} | ${row.totalMb} | ${row.indexMb} |`),
    '',
    '## Largest Primary pg-boss Relations',
    '',
    '| Relation | Total MB | Index MB |',
    '| --- | ---: | ---: |',
    ...summary.largestPgbossRelations.map((row) => `| ${row.relation} | ${row.totalMb} | ${row.indexMb} |`),
    '',
    summary.optionalStatsUnavailable.length > 0 ? '## Optional Stats Unavailable' : '',
    ...summary.optionalStatsUnavailable.map((item) => `- ${item}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const parsed = JSON.parse(await readFile(config.runtimePath, 'utf8')) as RuntimeReport;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.snapshots)) {
    throw new Error(`${config.runtimePath} does not contain ingestion:db:runtime output`);
  }
  const summary = summarize(parsed);
  const output = config.format === 'json'
    ? `${JSON.stringify(summary, null, 2)}\n`
    : renderMarkdown(summary);
  if (config.outPath) await writeFile(config.outPath, output, 'utf8');
  process.stdout.write(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
