const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const primaryPool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const logPool = new Pool({
  connectionString: process.env.LOG_DB_PRIMARY || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function getDbSchema(pool, name) {
  const res = await pool.query(`
    SELECT table_name, column_name 
    FROM information_schema.columns 
    WHERE table_schema = 'public';
  `);
  const tables = new Map();
  for (const row of res.rows) {
    if (!tables.has(row.table_name)) {
      tables.set(row.table_name, new Set());
    }
    tables.get(row.table_name).add(row.column_name);
  }
  console.log(`[${name}] Loaded ${tables.size} tables from public schema.`);
  return tables;
}

function getAllFiles(dir, exts = ['.ts']) {
  let results = [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getAllFiles(filePath, exts));
    } else if (exts.some(ext => file.endsWith(ext))) {
      results.push(filePath);
    }
  }
  return results;
}

function checkIsLogTable(table) {
  return (
    table.startsWith('events_') ||
    table.startsWith('trace_') ||
    table.startsWith('span_') ||
    table.startsWith('metric_') ||
    table.startsWith('log_') ||
    table.startsWith('request_metrics') ||
    table.startsWith('error_metrics') ||
    table.startsWith('cron_metrics') ||
    table.startsWith('ai_metrics') ||
    table.includes('_metrics_') ||
    (table.startsWith('connector_') && table.endsWith('_v2')) ||
    table === 'error_groups' ||
    table === 'error_group_history' ||
    table === 'analytics_watermarks' ||
    table === 'analytics_worker_runs' ||
    table === 'analytics_user_sessions' ||
    table === 'analytics_trace_service_edges'
  );
}

async function main() {
  const primaryTables = await getDbSchema(primaryPool, 'PrimaryDB');
  const logTables = await getDbSchema(logPool, 'LogDB');

  const srcDir = path.resolve(__dirname, '../src');
  const files = getAllFiles(srcDir);
  console.log(`Auditing ${files.length} TypeScript files in src/ ...`);

  let tableMismatches = [];
  let insertColMismatches = [];

  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const relFile = path.relative(path.resolve(__dirname, '..'), file);

    // 1. Check INSERT INTO table (col1, col2, ...)
    const insertRegex = /INSERT\s+INTO\s+([a-zA-Z0-9_]+)\s*\(([^)]+)\)/gi;
    let match;
    while ((match = insertRegex.exec(content)) !== null) {
      const table = match[1].toLowerCase();
      const rawCols = match[2];
      const cols = rawCols.split(',')
        .map(c => c.trim().replace(/^["'`]|["'`]$/g, ''))
        .filter(c => c && !c.includes(' ') && !c.includes('${') && !c.includes('}'));

      let db = null;
      let knownCols = null;

      if (checkIsLogTable(table) && logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      } else if (primaryTables.has(table)) {
        db = 'PrimaryDB';
        knownCols = primaryTables.get(table);
      } else if (logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      }

      if (!db) {
        if (!table.startsWith('pgboss') && !table.startsWith('job') && !table.includes('migration') && !table.includes('temp')) {
          tableMismatches.push({ file: relFile, table, queryType: 'INSERT' });
        }
      } else {
        for (const col of cols) {
          if (!knownCols.has(col)) {
            insertColMismatches.push({ file: relFile, table, col, db });
          }
        }
      }
    }

    // 2. Check UPDATE table SET col1 = ..., col2 = ...
    const updateRegex = /UPDATE\s+([a-zA-Z0-9_]+)\s+SET\s+([^WHERE;]+)/gi;
    while ((match = updateRegex.exec(content)) !== null) {
      const table = match[1].toLowerCase();
      const setClause = match[2];
      const setCols = [...setClause.matchAll(/([a-zA-Z0-9_]+)\s*=/g)].map(m => m[1].toLowerCase());

      let db = null;
      let knownCols = null;
      if (checkIsLogTable(table) && logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      } else if (primaryTables.has(table)) {
        db = 'PrimaryDB';
        knownCols = primaryTables.get(table);
      } else if (logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      }

      if (db && knownCols) {
        for (const col of setCols) {
          if (col !== 'case' && col !== 'when' && col !== 'then' && col !== 'else' && col !== 'end') {
            if (!knownCols.has(col)) {
              insertColMismatches.push({ file: relFile, table, col, db, type: 'UPDATE' });
            }
          }
        }
      }
    }

    // 3. Check SELECT col1, col2, ... FROM table (simple queries)
    const selectRegex = /SELECT\s+([a-zA-Z0-9_,\s]+)\s+FROM\s+([a-zA-Z0-9_]+)\s+(?:WHERE|ORDER|LIMIT|GROUP|;|$)/gi;
    while ((match = selectRegex.exec(content)) !== null) {
      const rawCols = match[1];
      const table = match[2].toLowerCase();
      if (rawCols.includes('*') || rawCols.includes('count(') || rawCols.includes('max(') || rawCols.includes('min(')) continue;

      let db = null;
      let knownCols = null;
      if (checkIsLogTable(table) && logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      } else if (primaryTables.has(table)) {
        db = 'PrimaryDB';
        knownCols = primaryTables.get(table);
      } else if (logTables.has(table)) {
        db = 'LogDB';
        knownCols = logTables.get(table);
      }

      if (db && knownCols) {
        const cols = rawCols.split(',')
          .map(c => c.trim().toLowerCase().replace(/^["'`]|["'`]$/g, ''))
          .filter(c => c && /^[a-z_][a-z0-9_]*$/.test(c) && !['distinct', 'as', 'null', 'true', 'false'].includes(c));

        for (const col of cols) {
          if (!knownCols.has(col)) {
            insertColMismatches.push({ file: relFile, table, col, db, type: 'SELECT' });
          }
        }
      }
    }
  }

  console.log('\n=== INSERT/UPDATE COLUMN MISMATCHES ===');
  if (insertColMismatches.length === 0) {
    console.log('✔ All column names in INSERT / UPDATE queries match database schemas!');
  } else {
    for (const m of insertColMismatches) {
      console.log(`❌ [${m.db}] ${m.file} -> ${m.table}.${m.col} (not found in schema!)`);
    }
  }

  console.log('\n=== UNRECOGNIZED TABLES IN QUERIES ===');
  if (tableMismatches.length === 0) {
    console.log('✔ All tables in INSERT queries exist in either PrimaryDB or LogDB!');
  } else {
    for (const m of tableMismatches) {
      console.log(`⚠️ ${m.file} -> Table "${m.table}" not found in either DB`);
    }
  }

  await primaryPool.end();
  await logPool.end();
}

main().catch(err => {
  console.error(err);
  primaryPool.end();
  logPool.end();
});
