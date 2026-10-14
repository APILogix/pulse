/**
 * The catalog scope of the ingestion write-path forensics (Phase 2).
 *
 * Three lists live here, and they live here rather than inside a harness
 * because more than one harness needs each of them and a second copy is how
 * two harnesses come to disagree about what the schema actually is:
 *
 *  1. `INGESTION_TABLE_SET` — the relations every catalog reading covers
 *     (Requirement 4.1). Previously `defaultTables` in
 *     `scripts/audit-ingestion-db-schema.ts`, which omitted
 *     `error_group_history`.
 *
 *  2. `GLOSSARY_GUARD_INDEXES` — the resolution of the glossary term
 *     `events_errors_idempotency`. The glossary lists it inside the
 *     Ingestion_Table_Set as though it were a table; no such relation exists.
 *     It is the unique guard index `idx_events_errors_event_unique` on
 *     `events_errors`, so the term is recorded against a real object with its
 *     origin noted instead of being audited as a missing table.
 *
 *  3. `PRIOR_PHASE_INDEX_REMOVALS` — every index name dropped by the three
 *     prior-phase hot-path migrations (Requirement 4.11). This is the single
 *     source of truth: `scripts/validate-ingestion-evidence-bundle.ts` derives
 *     its `events_requests` forbidden-index check from it, and the audit script
 *     emits a prior-phase `REMOVE` disposition per entry, so the two cannot
 *     drift.
 *
 * Nothing here touches the database, the filesystem, the clock or
 * `process.env`. Every value is transcribed from a migration file under
 * `database/migrations/logdb/`, and the transcription is verifiable by reading
 * the file named on each entry.
 *
 * Design references: §1.3 (catalog audit extension), §4.1 (disposition state
 * machine and prior-phase dispositions).
 */

// ── Ingestion_Table_Set (Requirement 4.1) ───────────────────────────────────

/** The ten Signal_Type destination tables. */
export const CANONICAL_EVENT_TABLES = [
  'events_requests',
  'events_errors',
  'events_logs',
  'events_metrics',
  'events_spans',
  'events_traces',
  'events_messages',
  'events_profiles',
  'events_replays',
  'events_cron_checkins',
] as const;

export type CanonicalEventTable = (typeof CANONICAL_EVENT_TABLES)[number];

/**
 * The non-canonical members of the Ingestion_Table_Set.
 *
 * `error_group_history` was missing from the audit's previous table list, which
 * left the `error_group_history` inserts issued by `upsertGroupsBatch` outside
 * every storage, index and autovacuum reading.
 *
 * `ingestion_dead_letter_jobs` is named by the glossary and by design §1.3, but
 * `02_ingestion/001_ingestion_runtime.up.sql` records it as control-plane
 * resident and deliberately not duplicated into the Log_DB. A Log_DB catalog
 * reading returning no row for it is therefore an expected outcome, not a
 * collection failure — it is requested so the reading proves the absence rather
 * than leaving it unasked.
 */
export const AUXILIARY_INGESTION_TABLES = [
  'error_groups',
  'error_group_history',
  'analytics_error_groups',
  'telemetry_outbox',
  'alert_runtime_idempotency_keys',
  'ingestion_dead_letter_jobs',
] as const;

/**
 * Every relation a Phase 2 catalog reading covers. The glossary also lists
 * `events_errors_idempotency` here; it is an index rather than a relation and is
 * recorded through `GLOSSARY_GUARD_INDEXES` instead.
 */
export const INGESTION_TABLE_SET: readonly string[] = [
  ...CANONICAL_EVENT_TABLES,
  ...AUXILIARY_INGESTION_TABLES,
];

// ── Glossary guard-index resolution ─────────────────────────────────────────

export interface GuardIndexResolution {
  /** The glossary term this entry resolves. */
  glossaryTerm: string;
  /** The relation the index is actually defined on. */
  table: string;
  /** The real index name in the Log_DB catalog. */
  indexName: string;
  /** Relative path of the migration file that creates it. */
  originMigrationFile: string;
  /** Indexed columns in declared order. */
  columns: readonly string[];
  /**
   * Requirement 4.4 values this index serves. Requirement 4.9 forbids `REMOVE`
   * and `MOVE_TO_DERIVED` on any entry recording either of these.
   */
  requirements: readonly ('uniqueness enforcement' | 'idempotency')[];
  /** Why the glossary term does not name a relation. */
  originNote: string;
}

export const GLOSSARY_GUARD_INDEXES: readonly GuardIndexResolution[] = [
  {
    glossaryTerm: 'events_errors_idempotency',
    table: 'events_errors',
    indexName: 'idx_events_errors_event_unique',
    originMigrationFile: '03_observability_v2/018_events_errors_idempotency.sql',
    columns: ['organization_id', 'event_id', 'occurred_at'],
    requirements: ['uniqueness enforcement', 'idempotency'],
    originNote:
      'The glossary lists events_errors_idempotency inside the Ingestion_Table_Set, but no such relation exists. '
      + '018_events_errors_idempotency.sql creates a UNIQUE INDEX named idx_events_errors_event_unique on '
      + 'events_errors (organization_id, event_id, occurred_at), which is the ON CONFLICT arbiter for error '
      + 'ingestion idempotency. The term is recorded against that index so it resolves to a real object.',
  },
];

// ── Prior-phase index removals (Requirement 4.11) ───────────────────────────

/** Relative paths of the three prior-phase hot-path migrations. */
export const PRIOR_PHASE_MIGRATION_FILES = [
  '03_observability_v2/025_request_ingestion_hot_path.sql',
  '03_observability_v2/028_request_ingestion_minimal_indexes.sql',
  '03_observability_v2/029_span_log_ingestion_hot_path.sql',
] as const;

export type PriorPhaseMigrationFile = (typeof PRIOR_PHASE_MIGRATION_FILES)[number];

export interface PriorPhaseIndexRemoval {
  /** The table the index was defined on. */
  table: string;
  /** The dropped index name, transcribed verbatim from the migration file. */
  indexName: string;
  /** Relative path of the migration file that dropped it. */
  migrationFile: PriorPhaseMigrationFile;
}

/**
 * Every index name dropped by `025`, `028` and `029`, in migration-file order
 * and, within a file, in statement order.
 *
 * Count note: older design §4.1 wording says "eighteen index names". The
 * current task contract follows the migration files and specifies all 24
 * `DROP INDEX IF EXISTS` statements — 4 in `025`, 10 in `028`, and 10 in
 * `029` — while retaining the 14-name request-specific subset. Requirement
 * 4.11 names all three files, so all 24 are recorded here. The pre-existing
 * `forbiddenRequestHotPathIndexes` list in
 * `scripts/validate-ingestion-evidence-bundle.ts` carried 14 of them: it is an
 * `events_requests`-scoped check, so it covers `025` and `028` and omits the
 * `events_spans` and `events_logs` names from `029`. That list is now derived
 * from this one via `priorPhaseRemovedIndexNames('events_requests')`, which
 * reproduces the same 14 names.
 */
export const PRIOR_PHASE_INDEX_REMOVALS: readonly PriorPhaseIndexRemoval[] = [
  // 025_request_ingestion_hot_path.sql — broad JSONB GIN indexes off the
  // synchronous request insert path.
  { table: 'events_requests', indexName: 'idx_events_requests_payload_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[0] },
  { table: 'events_requests', indexName: 'idx_events_requests_ai_response_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[0] },
  { table: 'events_requests', indexName: 'idx_events_requests_metadata_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[0] },
  { table: 'events_requests', indexName: 'idx_events_requests_attributes_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[0] },

  // 028_request_ingestion_minimal_indexes.sql — high-cardinality dashboard and
  // convenience btree indexes, each one btree maintenance per inserted row.
  { table: 'events_requests', indexName: 'idx_events_requests_tenant_env_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_user_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_trace', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_service', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_endpoint_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_duration_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_geo_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_release_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_session_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },
  { table: 'events_requests', indexName: 'idx_events_requests_sdk_time', migrationFile: PRIOR_PHASE_MIGRATION_FILES[1] },

  // 029_span_log_ingestion_hot_path.sql — the span and log GIN sets.
  { table: 'events_spans', indexName: 'idx_events_spans_attributes_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_spans', indexName: 'idx_events_spans_metadata_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_spans', indexName: 'idx_events_spans_payload_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_spans', indexName: 'idx_events_spans_ai_response_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_context_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_tags_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_attributes_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_metadata_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_payload_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
  { table: 'events_logs', indexName: 'idx_events_logs_ai_response_gin', migrationFile: PRIOR_PHASE_MIGRATION_FILES[2] },
];

/**
 * The dropped index names, optionally scoped to one table. Callers that only
 * care about names read this rather than re-typing the list.
 */
export function priorPhaseRemovedIndexNames(table?: string): string[] {
  return PRIOR_PHASE_INDEX_REMOVALS
    .filter((removal) => table === undefined || removal.table === table)
    .map((removal) => removal.indexName);
}
