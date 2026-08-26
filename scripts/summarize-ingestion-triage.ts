/**
 * Combine admission, worker, and runtime DB summaries into one bottleneck view.
 */
import { readFile, writeFile } from 'fs/promises';

type OutputFormat = 'markdown' | 'json';

interface TriageConfig {
  admissionSummaryPath: string;
  workerSummaryPath: string;
  dbRuntimeSummaryPath: string;
  format: OutputFormat;
  outPath: string | null;
}

interface Section {
  title: string;
  lines: string[];
}

interface TriageSummary {
  generatedAt: string;
  inputs: {
    admissionSummary: string;
    workerSummary: string;
    dbRuntimeSummary: string;
  };
  admissionClassification: string[];
  workerClassification: string[];
  dbRuntimeFindings: string[];
  admissionFindings: string[];
  workerFindings: string[];
  nextProof: string[];
}

function usage(): void {
  console.error(`Usage:
  npm run ingestion:triage -- \\
    --admission-summary artifacts/ingestion-admission-summary.md \\
    --worker-summary artifacts/ingestion-worker-summary.md \\
    --db-runtime-summary artifacts/ingestion-db-runtime-summary.md \\
    [--format markdown|json] [--out artifacts/ingestion-triage-summary.md]
`);
  process.exit(2);
}

function parseArgs(): TriageConfig {
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

  const admissionSummaryPath = args['admission-summary'];
  const workerSummaryPath = args['worker-summary'];
  const dbRuntimeSummaryPath = args['db-runtime-summary'];
  if (
    typeof admissionSummaryPath !== 'string'
    || typeof workerSummaryPath !== 'string'
    || typeof dbRuntimeSummaryPath !== 'string'
  ) {
    usage();
  }
  if (
    typeof admissionSummaryPath !== 'string'
    || typeof workerSummaryPath !== 'string'
    || typeof dbRuntimeSummaryPath !== 'string'
  ) {
    process.exit(2);
  }

  return {
    admissionSummaryPath,
    workerSummaryPath,
    dbRuntimeSummaryPath,
    format: args.format === 'json' ? 'json' : 'markdown',
    outPath: typeof args.out === 'string' ? args.out : null,
  };
}

function parseSections(markdown: string): Map<string, Section> {
  const sections = new Map<string, Section>();
  let current: Section | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      current = { title: heading[1]!, lines: [] };
      sections.set(current.title, current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

function bulletLines(section: Section | undefined): string[] {
  if (!section) return [];
  return section.lines
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean);
}

function tableValue(markdown: string, metric: string): string | null {
  const escaped = metric.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|`);
  const match = pattern.exec(markdown);
  return match?.[1]?.trim() ?? null;
}

function hasText(lines: string[], pattern: RegExp): boolean {
  return lines.some((line) => pattern.test(line));
}

function buildNextProof(summary: {
  admissionClassification: string[];
  workerClassification: string[];
  dbRuntimeFindings: string[];
  admissionText: string;
  workerText: string;
  dbText: string;
}): string[] {
  const next: string[] = [];
  if (hasText(summary.admissionClassification, /Unlocalized primary pg-boss enqueue stall/i)) {
    next.push('Capture updated API ingestion_admission_profile logs that include enqueueQueues; current API evidence proves enqueue is slow but not which queue/table is responsible.');
  }
  if (hasText(summary.admissionClassification, /Queue-specific primary pg-boss enqueue stall|Shared primary DB enqueue pressure/i)) {
    next.push('Run ingestion:db:runtime during the same API enqueue window and compare primary pg-boss waits, locks, WAL sync per commit, cache hit rate, temp bytes, and relation/index growth.');
  }
  if (hasText(summary.workerClassification, /Log DB write path bottleneck|Transaction-bound worker latency/i)) {
    next.push('Run ingestion:db:runtime and explain:ingestion for the same committed request or mixed workload to separate Log DB locks, WAL/fsync, trigger time, relation growth, and index write amplification.');
  }
  if (hasText(summary.dbRuntimeFindings, /No positive Log DB insert delta|No positive events_requests insert delta/i)) {
    next.push('Rerun DB runtime diagnostics during an active committed request or mixed ingestion benchmark; the current runtime artifact is not tied to insert activity.');
  }
  if (hasText(summary.dbRuntimeFindings, /WAL sync|fsync|storage/i)) {
    next.push('Treat synchronous_commit or storage changes as a durability decision; benchmark candidate settings only in staging with crash-loss acceptance evidence.');
  }
  if (hasText(summary.dbRuntimeFindings, /lock/i)) {
    next.push('Inspect captured waiting query samples and lock rows before changing indexes, worker concurrency, or pg-boss queue settings.');
  }
  if ((tableValue(summary.workerText, 'DB connection wait p95 ms') ?? '').length > 0) {
    next.push('Compare DB connection wait metrics with worker configured slots and Log DB pool size before changing concurrency.');
  }
  if (next.length === 0) {
    next.push('No decisive cross-layer bottleneck is proven by these summaries; collect a committed processor benchmark, EXPLAIN WAL/trigger output, and runtime DB diagnostics for the same time window.');
  }
  return [...new Set(next)];
}

async function summarize(config: TriageConfig): Promise<TriageSummary> {
  const [admissionText, workerText, dbText] = await Promise.all([
    readFile(config.admissionSummaryPath, 'utf8'),
    readFile(config.workerSummaryPath, 'utf8'),
    readFile(config.dbRuntimeSummaryPath, 'utf8'),
  ]);
  const admissionSections = parseSections(admissionText);
  const workerSections = parseSections(workerText);
  const dbSections = parseSections(dbText);

  const admissionClassification = bulletLines(admissionSections.get('Diagnostic Classification'));
  const workerClassification = bulletLines(workerSections.get('Diagnostic Classification'));
  const dbRuntimeFindings = bulletLines(dbSections.get('Findings'));
  const admissionFindings = bulletLines(admissionSections.get('Findings'));
  const workerFindings = bulletLines(workerSections.get('Findings'));
  const nextProof = buildNextProof({
    admissionClassification,
    workerClassification,
    dbRuntimeFindings,
    admissionText,
    workerText,
    dbText,
  });

  return {
    generatedAt: new Date().toISOString(),
    inputs: {
      admissionSummary: config.admissionSummaryPath,
      workerSummary: config.workerSummaryPath,
      dbRuntimeSummary: config.dbRuntimeSummaryPath,
    },
    admissionClassification,
    workerClassification,
    dbRuntimeFindings,
    admissionFindings,
    workerFindings,
    nextProof,
  };
}

function renderBullets(lines: string[]): string[] {
  return lines.length > 0 ? lines.map((line) => `- ${line}`) : ['- None reported.'];
}

function renderMarkdown(summary: TriageSummary): string {
  return [
    '# Ingestion Bottleneck Triage Summary',
    '',
    `Generated at: ${summary.generatedAt}`,
    '',
    '## Inputs',
    '',
    `- Admission summary: ${summary.inputs.admissionSummary}`,
    `- Worker summary: ${summary.inputs.workerSummary}`,
    `- DB runtime summary: ${summary.inputs.dbRuntimeSummary}`,
    '',
    '## Admission Classification',
    '',
    ...renderBullets(summary.admissionClassification),
    '',
    '## Worker Classification',
    '',
    ...renderBullets(summary.workerClassification),
    '',
    '## DB Runtime Findings',
    '',
    ...renderBullets(summary.dbRuntimeFindings),
    '',
    '## Admission Findings',
    '',
    ...renderBullets(summary.admissionFindings),
    '',
    '## Worker Findings',
    '',
    ...renderBullets(summary.workerFindings),
    '',
    '## Next Proof Required',
    '',
    ...renderBullets(summary.nextProof),
    '',
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const summary = await summarize(config);
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
