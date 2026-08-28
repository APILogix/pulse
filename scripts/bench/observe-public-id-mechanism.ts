/**
 * Read-only observation of the public-ID generation mechanism on a target
 * database (spec §15: "verify whether the implementation is DEFAULT
 * nextval(...), trigger, trigger + sequence, application-generated ID, or
 * other mechanism. Document the actual implementation.").
 *
 * This script NEVER creates, drops, or alters anything. It queries
 * information_schema/pg_catalog and reports what it finds. It works against
 * any reachable target — production, staging, or an isolated benchmark
 * branch — because reading catalog metadata carries no destructive risk and
 * is not gated by the benchmark environment allowlist.
 *
 * Usage:
 *   npx tsx scripts/bench/observe-public-id-mechanism.ts --db-url <log-db-url>
 */
import { Pool } from 'pg';

const TYPED_TABLES = [
  'events_errors', 'events_messages', 'events_requests', 'events_spans',
  'events_traces', 'events_metrics', 'events_logs', 'events_profiles',
  'events_cron_checkins', 'events_replays',
];

interface ColumnDefaultRow {
  table_name: string;
  column_default: string | null;
}

interface TriggerRow {
  event_object_table: string;
  trigger_name: string;
  action_timing: string;
  event_manipulation: string;
}

interface SequenceOwnershipRow {
  sequence_name: string;
  owned_by_table: string | null;
  owned_by_column: string | null;
}

function usage(): void {
  console.error('Usage: npx tsx scripts/bench/observe-public-id-mechanism.ts --db-url <log-db-url>');
  process.exit(2);
}

async function main(): Promise<void> {
  const args: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    if (process.argv[i] === '--db-url') args.dbUrl = process.argv[i + 1] ?? '';
  }
  const dbUrl = args.dbUrl || process.env.LOG_DATABASE_URL || '';
  if (!dbUrl) usage();

  const pool = new Pool({ connectionString: dbUrl, max: 1, application_name: 'pulse_ingestion_bench_public_id_observer' });
  try {
    const defaults = await pool.query<ColumnDefaultRow>(
      `SELECT table_name, column_default
       FROM information_schema.columns
       WHERE table_name = ANY($1) AND column_name = 'public_id'`,
      [TYPED_TABLES],
    );

    const triggers = await pool.query<TriggerRow>(
      `SELECT event_object_table, trigger_name, action_timing, event_manipulation
       FROM information_schema.triggers
       WHERE event_object_table = ANY($1)
       ORDER BY event_object_table, trigger_name, event_manipulation`,
      [TYPED_TABLES],
    );

    const sequences = await pool.query<SequenceOwnershipRow>(
      `SELECT
         c.relname AS sequence_name,
         owner_table.relname AS owned_by_table,
         a.attname AS owned_by_column
       FROM pg_class c
       LEFT JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
       LEFT JOIN pg_class owner_table ON owner_table.oid = d.refobjid
       LEFT JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
       WHERE c.relkind = 'S' AND c.relname LIKE '%public_id%'`,
    );

    const report = {
      classification: 'READ-ONLY OBSERVATION — no schema was modified',
      generatedAt: new Date().toISOString(),
      perTable: TYPED_TABLES.map((table) => {
        const defaultRow = defaults.rows.find((r) => r.table_name === table);
        const tableTriggers = triggers.rows.filter((r) => r.event_object_table === table);
        const ownedSequence = sequences.rows.find((r) => r.owned_by_table === table);
        const mechanism: string[] = [];
        if (defaultRow?.column_default?.includes('nextval')) mechanism.push('DEFAULT nextval(...)');
        if (tableTriggers.length > 0) mechanism.push(`trigger(s): ${tableTriggers.map((t) => `${t.trigger_name} (${t.action_timing} ${t.event_manipulation})`).join(', ')}`);
        if (ownedSequence) mechanism.push(`sequence OWNED BY ${ownedSequence.owned_by_table}.${ownedSequence.owned_by_column}`);
        if (mechanism.length === 0) mechanism.push('none detected — likely application-generated ID or a mechanism this query did not capture');
        return {
          table,
          columnDefault: defaultRow?.column_default ?? null,
          triggers: tableTriggers,
          sequenceOwnedByThisColumn: Boolean(ownedSequence),
          observedMechanism: mechanism,
        };
      }),
      allSequencesNamedPublicId: sequences.rows,
    };

    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
