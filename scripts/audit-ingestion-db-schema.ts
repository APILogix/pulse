/**
 * Read-only PostgreSQL catalog audit for ingestion hot-path tables.
 *
 * The final ingestion optimization evidence needs current table, index,
 * constraint, trigger, and partition state from the benchmark database. This
 * script captures that state without changing schema or data.
 */
import { writeFile } from 'fs/promises';
import type { Pool } from 'pg';
import { pool as primaryPool, closeDatabase } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';
import {
  GLOSSARY_GUARD_INDEXES,
  INGESTION_TABLE_SET,
  PRIOR_PHASE_INDEX_REMOVALS,
} from './lib/ingestion-catalog-scope.js';

type OutputFormat = 'markdown' | 'json';

interface AuditConfig {
  format: OutputFormat;
  outPath: string | null;
  tables: string[];
  includeFunctions: boolean;
}

interface TableRow {
  schema_name: string;
  table_name: string;
  relkind: string;
  row_estimate: number;
  bytes: string;
  partitioned: boolean;
}

interface IndexRow {
  schema_name: string;
  table_name: string;
  index_name: string;
  index_def: string;
}

interface ConstraintRow {
  schema_name: string;
  table_name: string;
  constraint_name: string;
  constraint_type: string;
  constraint_def: string;
}

interface TriggerRow {
  schema_name: string;
  table_name: string;
  trigger_name: string;
  enabled: string;
  timing: string;
  events: string[];
  function_name: string;
  definition: string;
  function_source: string | null;
}

interface PartitionRow {
  parent_schema: string;
  parent_table: string;
  child_schema: string;
  child_table: string;
}

interface TimescaleRow {
  hypertable_schema: string;
  hypertable_name: string;
  compression_enabled: boolean | null;
}

interface QueueRow {
  name: string;
  policy: string;
  partition: boolean;
  table_name: string;
  notify: boolean;
  queued_count: number;
  ready_count: number;
  deferred_count: number;
  active_count: number;
  failed_count: number;
  total_count: number;
}

interface AuditOutput {
  generatedAt: string;
  logDatabase: string;
  primaryDatabase: string;
  tablesRequested: string[];
  tables: TableRow[];
  indexes: IndexRow[];
  constraints: ConstraintRow[];
  triggers: TriggerRow[];
  partitions: PartitionRow[];
  timescaleHypertables: TimescaleRow[];
  primaryAuthIndexes: IndexRow[];
  pgbossTables: TableRow[];
  pgbossQueues: QueueRow[];
}

/**
 * Phase 2 additions. Every field below is additive: `AuditOutput` keeps its
 * exact shape so `scripts/summarize-ingestion-db-runtime.ts` and
 * `scripts/validate-ingestion-evidence-bundle.ts` keep parsing older bundles
 * and newer ones with the same code path.
 */

/** Recorded read-usage for one index, or the recorded reason it is unreadable. */
type IndexReadUsage =
  | { indexScans: number }
  | { indexScans: 'unavailable'; reason: string };

interface IndexUsageRow {
  table_name: string;
  index_name: string;
  access_method: string;
  index_def: string;
  /** Partial predicate, or the explicit value `NONE` where none exists (R4.2). */
  partial_predicate: string;
  is_unique: boolean;
  /** Parent index bytes plus every attached partition index, summed (R4.2). */
  bytes: string;
  attached_partition_indexes: number;
  attached_partition_indexes_with_stats: number;
  /** Parent scans plus every attached partition index scan, summed. */
  idx_scan: number | null;
  last_idx_scan: string | null;
  readUsage: IndexReadUsage;
  /**
   * `last_idx_scan` exists from PostgreSQL 16. Where it is absent the usage
   * window is bounded by the statistics reset timestamp alone (R4.3).
   */
  readUsageWindowSource: 'last_idx_scan' | 'stats_reset_only';
}

/**
 * The parent-versus-children split behind each summed `IndexUsageRow`. On a
 * partitioned table the parent index is never scanned directly, so reading the
 * parent alone reports a false zero that Requirement 22.6 would treat as
 * removal authorization. Recording the split makes that visible (R4.1).
 */
interface PartitionIndexRow {
  table_name: string;
  index_name: string;
  attached_partition_indexes: number;
  attached_partition_indexes_with_stats: number;
  parent_bytes: string;
  attached_bytes: string;
  total_bytes: string;
  parent_idx_scan: number | null;
  attached_idx_scan: number | null;
  total_idx_scan: number | null;
  parent_stat_present: boolean;
}

interface TableStorageRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  table_bytes: string;
  index_bytes: string;
  n_live_tup: number | null;
  n_dead_tup: number | null;
  dead_pct: number | null;
  last_autovacuum: string | null;
  last_autoanalyze: string | null;
  last_vacuum: string | null;
  last_analyze: string | null;
  /** R12.8: "never autovacuumed" is paired with the stats reset timestamp so it
   * is not conflated with "not autovacuumed since the reset". */
  neverAutovacuumed: boolean;
  neverAutoanalyzed: boolean;
  statsResetAt: string | null;
}

interface ToastRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  jsonb_columns: string[];
  has_jsonb_column: boolean;
  /** Explicit `false` for a JSONB-bearing relation with no TOAST relation (R12.2). */
  hasToast: boolean;
  toast_relation: string | null;
  toast_bytes: string | null;
  /** Parent rows only: TOAST summed across partitions, since a partitioned
   * parent never carries a TOAST relation of its own. */
  partition_toast_bytes: string | null;
  partitions_with_toast: number | null;
}

interface ReloptionRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  autovacuum_options: string[];
  settings: Record<string, string>;
  hasPerTableAutovacuumSettings: boolean;
}

/**
 * What the measured environment allowed this audit to read. Requirement 4.10
 * forbids a `REMOVE` disposition on an index whose usage count is unavailable,
 * so the reason has to be recorded rather than inferred from a zero.
 */
interface CatalogCapabilities {
  serverVersionNum: number | null;
  trackCounts: string | null;
  lastIdxScanSupported: boolean;
  collectionErrors: Record<string, string>;
}

interface AuditOutputV2 extends AuditOutput {
  statsResetAt: string | null;
  catalogCapabilities: CatalogCapabilities;
  indexUsage: IndexUsageRow[];
  partitionIndexRollup: PartitionIndexRow[];
  tableStorage: TableStorageRow[];
  toastRelations: ToastRow[];
  autovacuumSettings: ReloptionRow[];
  glossaryGuardIndexes: GuardIndexRow[];
  priorPhaseIndexRemovals: PriorPhaseIndexRemovalRow[];
}

/**
 * The catalog reading's verdict on one object the forensics expects to find, or
 * expects to be gone. `unconfirmed` exists because "the name is not in this
 * reading" and "the name is gone from the database" are different claims: if the
 * owning table was never audited, or is itself absent, an absent index name
 * proves nothing.
 */
type CatalogConfirmation =
  | { status: 'confirmed_absent'; detail: string }
  | { status: 'still_present'; detail: string }
  | { status: 'confirmed_present'; detail: string }
  | { status: 'missing'; detail: string }
  | { status: 'unconfirmed'; reason: string };

/**
 * Requirement 4.11: each index already removed by `025`, `028` or `029`,
 * recorded with its table, name, originating migration file, a prior-phase
 * `REMOVE` disposition, and the confirmation from this catalog reading that the
 * name is absent from the measured environment.
 */
interface PriorPhaseIndexRemovalRow {
  table_name: string;
  index_name: string;
  originating_migration_file: string;
  disposition: 'REMOVE';
  priorPhase: true;
  /** The table was in the audited set for this run. */
  owning_table_requested: boolean;
  /** The table came back from the catalog reading. */
  owning_table_present: boolean;
  absent_from_catalog: boolean;
  catalogConfirmation: CatalogConfirmation;
}

/**
 * A glossary term that names an index rather than a relation, resolved against
 * the catalog so the Index_Inventory records a real object. Requirement 4.9
 * forbids `REMOVE` and `MOVE_TO_DERIVED` on every entry listed here.
 */
interface GuardIndexRow {
  glossary_term: string;
  table_name: string;
  index_name: string;
  originating_migration_file: string;
  columns: string[];
  requirements: string[];
  origin_note: string;
  owning_table_requested: boolean;
  owning_table_present: boolean;
  present_in_catalog: boolean;
  is_unique: boolean | null;
  index_def: string | null;
  disposition: 'KEEP';
  catalogConfirmation: CatalogConfirmation;
}

/**
 * Requirement 4.1 audited scope. The glossary also lists
 * `events_errors_idempotency` in the Ingestion_Table_Set; it is an index, not a
 * relation, and is recorded through `glossaryGuardIndexes` instead of being
 * requested here as a table that does not exist.
 */
const defaultTables = [...INGESTION_TABLE_SET];

function tableFilterSql(alias: string): string {
  return `(${alias}.nspname = 'public' AND ${alias === 'n' ? 'c' : alias}.relname = ANY($1::text[]))
      OR (${alias}.nspname || '.' || ${alias === 'n' ? 'c' : alias}.relname = ANY($1::text[]))`;
}

/**
 * The Phase 2 catalog queries below match on `relname` alone, so a requested
 * table given as `public.events_errors` is reduced to `events_errors` first.
 */
function unqualifiedTables(tables: string[]): string[] {
  const names = new Set<string>();
  for (const table of tables) {
    const trimmed = table.trim();
    if (!trimmed) continue;
    const lastDot = trimmed.lastIndexOf('.');
    names.add(lastDot === -1 ? trimmed : trimmed.slice(lastDot + 1));
  }
  return [...names];
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBigintText(value: unknown): string {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'string') return value;
  return String(value);
}

function addBigintText(left: string, right: string): string {
  try {
    return (BigInt(left) + BigInt(right)).toString();
  } catch {
    return String((toNumber(left) ?? 0) + (toNumber(right) ?? 0));
  }
}

function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

/** Parses `key=value` reloption entries into a lookup, keeping unparsed entries out. */
function parseReloptions(options: string[]): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const option of options) {
    const separator = option.indexOf('=');
    if (separator <= 0) continue;
    settings[option.slice(0, separator)] = option.slice(separator + 1);
  }
  return settings;
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:db:audit -- [--format markdown|json] [--out audit.md] [--tables table_a,table_b] [--no-functions]
`);
  process.exit(2);
}

function parseArgs(): AuditConfig {
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

  if (args.help === true || args.h === true) usage();
  const tables = typeof args.tables === 'string'
    ? args.tables.split(',').map((table) => table.trim()).filter(Boolean)
    : defaultTables;
  if (tables.length === 0) usage();

  return {
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
    tables,
    includeFunctions: args['no-functions'] !== true,
  };
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(', ').replace(/\|/g, '\\|');
  return String(value).replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
}

/** Formats a byte count without going through a lossy float conversion. */
function renderBytes(value: string | null): string {
  if (value === null) return '';
  try {
    return BigInt(value).toLocaleString('en-US');
  } catch {
    const parsed = toNumber(value);
    return parsed === null ? value : parsed.toLocaleString('en-US');
  }
}

function renderReadUsage(readUsage: IndexReadUsage): string {
  return readUsage.indexScans === 'unavailable'
    ? `unavailable (${readUsage.reason})`
    : String(readUsage.indexScans);
}

function renderConfirmation(confirmation: CatalogConfirmation): string {
  return confirmation.status === 'unconfirmed'
    ? `unconfirmed (${confirmation.reason})`
    : `${confirmation.status} (${confirmation.detail})`;
}

function renderMarkdown(audit: AuditOutputV2): string {
  const lines = [
    '# Ingestion Database Schema Audit',
    '',
    `Generated at: ${audit.generatedAt}`,
    `Log database: ${audit.logDatabase}`,
    `Primary database: ${audit.primaryDatabase}`,
    `Tables requested: ${audit.tablesRequested.join(', ')}`,
    `Stats reset at: ${audit.statsResetAt ?? 'unavailable'}`,
    `Server version num: ${audit.catalogCapabilities.serverVersionNum ?? 'unavailable'}`,
    `track_counts: ${audit.catalogCapabilities.trackCounts ?? 'unavailable'}`,
    `last_idx_scan supported: ${audit.catalogCapabilities.lastIdxScanSupported}`,
    `Read-usage window source: ${audit.catalogCapabilities.lastIdxScanSupported ? 'last_idx_scan' : 'stats_reset_only'}`,
    '',
    '## Tables',
    '',
    '| Schema | Table | Kind | Partitioned | Row estimate | Bytes |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...audit.tables.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.relkind,
      row.partitioned,
      row.row_estimate,
      row.bytes,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Indexes',
    '',
    '| Schema | Table | Index | Definition |',
    '| --- | --- | --- | --- |',
    ...audit.indexes.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.index_name,
      row.index_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Index Usage',
    '',
    'Bytes and index scans are summed across the parent index and every attached partition index.',
    '',
    '| Table | Index | Access method | Unique | Partial predicate | Bytes | Attached partition indexes | With stats | Index scans | Last index scan | Read usage | Window source |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- |',
    ...audit.indexUsage.map((row) => `| ${[
      row.table_name,
      row.index_name,
      row.access_method,
      row.is_unique,
      row.partial_predicate,
      renderBytes(row.bytes),
      row.attached_partition_indexes,
      row.attached_partition_indexes_with_stats,
      row.idx_scan ?? 'unavailable',
      row.last_idx_scan ?? '',
      renderReadUsage(row.readUsage),
      row.readUsageWindowSource,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Partition Index Rollup',
    '',
    '| Table | Index | Attached partition indexes | With stats | Parent bytes | Attached bytes | Total bytes | Parent scans | Attached scans | Total scans | Parent stat present |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...audit.partitionIndexRollup.map((row) => `| ${[
      row.table_name,
      row.index_name,
      row.attached_partition_indexes,
      row.attached_partition_indexes_with_stats,
      renderBytes(row.parent_bytes),
      renderBytes(row.attached_bytes),
      renderBytes(row.total_bytes),
      row.parent_idx_scan ?? 'unavailable',
      row.attached_idx_scan ?? 'unavailable',
      row.total_idx_scan ?? 'unavailable',
      row.parent_stat_present,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Glossary Guard Indexes',
    '',
    'Glossary terms in the Ingestion_Table_Set that name an index rather than a relation, resolved against this catalog reading.',
    '',
    '| Glossary term | Table | Index | Origin migration | Columns | Requirements | Unique | Present | Disposition | Confirmation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...audit.glossaryGuardIndexes.map((row) => `| ${[
      row.glossary_term,
      row.table_name,
      row.index_name,
      row.originating_migration_file,
      row.columns,
      row.requirements,
      row.is_unique ?? 'unavailable',
      row.present_in_catalog,
      row.disposition,
      renderConfirmation(row.catalogConfirmation),
    ].map(renderCell).join(' | ')} |`),
    '',
    ...audit.glossaryGuardIndexes.map((row) => `- ${row.glossary_term}: ${row.origin_note}`),
    '',
    '## Prior-Phase Index Removals',
    '',
    'Indexes already removed by 025, 028 and 029, each with the confirmation from this reading that the name is absent.',
    '',
    '| Table | Index | Originating migration | Disposition | Prior phase | Table present | Absent from catalog | Confirmation |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...audit.priorPhaseIndexRemovals.map((row) => `| ${[
      row.table_name,
      row.index_name,
      row.originating_migration_file,
      row.disposition,
      row.priorPhase,
      row.owning_table_present,
      row.absent_from_catalog,
      renderConfirmation(row.catalogConfirmation),
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Constraints',
    '',
    '| Schema | Table | Constraint | Type | Definition |',
    '| --- | --- | --- | --- | --- |',
    ...audit.constraints.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.constraint_name,
      row.constraint_type,
      row.constraint_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Triggers',
    '',
    '| Schema | Table | Trigger | Enabled | Timing | Events | Function | Definition |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...audit.triggers.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.trigger_name,
      row.enabled,
      row.timing,
      row.events,
      row.function_name,
      row.definition,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Partitions',
    '',
    '| Parent schema | Parent table | Child schema | Child table |',
    '| --- | --- | --- | --- |',
    ...audit.partitions.map((row) => `| ${[
      row.parent_schema,
      row.parent_table,
      row.child_schema,
      row.child_table,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Table Storage',
    '',
    '| Relation | Parent | Kind | Table bytes | Index bytes | Live tuples | Dead tuples | Dead pct | Last autovacuum | Last autoanalyze | Last vacuum | Last analyze | Never autovacuumed | Never autoanalyzed | Stats reset at |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- | --- |',
    ...audit.tableStorage.map((row) => `| ${[
      row.relation,
      row.parent_relation,
      row.relkind,
      renderBytes(row.table_bytes),
      renderBytes(row.index_bytes),
      row.n_live_tup ?? 'unavailable',
      row.n_dead_tup ?? 'unavailable',
      row.dead_pct === null ? '' : row.dead_pct.toFixed(2),
      row.last_autovacuum ?? '',
      row.last_autoanalyze ?? '',
      row.last_vacuum ?? '',
      row.last_analyze ?? '',
      row.neverAutovacuumed,
      row.neverAutoanalyzed,
      row.statsResetAt ?? 'unavailable',
    ].map(renderCell).join(' | ')} |`),
    '',
    '## TOAST Relations',
    '',
    '| Relation | Parent | Kind | JSONB columns | Has JSONB column | Has TOAST | TOAST relation | TOAST bytes | Partition TOAST bytes | Partitions with TOAST |',
    '| --- | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: |',
    ...audit.toastRelations.map((row) => `| ${[
      row.relation,
      row.parent_relation,
      row.relkind,
      row.jsonb_columns,
      row.has_jsonb_column,
      row.hasToast,
      row.toast_relation ?? '',
      renderBytes(row.toast_bytes),
      renderBytes(row.partition_toast_bytes),
      row.partitions_with_toast ?? '',
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Autovacuum Settings',
    '',
    '| Relation | Parent | Kind | Autovacuum options | Per-table settings present |',
    '| --- | --- | --- | --- | --- |',
    ...audit.autovacuumSettings.map((row) => `| ${[
      row.relation,
      row.parent_relation,
      row.relkind,
      row.autovacuum_options.length > 0 ? row.autovacuum_options : 'NONE',
      row.hasPerTableAutovacuumSettings,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Timescale Hypertables',
    '',
    '| Schema | Hypertable | Compression enabled |',
    '| --- | --- | --- |',
    ...audit.timescaleHypertables.map((row) => `| ${[
      row.hypertable_schema,
      row.hypertable_name,
      row.compression_enabled,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## Primary Auth Indexes',
    '',
    '| Schema | Table | Index | Definition |',
    '| --- | --- | --- | --- |',
    ...audit.primaryAuthIndexes.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.index_name,
      row.index_def,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## pg-boss Tables',
    '',
    '| Schema | Table | Kind | Partitioned | Row estimate | Bytes |',
    '| --- | --- | --- | --- | ---: | ---: |',
    ...audit.pgbossTables.map((row) => `| ${[
      row.schema_name,
      row.table_name,
      row.relkind,
      row.partitioned,
      row.row_estimate,
      row.bytes,
    ].map(renderCell).join(' | ')} |`),
    '',
    '## pg-boss Queues',
    '',
    '| Queue | Policy | Partitioned | Table | Notify | Queued | Ready | Deferred | Active | Failed | Total |',
    '| --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...audit.pgbossQueues.map((row) => `| ${[
      row.name,
      row.policy,
      row.partition,
      row.table_name,
      row.notify,
      row.queued_count,
      row.ready_count,
      row.deferred_count,
      row.active_count,
      row.failed_count,
      row.total_count,
    ].map(renderCell).join(' | ')} |`),
    '',
  ];

  const collectionErrors = Object.entries(audit.catalogCapabilities.collectionErrors);
  if (collectionErrors.length > 0) {
    lines.push(
      '## Catalog Collection Errors',
      '',
      '| Section | Reason |',
      '| --- | --- |',
      ...collectionErrors.map(([section, reason]) => `| ${[section, reason].map(renderCell).join(' | ')} |`),
      '',
    );
  }

  if (audit.triggers.some((trigger) => trigger.function_source)) {
    lines.push('## Trigger Functions', '');
    for (const trigger of audit.triggers) {
      if (!trigger.function_source) continue;
      lines.push(`### ${trigger.function_name}`, '', '```sql', trigger.function_source.trim(), '```', '');
    }
  }

  return `${lines.join('\n')}\n`;
}

async function collectCapabilities(pool: Pool): Promise<{
  capabilities: CatalogCapabilities;
  statsResetAt: string | null;
}> {
  const collectionErrors: Record<string, string> = {};

  let serverVersionNum: number | null = null;
  let trackCounts: string | null = null;
  let lastIdxScanSupported = false;
  let statsResetAt: string | null = null;

  try {
    const version = await pool.query<{ server_version_num: string }>(
      `SELECT current_setting('server_version_num') AS server_version_num`,
    );
    serverVersionNum = toNumber(version.rows[0]?.server_version_num);
  } catch (err) {
    collectionErrors.serverVersionNum = errorMessage(err);
  }

  try {
    const counts = await pool.query<{ track_counts: string }>(
      `SELECT current_setting('track_counts') AS track_counts`,
    );
    trackCounts = counts.rows[0]?.track_counts ?? null;
  } catch (err) {
    collectionErrors.trackCounts = errorMessage(err);
  }

  try {
    // `last_idx_scan` exists from PostgreSQL 16, so it is probed rather than assumed.
    const probe = await pool.query<{ available: boolean }>(
      `
      SELECT EXISTS (
        SELECT 1
          FROM pg_attribute
         WHERE attrelid = 'pg_catalog.pg_stat_all_indexes'::regclass
           AND attname = 'last_idx_scan'
           AND NOT attisdropped
      ) AS available
      `,
    );
    lastIdxScanSupported = probe.rows[0]?.available === true;
  } catch (err) {
    collectionErrors.lastIdxScanSupported = errorMessage(err);
  }

  try {
    const reset = await pool.query<{ stats_reset: Date | string | null }>(
      `SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`,
    );
    statsResetAt = toIsoOrNull(reset.rows[0]?.stats_reset ?? null);
  } catch (err) {
    collectionErrors.statsResetAt = errorMessage(err);
  }

  return {
    capabilities: { serverVersionNum, trackCounts, lastIdxScanSupported, collectionErrors },
    statsResetAt,
  };
}

interface IndexUsageQueryRow {
  table_name: string;
  index_name: string;
  access_method: string;
  index_def: string;
  partial_predicate: string;
  is_unique: boolean;
  bytes: string;
  attached_partition_indexes: number;
  attached_partition_indexes_with_stats: number;
  idx_scan: string | number | null;
  last_idx_scan: Date | string | null;
  parent_stat_present: boolean;
}

/**
 * Requirement 4.2 / 4.3 / 4.10. Size and scan count are summed across the parent
 * index and every attached partition index via `pg_inherits`: on a partitioned
 * table only the partition indexes accumulate `idx_scan`, so reading the parent
 * alone reports a false zero.
 */
async function collectIndexUsage(
  pool: Pool,
  tables: string[],
  capabilities: CatalogCapabilities,
): Promise<IndexUsageRow[]> {
  const lastIdxScanExpr = capabilities.lastIdxScanSupported
    ? 's.last_idx_scan'
    : 'NULL::timestamptz';

  const result = await pool.query<IndexUsageQueryRow>(
    `
    WITH target AS (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND c.relkind IN ('r','p')
    ),
    idx AS (
      SELECT i.indexrelid, i.indrelid, ix.relname AS index_name, t.relname AS table_name,
             am.amname AS access_method, i.indisunique,
             pg_get_indexdef(i.indexrelid) AS index_def,
             pg_get_expr(i.indpred, i.indrelid) AS partial_predicate
        FROM pg_index i
        JOIN pg_class ix ON ix.oid = i.indexrelid
        JOIN pg_am am ON am.oid = ix.relam
        JOIN target t ON t.oid = i.indrelid
    ),
    attached AS (  -- partition indexes hanging off each parent index
      SELECT ip.indexrelid AS parent_index, ci.oid AS child_index
        FROM idx ip JOIN pg_inherits h ON h.inhparent = ip.indexrelid
        JOIN pg_class ci ON ci.oid = h.inhrelid
    )
    SELECT idx.table_name, idx.index_name, idx.access_method, idx.index_def,
           COALESCE(idx.partial_predicate, 'NONE') AS partial_predicate, idx.indisunique AS is_unique,
           (pg_relation_size(idx.indexrelid)
             + COALESCE((SELECT SUM(pg_relation_size(a.child_index))
                           FROM attached a WHERE a.parent_index = idx.indexrelid), 0))::text AS bytes,
           (SELECT COUNT(*) FROM attached a WHERE a.parent_index = idx.indexrelid)::int
             AS attached_partition_indexes,
           (SELECT COUNT(*) FROM attached a
              JOIN pg_stat_all_indexes cs ON cs.indexrelid = a.child_index
             WHERE a.parent_index = idx.indexrelid)::int
             AS attached_partition_indexes_with_stats,
           (COALESCE(s.idx_scan, 0)
             + COALESCE((SELECT SUM(cs.idx_scan) FROM attached a
                           JOIN pg_stat_all_indexes cs ON cs.indexrelid = a.child_index
                          WHERE a.parent_index = idx.indexrelid), 0))::bigint AS idx_scan,
           ${lastIdxScanExpr} AS last_idx_scan,
           (s.indexrelid IS NOT NULL) AS parent_stat_present
      FROM idx LEFT JOIN pg_stat_all_indexes s ON s.indexrelid = idx.indexrelid
     ORDER BY idx.table_name, idx.index_name
    `,
    [tables],
  );

  const trackCountsOff = capabilities.trackCounts !== null && capabilities.trackCounts !== 'on';

  return result.rows.map((row) => {
    const attached = toNumber(row.attached_partition_indexes) ?? 0;
    const attachedWithStats = toNumber(row.attached_partition_indexes_with_stats) ?? 0;
    const scans = toNumber(row.idx_scan);

    let readUsage: IndexReadUsage;
    if (trackCountsOff) {
      readUsage = {
        indexScans: 'unavailable',
        reason: `track_counts is ${capabilities.trackCounts ?? 'unknown'} in the measured environment, so index scan counts are not collected`,
      };
    } else if (!row.parent_stat_present && attached === 0) {
      readUsage = {
        indexScans: 'unavailable',
        reason: `${row.index_name} is absent from pg_stat_all_indexes and has no attached partition index to sum`,
      };
    } else if (attached > 0 && attachedWithStats < attached) {
      readUsage = {
        indexScans: 'unavailable',
        reason: `${attached - attachedWithStats} of ${attached} attached partition indexes are absent from pg_stat_all_indexes, so the summed scan count is incomplete`,
      };
    } else if (scans === null) {
      readUsage = {
        indexScans: 'unavailable',
        reason: `pg_stat_all_indexes returned no idx_scan value for ${row.index_name}`,
      };
    } else {
      readUsage = { indexScans: scans };
    }

    return {
      table_name: row.table_name,
      index_name: row.index_name,
      access_method: row.access_method,
      index_def: row.index_def,
      partial_predicate: row.partial_predicate,
      is_unique: row.is_unique === true,
      bytes: toBigintText(row.bytes),
      attached_partition_indexes: attached,
      attached_partition_indexes_with_stats: attachedWithStats,
      idx_scan: scans,
      last_idx_scan: toIsoOrNull(row.last_idx_scan),
      readUsage,
      readUsageWindowSource: capabilities.lastIdxScanSupported ? 'last_idx_scan' : 'stats_reset_only',
    } satisfies IndexUsageRow;
  });
}

interface PartitionIndexQueryRow {
  table_name: string;
  index_name: string;
  attached_partition_indexes: number;
  attached_partition_indexes_with_stats: number;
  parent_bytes: string;
  attached_bytes: string;
  parent_idx_scan: string | number | null;
  attached_idx_scan: string | number | null;
  parent_stat_present: boolean;
}

async function collectPartitionIndexRollup(pool: Pool, tables: string[]): Promise<PartitionIndexRow[]> {
  const result = await pool.query<PartitionIndexQueryRow>(
    `
    WITH target AS (
      SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY($1::text[]) AND c.relkind IN ('r','p')
    ),
    parent_idx AS (
      SELECT i.indexrelid, ix.relname AS index_name, t.relname AS table_name
        FROM pg_index i
        JOIN pg_class ix ON ix.oid = i.indexrelid
        JOIN target t ON t.oid = i.indrelid
    )
    SELECT p.table_name, p.index_name,
           (SELECT COUNT(*) FROM pg_inherits h WHERE h.inhparent = p.indexrelid)::int
             AS attached_partition_indexes,
           (SELECT COUNT(*) FROM pg_inherits h
              JOIN pg_stat_all_indexes cs ON cs.indexrelid = h.inhrelid
             WHERE h.inhparent = p.indexrelid)::int
             AS attached_partition_indexes_with_stats,
           pg_relation_size(p.indexrelid)::text AS parent_bytes,
           COALESCE((SELECT SUM(pg_relation_size(h.inhrelid)) FROM pg_inherits h
                      WHERE h.inhparent = p.indexrelid), 0)::text AS attached_bytes,
           COALESCE(ps.idx_scan, 0)::bigint AS parent_idx_scan,
           COALESCE((SELECT SUM(cs.idx_scan) FROM pg_inherits h
                       JOIN pg_stat_all_indexes cs ON cs.indexrelid = h.inhrelid
                      WHERE h.inhparent = p.indexrelid), 0)::bigint AS attached_idx_scan,
           (ps.indexrelid IS NOT NULL) AS parent_stat_present
      FROM parent_idx p
      LEFT JOIN pg_stat_all_indexes ps ON ps.indexrelid = p.indexrelid
     ORDER BY p.table_name, p.index_name
    `,
    [tables],
  );

  return result.rows.map((row) => {
    const parentBytes = toBigintText(row.parent_bytes);
    const attachedBytes = toBigintText(row.attached_bytes);
    const parentScans = toNumber(row.parent_idx_scan);
    const attachedScans = toNumber(row.attached_idx_scan);
    return {
      table_name: row.table_name,
      index_name: row.index_name,
      attached_partition_indexes: toNumber(row.attached_partition_indexes) ?? 0,
      attached_partition_indexes_with_stats: toNumber(row.attached_partition_indexes_with_stats) ?? 0,
      parent_bytes: parentBytes,
      attached_bytes: attachedBytes,
      total_bytes: addBigintText(parentBytes, attachedBytes),
      parent_idx_scan: parentScans,
      attached_idx_scan: attachedScans,
      total_idx_scan: parentScans === null && attachedScans === null
        ? null
        : (parentScans ?? 0) + (attachedScans ?? 0),
      parent_stat_present: row.parent_stat_present === true,
    } satisfies PartitionIndexRow;
  });
}

interface TableStorageQueryRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  table_bytes: string;
  index_bytes: string;
  n_live_tup: string | number | null;
  n_dead_tup: string | number | null;
  dead_pct: string | number | null;
  last_autovacuum: Date | string | null;
  last_autoanalyze: Date | string | null;
  last_vacuum: Date | string | null;
  last_analyze: Date | string | null;
}

/** Requirement 12.1: parents and every partition. */
async function collectTableStorage(
  pool: Pool,
  tables: string[],
  statsResetAt: string | null,
): Promise<TableStorageRow[]> {
  const result = await pool.query<TableStorageQueryRow>(
    `
    SELECT c.relname AS relation, COALESCE(pc.relname, c.relname) AS parent_relation,
           c.relkind::text AS relkind,
           pg_table_size(c.oid)::text AS table_bytes,
           pg_indexes_size(c.oid)::text AS index_bytes,
           s.n_live_tup, s.n_dead_tup,
           CASE WHEN s.n_live_tup > 0
                THEN ROUND((s.n_dead_tup::numeric / s.n_live_tup) * 100, 2) ELSE NULL END AS dead_pct,
           s.last_autovacuum, s.last_autoanalyze, s.last_vacuum, s.last_analyze
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_stat_all_tables s ON s.relid = c.oid
      LEFT JOIN pg_inherits h ON h.inhrelid = c.oid
      LEFT JOIN pg_class pc ON pc.oid = h.inhparent
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (c.relname = ANY($1::text[]) OR pc.relname = ANY($1::text[]))
     ORDER BY COALESCE(pc.relname, c.relname), c.relname
    `,
    [tables],
  );

  return result.rows.map((row) => {
    const lastAutovacuum = toIsoOrNull(row.last_autovacuum);
    const lastAutoanalyze = toIsoOrNull(row.last_autoanalyze);
    return {
      relation: row.relation,
      parent_relation: row.parent_relation,
      relkind: row.relkind,
      table_bytes: toBigintText(row.table_bytes),
      index_bytes: toBigintText(row.index_bytes),
      n_live_tup: toNumber(row.n_live_tup),
      n_dead_tup: toNumber(row.n_dead_tup),
      dead_pct: toNumber(row.dead_pct),
      last_autovacuum: lastAutovacuum,
      last_autoanalyze: lastAutoanalyze,
      last_vacuum: toIsoOrNull(row.last_vacuum),
      last_analyze: toIsoOrNull(row.last_analyze),
      neverAutovacuumed: lastAutovacuum === null,
      neverAutoanalyzed: lastAutoanalyze === null,
      statsResetAt,
    } satisfies TableStorageRow;
  });
}

interface ToastQueryRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  jsonb_columns: string[] | null;
  has_jsonb_column: boolean;
  has_toast: boolean;
  toast_relation: string | null;
  toast_bytes: string | null;
}

/**
 * Requirement 12.2. A partitioned parent never carries a TOAST relation of its
 * own, so recording `hasToast: false` for it in isolation would read as "this
 * table has no TOAST" when its partitions do. Partition TOAST is therefore
 * summed onto the parent row alongside the parent's own explicit `false`.
 */
async function collectToastRelations(pool: Pool, tables: string[]): Promise<ToastRow[]> {
  const result = await pool.query<ToastQueryRow>(
    `
    WITH target AS (
      SELECT c.oid, c.relname, c.relkind::text AS relkind, c.reltoastrelid,
             COALESCE(pc.relname, c.relname) AS parent_relation
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_inherits h ON h.inhrelid = c.oid
        LEFT JOIN pg_class pc ON pc.oid = h.inhparent
       WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
         AND (c.relname = ANY($1::text[]) OR pc.relname = ANY($1::text[]))
    ),
    jsonb_cols AS (
      SELECT t.oid, ARRAY_AGG(a.attname::text ORDER BY a.attnum) AS cols
        FROM target t
        JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
        JOIN pg_type ty ON ty.oid = a.atttypid
       WHERE ty.typname IN ('jsonb', 'json')
       GROUP BY t.oid
    )
    SELECT t.relname AS relation, t.parent_relation, t.relkind,
           j.cols AS jsonb_columns,
           (j.oid IS NOT NULL) AS has_jsonb_column,
           (t.reltoastrelid <> 0) AS has_toast,
           tc.relname AS toast_relation,
           CASE WHEN t.reltoastrelid <> 0
                THEN pg_total_relation_size(t.reltoastrelid)::text ELSE NULL END AS toast_bytes
      FROM target t
      LEFT JOIN jsonb_cols j ON j.oid = t.oid
      LEFT JOIN pg_class tc ON tc.oid = t.reltoastrelid
     ORDER BY t.parent_relation, t.relname
    `,
    [tables],
  );

  const partitionToastBytes = new Map<string, string>();
  const partitionsWithToast = new Map<string, number>();
  for (const row of result.rows) {
    if (row.relation === row.parent_relation) continue;
    const current = partitionToastBytes.get(row.parent_relation) ?? '0';
    partitionToastBytes.set(row.parent_relation, addBigintText(current, toBigintText(row.toast_bytes)));
    if (row.has_toast === true) {
      partitionsWithToast.set(row.parent_relation, (partitionsWithToast.get(row.parent_relation) ?? 0) + 1);
    }
  }

  return result.rows.map((row) => {
    const isParent = row.relation === row.parent_relation;
    return {
      relation: row.relation,
      parent_relation: row.parent_relation,
      relkind: row.relkind,
      jsonb_columns: toStringArray(row.jsonb_columns),
      has_jsonb_column: row.has_jsonb_column === true,
      hasToast: row.has_toast === true,
      toast_relation: row.toast_relation ?? null,
      toast_bytes: row.toast_bytes === null || row.toast_bytes === undefined
        ? null
        : toBigintText(row.toast_bytes),
      partition_toast_bytes: isParent ? partitionToastBytes.get(row.relation) ?? '0' : null,
      partitions_with_toast: isParent ? partitionsWithToast.get(row.relation) ?? 0 : null,
    } satisfies ToastRow;
  });
}

interface ReloptionQueryRow {
  relation: string;
  parent_relation: string;
  relkind: string;
  autovacuum_options: string[] | null;
}

/**
 * Requirement 12.4 / 12.7: the before/after comparison of a per-table
 * autovacuum setting needs the current definition to compare against.
 */
async function collectAutovacuumSettings(pool: Pool, tables: string[]): Promise<ReloptionRow[]> {
  const result = await pool.query<ReloptionQueryRow>(
    `
    SELECT c.relname AS relation, COALESCE(pc.relname, c.relname) AS parent_relation,
           c.relkind::text AS relkind,
           (
             SELECT ARRAY_AGG(opt ORDER BY opt)
               FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) AS opt
              WHERE starts_with(opt, 'autovacuum_')
                 OR starts_with(opt, 'toast.autovacuum_')
           ) AS autovacuum_options
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_inherits h ON h.inhrelid = c.oid
      LEFT JOIN pg_class pc ON pc.oid = h.inhparent
     WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
       AND (c.relname = ANY($1::text[]) OR pc.relname = ANY($1::text[]))
     ORDER BY COALESCE(pc.relname, c.relname), c.relname
    `,
    [tables],
  );

  return result.rows.map((row) => {
    const options = toStringArray(row.autovacuum_options);
    return {
      relation: row.relation,
      parent_relation: row.parent_relation,
      relkind: row.relkind,
      autovacuum_options: options,
      settings: parseReloptions(options),
      hasPerTableAutovacuumSettings: options.length > 0,
    } satisfies ReloptionRow;
  });
}

/** Index names this reading returned, keyed `table_name` → set of index names. */
function indexNamesByTable(indexes: IndexRow[]): Map<string, Set<string>> {
  const byTable = new Map<string, Set<string>>();
  for (const row of indexes) {
    const names = byTable.get(row.table_name) ?? new Set<string>();
    names.add(row.index_name);
    byTable.set(row.table_name, names);
  }
  return byTable;
}

/**
 * Requirement 4.11. Derived from the catalog reading this run already produced,
 * so the confirmation and the definitions it is compared against come from the
 * same reading at the same timestamp.
 */
function resolvePriorPhaseIndexRemovals(
  requestedTables: string[],
  presentTables: TableRow[],
  indexes: IndexRow[],
): PriorPhaseIndexRemovalRow[] {
  const requested = new Set(requestedTables);
  const present = new Set(presentTables.map((row) => row.table_name));
  const byTable = indexNamesByTable(indexes);

  return PRIOR_PHASE_INDEX_REMOVALS.map((removal) => {
    const owningTableRequested = requested.has(removal.table);
    const owningTablePresent = present.has(removal.table);
    const stillPresent = byTable.get(removal.table)?.has(removal.indexName) === true;

    let catalogConfirmation: CatalogConfirmation;
    if (!owningTableRequested) {
      catalogConfirmation = {
        status: 'unconfirmed',
        reason: `${removal.table} was not in the audited table set for this run, so this reading cannot confirm ${removal.indexName} is absent`,
      };
    } else if (!owningTablePresent) {
      catalogConfirmation = {
        status: 'unconfirmed',
        reason: `${removal.table} is itself absent from the catalog reading, so the absence of ${removal.indexName} does not confirm ${removal.migrationFile} was applied`,
      };
    } else if (stillPresent) {
      catalogConfirmation = {
        status: 'still_present',
        detail: `${removal.indexName} is still present on ${removal.table} in the measured environment even though ${removal.migrationFile} drops it`,
      };
    } else {
      catalogConfirmation = {
        status: 'confirmed_absent',
        detail: `${removal.indexName} is absent from the catalog reading of ${removal.table}, confirming the ${removal.migrationFile} removal in the measured environment`,
      };
    }

    return {
      table_name: removal.table,
      index_name: removal.indexName,
      originating_migration_file: removal.migrationFile,
      disposition: 'REMOVE',
      priorPhase: true,
      owning_table_requested: owningTableRequested,
      owning_table_present: owningTablePresent,
      absent_from_catalog: !stillPresent,
      catalogConfirmation,
    } satisfies PriorPhaseIndexRemovalRow;
  });
}

/**
 * Resolves each glossary term that names an index rather than a relation, so the
 * Ingestion_Table_Set term `events_errors_idempotency` points at a real object
 * instead of being audited as a missing table.
 */
function resolveGlossaryGuardIndexes(
  requestedTables: string[],
  presentTables: TableRow[],
  indexes: IndexRow[],
  indexUsage: IndexUsageRow[],
): GuardIndexRow[] {
  const requested = new Set(requestedTables);
  const present = new Set(presentTables.map((row) => row.table_name));
  const byTable = indexNamesByTable(indexes);

  return GLOSSARY_GUARD_INDEXES.map((guard) => {
    const owningTableRequested = requested.has(guard.table);
    const owningTablePresent = present.has(guard.table);
    const presentInCatalog = byTable.get(guard.table)?.has(guard.indexName) === true;
    const usage = indexUsage.find(
      (row) => row.table_name === guard.table && row.index_name === guard.indexName,
    );
    const definition = indexes.find(
      (row) => row.table_name === guard.table && row.index_name === guard.indexName,
    );

    let catalogConfirmation: CatalogConfirmation;
    if (!owningTableRequested || !owningTablePresent) {
      catalogConfirmation = {
        status: 'unconfirmed',
        reason: owningTableRequested
          ? `${guard.table} is absent from the catalog reading, so ${guard.indexName} could not be resolved`
          : `${guard.table} was not in the audited table set for this run, so ${guard.indexName} could not be resolved`,
      };
    } else if (presentInCatalog) {
      catalogConfirmation = {
        status: 'confirmed_present',
        detail: `${guard.glossaryTerm} resolves to index ${guard.indexName} on ${guard.table}, created by ${guard.originMigrationFile}`,
      };
    } else {
      catalogConfirmation = {
        status: 'missing',
        detail: `${guard.glossaryTerm} resolves to index ${guard.indexName} on ${guard.table}, but that index is absent from the measured environment even though ${guard.originMigrationFile} creates it`,
      };
    }

    return {
      glossary_term: guard.glossaryTerm,
      table_name: guard.table,
      index_name: guard.indexName,
      originating_migration_file: guard.originMigrationFile,
      columns: [...guard.columns],
      requirements: [...guard.requirements],
      origin_note: guard.originNote,
      owning_table_requested: owningTableRequested,
      owning_table_present: owningTablePresent,
      present_in_catalog: presentInCatalog,
      is_unique: usage?.is_unique ?? null,
      index_def: definition?.index_def ?? usage?.index_def ?? null,
      disposition: 'KEEP',
      catalogConfirmation,
    } satisfies GuardIndexRow;
  });
}

async function collectAudit(config: AuditConfig): Promise<AuditOutputV2> {  await logDB.connect();
  const pool = logDB.getPrimaryPool();

  const database = await pool.query<{ current_database: string }>('SELECT current_database()');
  const primaryDatabase = await primaryPool.query<{ current_database: string }>('SELECT current_database()');

  const tables = await pool.query<TableRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind::text AS relkind,
      c.reltuples::bigint AS row_estimate,
      pg_total_relation_size(c.oid)::text AS bytes,
      c.relkind = 'p' AS partitioned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (${tableFilterSql('n')})
      AND c.relkind IN ('r', 'p')
    ORDER BY n.nspname, c.relname
    `,
    [config.tables],
  );

  const indexes = await pool.query<IndexRow>(
    `
    SELECT
      schemaname AS schema_name,
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS index_def
    FROM pg_indexes
    WHERE (schemaname = 'public' AND tablename = ANY($1::text[]))
       OR (schemaname || '.' || tablename = ANY($1::text[]))
    ORDER BY schemaname, tablename, indexname
    `,
    [config.tables],
  );

  const constraints = await pool.query<ConstraintRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype::text AS constraint_type,
      pg_get_constraintdef(con.oid, true) AS constraint_def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE (${tableFilterSql('n')})
    ORDER BY n.nspname, c.relname, con.conname
    `,
    [config.tables],
  );

  const triggers = await pool.query<TriggerRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      t.tgname AS trigger_name,
      t.tgenabled::text AS enabled,
      CASE
        WHEN (t.tgtype & 2) = 2 THEN 'BEFORE'
        WHEN (t.tgtype & 64) = 64 THEN 'INSTEAD OF'
        ELSE 'AFTER'
      END AS timing,
      ARRAY_REMOVE(ARRAY[
        CASE WHEN (t.tgtype & 4) = 4 THEN 'INSERT' END,
        CASE WHEN (t.tgtype & 8) = 8 THEN 'DELETE' END,
        CASE WHEN (t.tgtype & 16) = 16 THEN 'UPDATE' END,
        CASE WHEN (t.tgtype & 32) = 32 THEN 'TRUNCATE' END
      ], NULL)::text[] AS events,
      p.proname AS function_name,
      pg_get_triggerdef(t.oid, true) AS definition,
      CASE WHEN $2::boolean THEN pg_get_functiondef(p.oid) ELSE NULL END AS function_source
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE NOT t.tgisinternal
      AND (${tableFilterSql('n')})
    ORDER BY n.nspname, c.relname, t.tgname
    `,
    [config.tables, config.includeFunctions],
  );

  const partitions = await pool.query<PartitionRow>(
    `
    SELECT
      pn.nspname AS parent_schema,
      pc.relname AS parent_table,
      cn.nspname AS child_schema,
      cc.relname AS child_table
    FROM pg_inherits i
    JOIN pg_class pc ON pc.oid = i.inhparent
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace
    JOIN pg_class cc ON cc.oid = i.inhrelid
    JOIN pg_namespace cn ON cn.oid = cc.relnamespace
    WHERE (pn.nspname = 'public' AND pc.relname = ANY($1::text[]))
       OR (pn.nspname || '.' || pc.relname = ANY($1::text[]))
    ORDER BY pn.nspname, pc.relname, cn.nspname, cc.relname
    `,
    [config.tables],
  );

  const timescaleAvailable = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('timescaledb_information.hypertables') IS NOT NULL AS exists`,
  );
  let timescaleHypertables = { rows: [] as TimescaleRow[] };
  if (timescaleAvailable.rows[0]?.exists) {
    const columns = await pool.query<{ column_name: string }>(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'timescaledb_information'
        AND table_name = 'hypertables'
      `,
    );
    const columnNames = new Set(columns.rows.map((row) => row.column_name));
    const schemaColumn = columnNames.has('hypertable_schema') ? 'hypertable_schema' : 'schema_name';
    const tableColumn = columnNames.has('hypertable_name') ? 'hypertable_name' : 'table_name';
    const compressionExpr = columnNames.has('compression_enabled')
      ? 'compression_enabled'
      : columnNames.has('compression_state')
        ? 'compression_state IS NOT NULL'
        : 'NULL::boolean';
    timescaleHypertables = await pool.query<TimescaleRow>(
      `
      SELECT
        ${schemaColumn} AS hypertable_schema,
        ${tableColumn} AS hypertable_name,
        ${compressionExpr} AS compression_enabled
      FROM timescaledb_information.hypertables
      WHERE ${schemaColumn} = 'public'
        AND ${tableColumn} = ANY($1::text[])
      ORDER BY ${schemaColumn}, ${tableColumn}
      `,
      [config.tables],
    );
  }

  const pgbossTables = await primaryPool.query<TableRow>(
    `
    SELECT
      n.nspname AS schema_name,
      c.relname AS table_name,
      c.relkind::text AS relkind,
      c.reltuples::bigint AS row_estimate,
      pg_total_relation_size(c.oid)::text AS bytes,
      c.relkind = 'p' AS partitioned
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'pgboss'
      AND c.relname IN ('job', 'archive')
      AND c.relkind IN ('r', 'p')
    ORDER BY n.nspname, c.relname
    `,
  );

  const primaryAuthIndexes = await primaryPool.query<IndexRow>(
    `
    SELECT
      schemaname AS schema_name,
      tablename AS table_name,
      indexname AS index_name,
      indexdef AS index_def
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename IN ('project_api_keys', 'organization_subscriptions', 'project_api_key_rotations')
      AND indexname IN (
        'idx_project_api_keys_public_key',
        'uq_project_api_keys_public_key',
        'idx_org_subscriptions_live_latest',
        'idx_project_api_key_rotations_grace_lookup'
      )
    ORDER BY schemaname, tablename, indexname
    `,
  );

  const pgbossQueueTable = await primaryPool.query<{ exists: boolean }>(
    `SELECT to_regclass('pgboss.queue') IS NOT NULL AS exists`,
  );
  let pgbossQueues = { rows: [] as QueueRow[] };
  if (pgbossQueueTable.rows[0]?.exists) {
    pgbossQueues = await primaryPool.query<QueueRow>(
      `
      SELECT
        name,
        policy,
        partition,
        table_name,
        notify,
        queued_count,
        ready_count,
        deferred_count,
        active_count,
        failed_count,
        total_count
      FROM pgboss.queue
      WHERE name LIKE 'ingest.%'
      ORDER BY name
      `,
    );
  }

  const { capabilities, statsResetAt } = await collectCapabilities(pool);
  const auditTables = unqualifiedTables(config.tables);

  // Each Phase 2 section degrades independently: a restricted or missing
  // statistics view must not void the catalog definitions the audit already read.
  let indexUsage: IndexUsageRow[] = [];
  try {
    indexUsage = await collectIndexUsage(pool, auditTables, capabilities);
  } catch (err) {
    capabilities.collectionErrors.indexUsage = errorMessage(err);
  }

  let partitionIndexRollup: PartitionIndexRow[] = [];
  try {
    partitionIndexRollup = await collectPartitionIndexRollup(pool, auditTables);
  } catch (err) {
    capabilities.collectionErrors.partitionIndexRollup = errorMessage(err);
  }

  let tableStorage: TableStorageRow[] = [];
  try {
    tableStorage = await collectTableStorage(pool, auditTables, statsResetAt);
  } catch (err) {
    capabilities.collectionErrors.tableStorage = errorMessage(err);
  }

  let toastRelations: ToastRow[] = [];
  try {
    toastRelations = await collectToastRelations(pool, auditTables);
  } catch (err) {
    capabilities.collectionErrors.toastRelations = errorMessage(err);
  }

  let autovacuumSettings: ReloptionRow[] = [];
  try {
    autovacuumSettings = await collectAutovacuumSettings(pool, auditTables);
  } catch (err) {
    capabilities.collectionErrors.autovacuumSettings = errorMessage(err);
  }

  // Both sections below are derived from readings this run already produced, so
  // the confirmation and the definitions it is compared against share one
  // catalog timestamp.
  const glossaryGuardIndexes = resolveGlossaryGuardIndexes(
    auditTables,
    tables.rows,
    indexes.rows,
    indexUsage,
  );
  const priorPhaseIndexRemovals = resolvePriorPhaseIndexRemovals(
    auditTables,
    tables.rows,
    indexes.rows,
  );

  return {
    generatedAt: new Date().toISOString(),
    logDatabase: database.rows[0]?.current_database ?? '',
    primaryDatabase: primaryDatabase.rows[0]?.current_database ?? '',
    tablesRequested: config.tables,
    tables: tables.rows,
    indexes: indexes.rows,
    constraints: constraints.rows,
    triggers: triggers.rows,
    partitions: partitions.rows,
    timescaleHypertables: timescaleHypertables.rows,
    primaryAuthIndexes: primaryAuthIndexes.rows,
    pgbossTables: pgbossTables.rows,
    pgbossQueues: pgbossQueues.rows,
    statsResetAt,
    catalogCapabilities: capabilities,
    indexUsage,
    partitionIndexRollup,
    tableStorage,
    toastRelations,
    autovacuumSettings,
    glossaryGuardIndexes,
    priorPhaseIndexRemovals,
  };
}

async function main(): Promise<void> {
  const config = parseArgs();
  try {
    const audit = await collectAudit(config);
    const output = config.format === 'json'
      ? `${JSON.stringify(audit, null, 2)}\n`
      : renderMarkdown(audit);
    if (config.outPath) await writeFile(config.outPath, output, 'utf8');
    process.stdout.write(output);
  } finally {
    await logDB.close().catch(() => undefined);
    await closeDatabase().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
