/**
 * Run ingestion-focused validation commands and write the required Test Report.
 *
 * The generated Markdown is intended to be consumed by
 * scripts/validate-ingestion-evidence-bundle.ts. It records exact commands,
 * exit codes, and coverage mapping for unit, integration, load, failure,
 * duplicate, timestamp, and fairness evidence.
 */
import { spawnSync } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

type SectionStatus = 'passed' | 'failed' | 'not_run';

interface ReportConfig {
  outPath: string;
  runIntegration: boolean;
  loadCommand: string | null;
  scenarioEvidencePath: string | null;
}

interface CommandResult {
  command: string;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
}

interface ReportSection {
  key: string;
  title: string;
  purpose: string;
  status: SectionStatus;
  command: string;
  result: CommandResult | null;
  notes: string[];
  scenarios?: ScenarioEvidence[];
}

interface ScenarioEvidence {
  scenario: string;
  status: SectionStatus;
  evidence: string;
  command: string | null;
  artifact: string | null;
}

const focusedUnitTests = [
  'src/modules/ingestion/workers/metrics-server.test.ts',
  'src/modules/ingestion/workers/event-processor.test.ts',
  'src/modules/ingestion/workers/worker-registry.test.ts',
  'src/modules/ingestion/queue/ingest-queues.test.ts',
  'src/modules/ingestion/queue/pg-queue.test.ts',
  'src/modules/ingestion/queue/pg-queue-worker.test.ts',
  'src/modules/errors/repositories/error.repository.test.ts',
  'src/modules/errors/services/error-ingestion.service.test.ts',
  'test/unit/modules/ingestion-request-pipeline.test.ts',
  'test/unit/modules/ingestion.service.test.ts',
  'test/unit/telemetry-writer-traces.test.ts',
  'test/unit/telemetry-writer-outbox.test.ts',
  'test/unit/telemetry-environment-contract.test.ts',
];

const requiredFailureScenarios = [
  'PostgreSQL connection failure',
  'database timeout',
  'worker crash',
  'queue restart',
  'duplicate job delivery',
  'partial batch failure',
  'malformed timestamp',
  'malformed event',
  'huge event',
  'traffic burst',
  'one tenant flooding ingestion',
  'database overload',
  'connection pool exhaustion',
  'graceful shutdown',
];

function usage(): void {
  console.error(`Usage:
  npm run ingestion:test-report -- --out artifacts/ingestion-test-report.md \\
    [--skip-integration] \\
    [--load-command "npm run bench:ingestion:matrix -- --preset smoke --out artifacts/ingestion-smoke-matrix.json"] \\
    [--scenario-evidence artifacts/ingestion-failure-scenarios.json]

The final evidence validator rejects reports with "Status: not_run" or "Status: failed".
Provide --load-command when collecting final acceptance evidence in a benchmark environment.
Provide --scenario-evidence to prove chaos scenarios that cannot be established by the focused unit suite.
`);
  process.exit(2);
}

function parseArgs(): ReportConfig {
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
  if (typeof args.out !== 'string') usage();
  if (typeof args.out !== 'string') process.exit(2);

  return {
    outPath: args.out,
    runIntegration: args['skip-integration'] !== true,
    loadCommand: typeof args['load-command'] === 'string' ? args['load-command'] : null,
    scenarioEvidencePath: typeof args['scenario-evidence'] === 'string' ? args['scenario-evidence'] : null,
  };
}

function npmCommand(script: string, extraArgs: string[]): string {
  return ['npm', 'run', script, '--', ...extraArgs].join(' ');
}

function trimTail(value: string, maxLines = 80): string {
  const lines = value.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(Math.max(0, lines.length - maxLines)).join('\n').trim();
}

function runCommand(command: string): CommandResult {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    encoding: 'utf8',
    shell: true,
    windowsHide: true,
  });
  return {
    command,
    exitCode: typeof result.status === 'number' ? result.status : null,
    stdoutTail: trimTail(result.stdout ?? ''),
    stderrTail: trimTail(result.stderr ?? ''),
  };
}

function sectionFromCommand(input: Omit<ReportSection, 'status' | 'result'>): ReportSection {
  const result = runCommand(input.command);
  return {
    ...input,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    result,
  };
}

function renderCode(value: string): string {
  if (!value) return '_empty_';
  return `\n\`\`\`text\n${value.replace(/```/g, '` ` `')}\n\`\`\``;
}

function renderScenarioTable(scenarios: ScenarioEvidence[]): string[] {
  return [
    '',
    'Scenario coverage:',
    '',
    '| Scenario | Scenario status | Evidence | Command | Artifact |',
    '| --- | --- | --- | --- | --- |',
    ...scenarios.map((scenario) => `| ${[
      scenario.scenario,
      scenario.status,
      scenario.evidence,
      scenario.command ?? '',
      scenario.artifact ?? '',
    ].map((cell) => String(cell).replace(/\|/g, '\\|')).join(' | ')} |`),
  ];
}

function renderSection(section: ReportSection): string {
  const lines = [
    `## ${section.title}`,
    '',
    `Status: ${section.status}`,
    `Purpose: ${section.purpose}`,
    `Command: \`${section.command}\``,
    '',
    'Notes:',
    ...section.notes.map((note) => `- ${note}`),
  ];

  if (section.result) {
    lines.push(
      '',
      `Exit code: ${section.result.exitCode ?? 'unknown'}`,
      '',
      'Stdout tail:',
      renderCode(section.result.stdoutTail),
      '',
      'Stderr tail:',
      renderCode(section.result.stderrTail),
    );
  }
  if (section.scenarios) {
    lines.push(...renderScenarioTable(section.scenarios));
  }

  return `${lines.join('\n')}\n`;
}

function canonicalScenarioName(value: string): string {
  const normalized = value.trim().toLowerCase();
  return requiredFailureScenarios.find((scenario) => scenario.toLowerCase() === normalized) ?? value.trim();
}

function scenarioEvidenceObject(value: unknown): ScenarioEvidence | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.scenario !== 'string') return null;
  const status = item.status === 'passed' || item.status === 'failed' || item.status === 'not_run'
    ? item.status
    : 'failed';
  return {
    scenario: canonicalScenarioName(item.scenario),
    status,
    evidence: typeof item.evidence === 'string' && item.evidence.trim() ? item.evidence.trim() : 'external scenario evidence',
    command: typeof item.command === 'string' && item.command.trim() ? item.command.trim() : null,
    artifact: typeof item.artifact === 'string' && item.artifact.trim() ? item.artifact.trim() : null,
  };
}

async function readScenarioEvidence(path: string | null): Promise<Map<string, ScenarioEvidence>> {
  const evidence = new Map<string, ScenarioEvidence>();
  if (!path) return evidence;
  const parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
  const rawScenarios = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).scenarios)
      ? (parsed as Record<string, unknown>).scenarios as unknown[]
      : [];
  for (const rawScenario of rawScenarios) {
    const scenario = scenarioEvidenceObject(rawScenario);
    if (scenario && requiredFailureScenarios.includes(scenario.scenario)) {
      evidence.set(scenario.scenario, scenario);
    }
  }
  return evidence;
}

function buildFailureScenarios(sections: ReportSection[], externalEvidence: Map<string, ScenarioEvidence>): ScenarioEvidence[] {
  const unit = sections.find((section) => section.key === 'unit');
  const load = sections.find((section) => section.key === 'load');
  const unitStatus = unit?.status ?? 'not_run';
  const loadStatus = load?.status ?? 'not_run';
  const unitCommand = unit?.command ?? null;
  const loadCommand = load?.command ?? null;
  const unitCovered = new Map<string, string>([
    ['duplicate job delivery', 'event-processor duplicate delivery and inserted-only accounting tests'],
    ['partial batch failure', 'worker-registry partial batch failure and per-job retry tests'],
    ['malformed timestamp', 'timestamp normalization rejection tests'],
    ['malformed event', 'event-processor validation rejection and DLQ tests'],
    ['huge event', 'ingestion service payload-size and byte chunking tests'],
    ['one tenant flooding ingestion', 'worker-registry tenant fairness deferral and starvation-guard tests'],
  ]);

  return requiredFailureScenarios.map((scenario) => {
    const external = externalEvidence.get(scenario);
    if (external) return external;
    const coveredByUnit = unitCovered.get(scenario);
    if (coveredByUnit) {
      return {
        scenario,
        status: unitStatus,
        evidence: coveredByUnit,
        command: unitCommand,
        artifact: null,
      };
    }
    if (scenario === 'traffic burst') {
      return {
        scenario,
        status: loadStatus,
        evidence: 'load benchmark command exercises burst traffic profile in the acceptance matrix',
        command: loadCommand,
        artifact: null,
      };
    }
    return {
      scenario,
      status: 'not_run',
      evidence: 'requires benchmark-environment chaos evidence via --scenario-evidence',
      command: null,
      artifact: null,
    };
  });
}

async function buildSections(config: ReportConfig): Promise<ReportSection[]> {
  const unitCommand = npmCommand('test', ['--run', ...focusedUnitTests]);
  const sections: ReportSection[] = [
    sectionFromCommand({
      key: 'unit',
      title: 'Unit Tests',
      purpose: 'Validate ingestion services, queue helpers, metrics rendering, timestamp normalization, writer contracts, and error bulk persistence.',
      command: unitCommand,
      notes: [
        'Covers ingestion admission, worker metrics, queue depth, timestamp normalization, telemetry writer outbox contracts, and error ingestion bulk helpers.',
      ],
    }),
  ];

  sections.push(config.runIntegration
    ? sectionFromCommand({
      key: 'integration',
      title: 'Integration Tests',
      purpose: 'Run the repository integration ingestion suite through the integration Vitest config.',
      command: npmCommand('test:integration', ['--run', 'test/integration/ingestion.test.ts']),
      notes: [
        'Uses vitest.integration.config.ts and the existing ingestion integration test entrypoint.',
      ],
    })
    : {
      key: 'integration',
      title: 'Integration Tests',
      purpose: 'Run the repository integration ingestion suite through the integration Vitest config.',
      status: 'not_run',
      command: npmCommand('test:integration', ['--run', 'test/integration/ingestion.test.ts']),
      result: null,
      notes: ['Skipped by --skip-integration; final evidence must rerun without this flag.'],
    });

  sections.push(config.loadCommand
    ? sectionFromCommand({
      key: 'load',
      title: 'Load Tests',
      purpose: 'Collect load or benchmark evidence for the ingestion pipeline.',
      command: config.loadCommand,
      notes: [
        'For final acceptance this should be the same live benchmark matrix used in the benchmark report, not a dry-run plan.',
      ],
    })
    : {
      key: 'load',
      title: 'Load Tests',
      purpose: 'Collect load or benchmark evidence for the ingestion pipeline.',
      status: 'not_run',
      command: '--load-command was not provided',
      result: null,
      notes: ['Final evidence must provide --load-command against a benchmark database.'],
    });

  const failureScenarios = buildFailureScenarios(sections, await readScenarioEvidence(config.scenarioEvidencePath));
  const failureStatus: SectionStatus = failureScenarios.every((scenario) => scenario.status === 'passed') ? 'passed' : 'failed';

  sections.push(
    {
      key: 'failure',
      title: 'Failure Tests',
      purpose: 'Map focused regression evidence for worker persistence failures, queue retries, DLQ behavior, and stuck-job maintenance.',
      status: failureStatus,
      command: unitCommand,
      result: sections[0]!.result,
      notes: [
        'Covered by event-processor, pg-queue, and pg-queue-worker tests in the focused unit command.',
        `Required scenarios: ${requiredFailureScenarios.join('; ')}.`,
        'Final acceptance requires each scenario to be backed by a passing unit, integration, load, or chaos test artifact.',
        'Use --scenario-evidence with benchmark-environment chaos results for scenarios that cannot be proven by the focused unit command.',
      ],
      scenarios: failureScenarios,
    },
    {
      key: 'duplicate',
      title: 'Duplicate Tests',
      purpose: 'Map focused regression evidence for duplicate delivery/idempotency behavior and inserted-only accounting.',
      status: sections[0]!.status,
      command: unitCommand,
      result: sections[0]!.result,
      notes: [
        'Covered by event-processor duplicate delivery tests and repository conflict-handling tests in the focused unit command.',
      ],
    },
    {
      key: 'timestamp',
      title: 'Timestamp Tests',
      purpose: 'Map focused regression evidence for supported timestamp forms, invalid explicit timestamps, and trace root-span normalization.',
      status: sections[0]!.status,
      command: unitCommand,
      result: sections[0]!.result,
      notes: [
        'Covered by ingestion request pipeline and telemetry-writer trace timestamp normalization tests.',
      ],
    },
    {
      key: 'fairness',
      title: 'Fairness Tests',
      purpose: 'Map focused regression evidence for tenant fairness deferral, starvation guard admission, and in-flight gauge cleanup.',
      status: sections[0]!.status,
      command: unitCommand,
      result: sections[0]!.result,
      notes: [
        'Covered by worker-registry tenant fairness tests in the focused unit command.',
      ],
    },
  );

  return sections;
}

function renderReport(sections: ReportSection[]): string {
  const passed = sections.every((section) => section.status === 'passed');
  return [
    '# Ingestion Test Report',
    '',
    `Generated at: ${new Date().toISOString()}`,
    `Overall status: ${passed ? 'passed' : 'failed'}`,
    '',
    ...sections.map(renderSection),
  ].join('\n');
}

async function main(): Promise<void> {
  const config = parseArgs();
  const sections = await buildSections(config);
  const report = renderReport(sections);
  await mkdir(dirname(config.outPath), { recursive: true });
  await writeFile(config.outPath, report, 'utf8');
  process.stdout.write(report);
  if (!sections.every((section) => section.status === 'passed')) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
