/**
 * Index/trigger A/B benchmark scaffolding (spec §15-17).
 *
 * THIS SCRIPT HAS NOT BEEN EXECUTED IN THIS SESSION. No isolated Neon branch
 * was available (see docs/ingestionv2/benchmark/09-index-trigger-impact.md).
 * It is committed as ready-to-run scaffolding for whenever one exists.
 *
 * What this does when run:
 *   1. Refuses to proceed unless --confirm-isolated-schema is passed AND the
 *      target's `current_database()` is NOT one of the known production/
 *      staging database names (belt-and-suspenders on top of the operator's
 *      own responsibility to point this at a real isolated clone/branch).
 *   2. Captures BASELINE SCHEMA state (current indexes/triggers on the
 *      typed tables) via pg_indexes/information_schema.triggers.
 *   3. Runs the direct-DB writer microbenchmark
 *      (scripts/bench-ingestion-worker.ts --mode writer, rollback-only by
 *      default) against variant A (current schema, unmodified).
 *   4. Applies a candidate OPTIMIZED SCHEMA VARIANT from
 *      scripts/bench/schema-variants/ (each variant is a plain .sql file
 *      pair: <name>.up.sql / <name>.down.sql, reviewed and versioned like any
 *      other migration — this script does not invent DDL, it only applies a
 *      pre-written, human-reviewed file).
 *   5. Re-runs the same writer microbenchmark against variant B.
 *   6. Reverts variant B's DDL via its .down.sql.
 *   7. Reports INSERT/COMMIT latency, throughput, storage, and WAL deltas
 *      side by side. Recommends removal ONLY if the benchmark shows a
 *      material write-side improvement AND a separate query-usage analysis
 *      (not performed by this script) confirms the index/trigger is not
 *      relied on by read paths.
 *
 * This script NEVER modifies a production database: step 1's gate is a hard
 * precondition, not a warning.
 */
import { spawnSync } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VARIANTS_DIR = join(__dirname, 'schema-variants');

const KNOWN_NON_ISOLATED_DB_NAME_PATTERNS = [/prod/i, /production/i, /^neondb$/i];

interface CliOptions {
  dbUrl: string;
  variant: string;
  confirmIsolatedSchema: boolean;
  benchArgs: string[];
}

function usage(): void {
  console.error(`Usage:
  npx tsx scripts/bench/index-trigger-ab.ts --db-url <isolated-target-url> --variant <name> \\
    --confirm-isolated-schema [-- <extra args passed to bench-ingestion-worker.ts>]

Variants are read from scripts/bench/schema-variants/<name>.up.sql and .down.sql.
Nothing runs without --confirm-isolated-schema, and the script additionally refuses
any target whose current_database() name looks like a production database name.
`);
  process.exit(2);
}

function parseArgs(): CliOptions {
  const argv = process.argv.slice(2);
  const dashDashIndex = argv.indexOf('--');
  const ownArgs = dashDashIndex >= 0 ? argv.slice(0, dashDashIndex) : argv;
  const benchArgs = dashDashIndex >= 0 ? argv.slice(dashDashIndex + 1) : [];

  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < ownArgs.length; i += 1) {
    const arg = ownArgs[i];
    if (!arg?.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = ownArgs[i + 1];
    if (!value || value.startsWith('--')) args[key] = true;
    else {
      args[key] = value;
      i += 1;
    }
  }
  if (args.help === true) usage();
  const dbUrl = typeof args['db-url'] === 'string' ? args['db-url'] : '';
  const variant = typeof args.variant === 'string' ? args.variant : '';
  if (!dbUrl || !variant) usage();
  return {
    dbUrl,
    variant,
    confirmIsolatedSchema: args['confirm-isolated-schema'] === true,
    benchArgs,
  };
}

async function assertIsolatedTarget(pool: Pool, confirmed: boolean): Promise<void> {
  if (!confirmed) {
    throw new Error(
      'Refusing to run without --confirm-isolated-schema. This script applies and reverts DDL; ' +
        'it must only ever run against an isolated benchmark schema (e.g. a dedicated Neon branch), never ' +
        'a shared staging or production database.',
    );
  }
  const result = await pool.query<{ current_database: string }>('SELECT current_database()');
  const dbName = result.rows[0]?.current_database ?? '';
  if (KNOWN_NON_ISOLATED_DB_NAME_PATTERNS.some((pattern) => pattern.test(dbName))) {
    throw new Error(
      `Refusing to run: current_database() = "${dbName}" matches a known production-looking name pattern. ` +
        'Point --db-url at an isolated benchmark schema/branch with a distinct name.',
    );
  }
}

async function captureBaselineState(pool: Pool): Promise<unknown> {
  const indexes = await pool.query(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename LIKE 'events_%' ORDER BY tablename, indexname`);
  const triggers = await pool.query(`SELECT event_object_table, trigger_name, action_timing, event_manipulation FROM information_schema.triggers WHERE event_object_table LIKE 'events_%' ORDER BY event_object_table, trigger_name`);
  return { indexes: indexes.rows, triggers: triggers.rows };
}

function runWriterBenchmark(dbUrl: string, extraArgs: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const result = spawnSync('npx', ['tsx', 'scripts/bench-ingestion-worker.ts', '--mode', 'writer', ...extraArgs], {
    cwd: join(__dirname, '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: dbUrl, LOG_DATABASE_URL: dbUrl },
    shell: true,
    windowsHide: true,
  });
  return { exitCode: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const pool = new Pool({ connectionString: opts.dbUrl, max: 2, application_name: 'pulse_ingestion_bench_index_trigger_ab' });

  try {
    await assertIsolatedTarget(pool, opts.confirmIsolatedSchema);

    const upPath = join(VARIANTS_DIR, `${opts.variant}.up.sql`);
    const downPath = join(VARIANTS_DIR, `${opts.variant}.down.sql`);
    const upSql = await readFile(upPath, 'utf8').catch(() => {
      throw new Error(`Variant file not found: ${upPath}. Add a reviewed .up.sql/.down.sql pair under scripts/bench/schema-variants/ first.`);
    });
    const downSql = await readFile(downPath, 'utf8');

    const baselineState = await captureBaselineState(pool);
    console.error('Captured baseline (variant A) schema state.');

    console.error('Running writer microbenchmark against variant A (current schema)...');
    const variantAResult = runWriterBenchmark(opts.dbUrl, opts.benchArgs);

    console.error(`Applying variant B DDL from ${upPath}...`);
    await pool.query(upSql);

    console.error('Running writer microbenchmark against variant B (candidate schema)...');
    const variantBResult = runWriterBenchmark(opts.dbUrl, opts.benchArgs);

    console.error(`Reverting variant B via ${downPath}...`);
    await pool.query(downSql);

    const afterRevertState = await captureBaselineState(pool);

    const report = {
      classification: 'ISOLATED-SCHEMA INDEX/TRIGGER A/B MICROBENCHMARK — never touches production',
      variant: opts.variant,
      baselineState,
      afterRevertState,
      variantA: variantAResult,
      variantB: variantBResult,
      recommendation:
        'Do not remove any index/trigger from production based on this report alone. Combine with a ' +
        'bounded pg_stat_user_indexes usage-window analysis and explicit query-plan review before any ' +
        'production DDL is proposed.',
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
