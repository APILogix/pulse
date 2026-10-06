const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const isLogDb = process.argv.includes('--logdb');
const targetDb = isLogDb ? (process.env.LOG_DB_PRIMARY || process.env.DATABASE_URL) : process.env.DATABASE_URL;
const targetFolder = isLogDb ? '../database/logdbv2/schema' : '../database/primarydbv2/schema';
const dbLabel = isLogDb ? 'LogDB' : 'PrimaryDB';

const pool = new Pool({
  connectionString: targetDb,
  ssl: { rejectUnauthorized: false }
});

function getAllFiles(dir, ext = '.sql') {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, ext));
    } else if (file.endsWith(ext)) {
      results.push(filePath);
    }
  }
  return results;
}

async function main() {
  const schemaDir = path.resolve(__dirname, targetFolder);
  const files = getAllFiles(schemaDir);

  const definedTables = new Map(); // table -> [files]

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const tableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_]+)/gi;
    let match;
    while ((match = tableRegex.exec(content)) !== null) {
      const table = match[1].toLowerCase();
      if (!definedTables.has(table)) {
        definedTables.set(table, []);
      }
      definedTables.get(table).push(path.relative(schemaDir, file));
    }
  }

  const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
  const liveTables = new Set(res.rows.map(r => r.table_name));

  console.log(`${dbLabel} Schema declares ${definedTables.size} tables.`);
  console.log(`Live ${dbLabel} has ${liveTables.size} public tables.`);

  const missingFromLive = [];
  for (const [table, sources] of definedTables) {
    if (!liveTables.has(table)) {
      missingFromLive.push({ table, sources });
    }
  }

  console.log(`\n=== TABLES DECLARED IN schema BUT MISSING FROM LIVE ${dbLabel} ===`);
  if (missingFromLive.length === 0) {
    console.log(`✔ All declared tables exist in live ${dbLabel}!`);
  } else {
    for (const m of missingFromLive) {
      console.log(`❌ Table "${m.table}" defined in: ${m.sources.join(', ')}`);
    }
  }

  await pool.end();
}

main().catch(err => {
  console.error(err);
  pool.end();
});
