import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaFolder = path.resolve(__dirname, '../database/logdbv2/schema');
const v2Path = path.resolve(__dirname, '../database/logdbv2/migrations/000001_create_schema.up.sql');
const v2SchemaPath = path.resolve(__dirname, '../database/logdbv2/schema.sql');

const domainOrder = [
  '00_extensions',
  '01_types',
  '02_schema_notes',
  '03_lookup',
  '04_ingestion',
  '05_observability',
  '06_error_groups',
  '07_analytics',
  '08_connectors',
  '09_alerting',
  '10_ai',
  '11_outbox',
  '12_search',
  '13_geo',
  '14_retention',
  '15_functions',
];

const schemaParts: string[] = [];
schemaParts.push('-- Clean PostgreSQL LogDB baseline.');
schemaParts.push('-- Generated from modular database/logdbv2/schema domain sources with proper indexing and partitioning.');

const triggerFiles: string[] = [];

for (const domain of domainOrder) {
  const domainDir = path.join(schemaFolder, domain);
  if (!fs.existsSync(domainDir)) continue;

  const files = fs.readdirSync(domainDir).sort();
  for (const file of files) {
    if (!file.endsWith('.sql')) continue;
    if (file === '999_triggers.sql') {
      triggerFiles.push(`${domain}/${file}`);
      continue;
    }
    const rel = `${domain}/${file}`;
    schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
    schemaParts.push(fs.readFileSync(path.join(schemaFolder, rel), 'utf8').trim());
  }
}

for (const rel of triggerFiles) {
  schemaParts.push(`\n-- ============================================================\n-- Source: ${rel}\n-- ============================================================\n`);
  schemaParts.push(fs.readFileSync(path.join(schemaFolder, rel), 'utf8').trim());
}

const fullSql = schemaParts.join('\n') + '\n';
fs.writeFileSync(v2Path, fullSql, 'utf8');
fs.writeFileSync(v2SchemaPath, fullSql, 'utf8');

console.log(`Successfully rebuilt LogDB:`);
console.log(`  - ${v2Path} (${fullSql.length} bytes)`);
console.log(`  - ${v2SchemaPath} (${fullSql.length} bytes)`);
