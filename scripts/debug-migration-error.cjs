const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.LOG_DB_PRIMARY || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const schemaFolder = path.resolve(__dirname, '../database/logdbv2/schema');
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

  const filesToTest = [];
  const triggerFiles = [];

  for (const domain of domainOrder) {
    const domainDir = path.join(schemaFolder, domain);
    if (!fs.existsSync(domainDir)) continue;

    const files = fs.readdirSync(domainDir).sort();
    for (const file of files) {
      if (!file.endsWith('.sql')) continue;
      if (file === '999_triggers.sql') {
        triggerFiles.push(path.join(domain, file));
        continue;
      }
      filesToTest.push(path.join(domain, file));
    }
  }
  filesToTest.push(...triggerFiles);

  console.log(`Found ${filesToTest.length} modular schema files to test against LogDB.`);

  const client = await pool.connect();
  let passed = 0;
  try {
    for (const rel of filesToTest) {
      const fullPath = path.join(schemaFolder, rel);
      const sql = fs.readFileSync(fullPath, 'utf8').trim();
      if (!sql) continue;

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('ROLLBACK');
        passed++;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        console.error(`\n[FILE FAILED]: ${rel}`);
        console.error('Error message:', err.message);
        console.error('Detail:', err.detail);
        console.error('Line/Position:', err.line, err.position);
        break;
      }
    }
    console.log(`\nResult: ${passed}/${filesToTest.length} files passed.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error(err);
  pool.end();
});
