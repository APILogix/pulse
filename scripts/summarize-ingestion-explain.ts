/**
 * Summarize scripts/explain-ingestion-writes.ts output for the Database Report.
 */
import { readFile, writeFile } from 'fs/promises';

type OutputFormat = 'markdown' | 'json';

interface CapturedPlan {
  label?: string;
  statement?: string;
  valueCount?: number;
  plan?: unknown;
}

interface ExplainRun {
  type?: string;
  batchSize?: number;
  tenants?: number;
  analyze?: boolean;
  wal?: boolean;
  committed?: boolean;
  plans?: CapturedPlan[];
}

interface SummaryConfig {
  explainPath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface PlanSummary {
  label: string;
  valueCount: number | null;
  planningMs: number | null;
  executionMs: number | null;
  rootNode: string | null;
  rootActualRows: number | null;
  rootPlanRows: number | null;
  sharedHitBlocks: number | null;
  sharedReadBlocks: number | null;
  sharedDirtiedBlocks: number | null;
  tempReadBlocks: number | null;
  tempWrittenBlocks: number | null;
  walRecords: number | null;
  walFpi: number | null;
  walBytes: number | null;
  triggerCalls: number | null;
  triggerMs: number | null;
  statement: string | null;
}

interface ExplainSummaryOutput {
  run: {
    type: string | null;
    batchSize: number | null;
    tenants: number | null;
    analyze: boolean | null;
    wal: boolean | null;
    committed: boolean | null;
  };
  rows: PlanSummary[];
  findings: string[];
}

function usage(): void {
  console.error(`Usage:
  npm run explain:ingestion:summary -- --explain explain.json [--format markdown|json] [--out report.md]
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

  const explainPath = args.explain;
  if (typeof explainPath !== 'string') usage();
  if (typeof explainPath !== 'string') process.exit(2);
  return {
    explainPath,
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

async function readExplain(path: string): Promise<ExplainRun> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as ExplainRun;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.plans)) {
    throw new Error(`${path} does not contain explain:ingestion output`);
  }
  return parsed;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function firstExplainEntry(raw: unknown): Record<string, unknown> | null {
  if (Array.isArray(raw)) return object(raw[0]);
  return object(raw);
}

function sumNumbers(values: Array<number | null>): number | null {
  let total = 0;
  let seen = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    seen = true;
  }
  return seen ? total : null;
}

function collectPlanNumbers(plan: Record<string, unknown> | null, field: string): number | null {
  if (!plan) return null;
  const values = [numberValue(plan[field])];
  const children = Array.isArray(plan.Plans) ? plan.Plans : [];
  for (const child of children) {
    values.push(collectPlanNumbers(object(child), field));
  }
  return sumNumbers(values);
}

function triggerRows(entry: Record<string, unknown> | null): Record<string, unknown>[] {
  const rawTriggers = entry?.Triggers;
  if (!Array.isArray(rawTriggers)) return [];
  return rawTriggers
    .map(object)
    .filter((trigger): trigger is Record<string, unknown> => trigger !== null);
}

function summarizePlan(plan: CapturedPlan): PlanSummary {
  const entry = firstExplainEntry(plan.plan);
  const rootPlan = object(entry?.Plan);
  const triggers = triggerRows(entry);
  return {
    label: plan.label ?? 'unknown',
    valueCount: numberValue(plan.valueCount),
    planningMs: numberValue(entry?.['Planning Time']),
    executionMs: numberValue(entry?.['Execution Time']),
    rootNode: typeof rootPlan?.['Node Type'] === 'string' ? rootPlan['Node Type'] : null,
    rootActualRows: numberValue(rootPlan?.['Actual Rows']),
    rootPlanRows: numberValue(rootPlan?.['Plan Rows']),
    sharedHitBlocks: collectPlanNumbers(rootPlan, 'Shared Hit Blocks'),
    sharedReadBlocks: collectPlanNumbers(rootPlan, 'Shared Read Blocks'),
    sharedDirtiedBlocks: collectPlanNumbers(rootPlan, 'Shared Dirtied Blocks'),
    tempReadBlocks: collectPlanNumbers(rootPlan, 'Temp Read Blocks'),
    tempWrittenBlocks: collectPlanNumbers(rootPlan, 'Temp Written Blocks'),
    walRecords: collectPlanNumbers(rootPlan, 'WAL Records'),
    walFpi: collectPlanNumbers(rootPlan, 'WAL FPI'),
    walBytes: collectPlanNumbers(rootPlan, 'WAL Bytes'),
    triggerCalls: sumNumbers(triggers.map((trigger) => numberValue(trigger.Calls))),
    triggerMs: sumNumbers(triggers.map((trigger) => numberValue(trigger.Time))),
    statement: plan.statement ?? null,
  };
}

function summarize(run: ExplainRun): PlanSummary[] {
  return (run.plans ?? []).map(summarizePlan);
}

function rowText(row: PlanSummary): string {
  return `${row.label} ${row.statement ?? ''}`;
}

function isTypedEventInsert(row: PlanSummary): boolean {
  const text = rowText(row);
  return /\bevents_(errors|requests|messages|spans|traces|metrics|logs|profiles|cron_checkins|replays)\b/.test(text);
}

function findingsFor(rows: PlanSummary[]): string[] {
  const findings: string[] = [];
  const missingWal = rows
    .filter((row) => row.walRecords === null && row.walFpi === null && row.walBytes === null)
    .map((row) => row.label);
  if (missingWal.length > 0) {
    findings.push(`Missing WAL counters for ${missingWal.length} captured statement(s): ${missingWal.slice(0, 8).join(', ')}${missingWal.length > 8 ? ', ...' : ''}.`);
  }

  const typedWithoutTriggers = rows
    .filter((row) => isTypedEventInsert(row) && (row.triggerCalls === null || row.triggerMs === null))
    .map((row) => row.label);
  if (typedWithoutTriggers.length > 0) {
    findings.push(`Missing trigger call/time data for ${typedWithoutTriggers.length} typed event insert statement(s): ${typedWithoutTriggers.slice(0, 8).join(', ')}${typedWithoutTriggers.length > 8 ? ', ...' : ''}.`);
  }

  if (findings.length === 0) {
    findings.push('All captured statements include WAL counters, and typed event inserts include trigger call/time data.');
  }
  return findings;
}

function outputFor(run: ExplainRun, rows: PlanSummary[]): ExplainSummaryOutput {
  return {
    run: {
      type: run.type ?? null,
      batchSize: run.batchSize ?? null,
      tenants: run.tenants ?? null,
      analyze: run.analyze ?? null,
      wal: run.wal ?? null,
      committed: run.committed ?? null,
    },
    rows,
    findings: findingsFor(rows),
  };
}

function renderValue(value: number | string | null): string {
  if (value === null) return '';
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);
  return value.replace(/\|/g, '\\|');
}

function renderMarkdown(run: ExplainRun, rows: PlanSummary[]): string {
  const findings = findingsFor(rows);
  const header = [
    '# Ingestion EXPLAIN Summary',
    '',
    `Type: ${run.type ?? ''}`,
    `Batch size: ${run.batchSize ?? ''}`,
    `Tenants: ${run.tenants ?? ''}`,
    `Analyze: ${run.analyze ?? ''}`,
    `WAL: ${run.wal ?? ''}`,
    `Committed: ${run.committed ?? ''}`,
    '',
    '| Statement | Values | Plan node | Actual rows | Plan rows | Planning ms | Execution ms | Trigger calls | Trigger ms | WAL records | WAL FPI | WAL bytes | Shared hit | Shared read | Shared dirtied | Temp read | Temp written |',
    '| --- | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  const body = rows.map((row) => [
    row.label,
    row.valueCount,
    row.rootNode,
    row.rootActualRows,
    row.rootPlanRows,
    row.planningMs,
    row.executionMs,
    row.triggerCalls,
    row.triggerMs,
    row.walRecords,
    row.walFpi,
    row.walBytes,
    row.sharedHitBlocks,
    row.sharedReadBlocks,
    row.sharedDirtiedBlocks,
    row.tempReadBlocks,
    row.tempWrittenBlocks,
  ].map(renderValue).join(' | ')).map((line) => `| ${line} |`);
  return [
    ...header,
    ...body,
    '',
    '## Findings',
    '',
    ...findings.map((finding) => `- ${finding}`),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const run = await readExplain(config.explainPath);
  const rows = summarize(run);
  const output = config.format === 'json'
    ? `${JSON.stringify(outputFor(run, rows), null, 2)}\n`
    : renderMarkdown(run, rows);
  if (config.outPath) await writeFile(config.outPath, output, 'utf8');
  process.stdout.write(output);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
