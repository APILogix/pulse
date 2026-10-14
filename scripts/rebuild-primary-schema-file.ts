import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaFolder = path.resolve(__dirname, '../database/primarydbv2/schema');
const v2Path = path.resolve(__dirname, '../database/primarydbv2/migrations/000001_create_schema.up.sql');
const v2SchemaPath = path.resolve(__dirname, '../database/primarydbv2/schema.sql');

// 10_notification must precede 09_alerting because alert rules reference notification routes
const domainOrder = [
  '00_extensions',
  '01_schemas',
  '02_types',
  '03_reference',
  '04_user',
  '05_organization',
  '06_project',
  '07_billing',
  '08_connector',
  '10_notification',
  '09_alerting',
  '11_observability',
  '12_usage',
  '13_ai',
  '14_automation',
  '15_analytics',
  '16_security',
  '18_views',
  '17_functions',
  '19_partitions',
  '20_seeders',
  '21_comments',
];

function topologicalSortDomainFiles(domainDir: string): string[] {
  const rawFiles = fs.readdirSync(domainDir).filter((f) => f.endsWith('.sql') && f !== '999_triggers.sql').sort();
  const fileInfos = rawFiles.map((file) => {
    const content = fs.readFileSync(path.join(domainDir, file), 'utf8');
    const createdTables: string[] = [];
    const tableRegex = /CREATE\s+(?:TEMP\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = tableRegex.exec(content)) !== null) {
      createdTables.push(m[1].toLowerCase());
    }
    const refTables: string[] = [];
    const refRegex = /REFERENCES\s+([a-zA-Z0-9_]+)/gi;
    while ((m = refRegex.exec(content)) !== null) {
      refTables.push(m[1].toLowerCase());
    }
    return { file, createdTables, refTables };
  });

  const sorted: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(info: typeof fileInfos[0]) {
    if (visited.has(info.file)) return;
    if (visiting.has(info.file)) return;
    visiting.add(info.file);

    for (const other of fileInfos) {
      if (other.file === info.file) continue;
      if (info.refTables.some((t) => other.createdTables.includes(t))) {
        visit(other);
      }
    }

    visiting.delete(info.file);
    visited.add(info.file);
    sorted.push(info.file);
  }

  for (const info of fileInfos) {
    visit(info);
  }

  return sorted;
}

const schemaParts: string[] = [];
schemaParts.push('-- Clean PostgreSQL primary database baseline.');
schemaParts.push('-- Generated from modular schema domain sources with latest indexes and migrations.');

const triggerFiles: string[] = [];

for (const domain of domainOrder) {
  const domainDir = path.join(schemaFolder, domain);
  if (!fs.existsSync(domainDir)) continue;

  const files = topologicalSortDomainFiles(domainDir);
  for (const file of files) {
    const rel = `${domain}/${file}`;
    schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
    schemaParts.push(fs.readFileSync(path.join(schemaFolder, rel), 'utf8').trim());
  }

  const triggerPath = path.join(domainDir, '999_triggers.sql');
  if (fs.existsSync(triggerPath)) {
    triggerFiles.push(`${domain}/999_triggers.sql`);
  }
}

for (const rel of triggerFiles) {
  schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
  schemaParts.push(fs.readFileSync(path.join(schemaFolder, rel), 'utf8').trim());
}

const fullSql = schemaParts.join('\n') + '\n';
fs.writeFileSync(v2Path, fullSql, 'utf8');
fs.writeFileSync(v2SchemaPath, fullSql, 'utf8');

console.log(`Successfully rebuilt PrimaryDB:`);
console.log(`  - ${v2Path} (${fullSql.length} bytes)`);
console.log(`  - ${v2SchemaPath} (${fullSql.length} bytes)`);
