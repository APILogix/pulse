/**
 * Increment 1 — ADR-0006 pool boundary enforcement.
 *
 * Architecture: docs/alerting-redesign/adr/0006-database-ownership.md
 *               docs/alerting-redesign/08-implementation-plan.md (Increment 1, Testing:
 *               "a boundary test asserting no file in A/runtime imports config/database.js")
 *
 * These are static-source assertions on purpose. The ADR-0006 rule "no repository may
 * span both pools" is only real if it is mechanically checked; a comment cannot stop a
 * future change from importing the control-plane pool into a Log DB repository.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../../src');
const RUNTIME_DIR = path.join(SRC, 'modules/alerting/runtime');
const CONFIG_DIR = path.join(SRC, 'modules/alerting/config');

async function readTsFiles(dir: string): Promise<Array<{ file: string; source: string }>> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out: Array<{ file: string; source: string }> = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await readTsFiles(full));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
    out.push({ file: path.relative(SRC, full).replace(/\\/g, '/'), source: await fs.readFile(full, 'utf8') });
  }
  return out;
}

/** Import specifiers only — ignores prose in doc comments that legitimately name the file. */
function importSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) specs.push(match[1]);
    }
  }
  return specs;
}

describe('ADR-0006 pool boundary', () => {
  it('has runtime files to check (guards against a silently empty test)', async () => {
    const files = await readTsFiles(RUNTIME_DIR);
    expect(files.length).toBeGreaterThan(0);
  });

  it('no file in modules/alerting/runtime imports the control-plane pool', async () => {
    const files = await readTsFiles(RUNTIME_DIR);
    const offenders = files.filter(({ source }) =>
      importSpecifiers(source).some((spec) => spec.includes('config/database')),
    );
    expect(
      offenders.map((o) => o.file),
      'Log DB runtime code must never import config/database.js (ADR-0006)',
    ).toEqual([]);
  });

  it('no file in modules/alerting/config imports the Log DB pool', async () => {
    const files = await readTsFiles(CONFIG_DIR);
    const offenders = files.filter(({ source }) =>
      importSpecifiers(source).some((spec) => spec.includes('config/log-database')),
    );
    expect(
      offenders.map((o) => o.file),
      'Control-plane config code must never import the Log DB pool (ADR-0006)',
    ).toEqual([]);
  });

  it('AlertRuntimeRepository requires an explicit pool (no default)', async () => {
    const source = await fs.readFile(
      path.join(RUNTIME_DIR, 'alert-runtime.repository.ts'),
      'utf8',
    );
    // Defaulting the pool would re-create exactly the ambiguity ADR-0006 removes,
    // so the constructor must take a REQUIRED argument.
    expect(source).toMatch(/constructor\(private readonly db: Pool\)/);
    expect(source, 'the runtime pool must never have a default value')
      .not.toMatch(/constructor\([^)]*db:\s*Pool\s*=/);
  });

  it('AlertConfigRepository defaults to the primary pool for backward compatibility', async () => {
    const source = await fs.readFile(
      path.join(CONFIG_DIR, 'alert-config.repository.ts'),
      'utf8',
    );
    // An optional parameter keeps every existing construction site working unchanged,
    // which is what makes Increment 1 behaviour-neutral.
    expect(source).toMatch(/constructor\(db: Pool = primaryPool\)/);
  });

  it('every alerting/connector repository accepts an injected pool', async () => {
    const repositories = [
      ['modules/alerting/rules/rules.repository.js', 'RulesRepository'],
      ['modules/alerting/events/events.repository.js', 'EventsRepository'],
      ['modules/alerting/silences/silences.repository.js', 'SilencesRepository'],
      ['modules/alerting/policies/policies.repository.js', 'PoliciesRepository'],
      ['modules/alerting/templates/templates.repository.js', 'TemplatesRepository'],
      ['modules/alerting/routing/routing.repository.js', 'RoutingRepository'],
      ['modules/alerting/metrics/metrics.repository.js', 'MetricsRepository'],
      ['modules/connectors/core/connector.repository.js', 'ConnectorRepository'],
      ['modules/connectors/delivery/delivery.repository.js', 'DeliveryRepository'],
      ['modules/connectors/metrics/metrics.repository.js', 'ConnectorMetricsRepository'],
      ['modules/connectors/audit/audit.repository.js', 'ConnectorAuditRepository'],
      ['modules/connectors/routing/routes.repository.js', 'ConnectorRoutesRepository'],
    ] as const;

    for (const [modulePath, exportName] of repositories) {
      const source = await fs.readFile(
        path.join(SRC, modulePath.replace(/\.js$/, '.ts')),
        'utf8',
      );
      expect(source, `${exportName} must accept an injected pool (ADR-0006)`)
        .toMatch(/constructor\(db: typeof pool = pool\)/);
    }
  });
});
