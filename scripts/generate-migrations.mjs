/**
 * generate-migrations.mjs
 * 
 * Reads every SQL file in canonical_migrations_draft (in folder/filename order)
 * and produces two migration files:
 * 
 *   001_drop_all.sql   — drops every table, type, function from the database
 *   002_create_all.sql  — creates everything from the canonical draft
 *
 * Usage:  node scripts/generate-migrations.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFT_DIR = path.resolve(__dirname, '../src/db/postgres/canonical_migrations_draft');
const OUT_DIR = path.resolve(__dirname, '../src/db/postgres/migrations');

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Collect all SQL files in correct folder + filename order ───────────────

function collectSqlFiles(baseDir) {
  const folders = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .sort();

  const files = [];
  for (const folder of folders) {
    const folderPath = path.join(baseDir, folder);
    const sqlFiles = fs.readdirSync(folderPath)
      .filter(f => f.endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    for (const f of sqlFiles) {
      files.push({
        folder,
        filename: f,
        fullPath: path.join(folderPath, f),
      });
    }
  }
  const preferencesFileIndex = files.findIndex(f => f.filename === '011_create_user_preferences.up.sql');
  if (preferencesFileIndex !== -1) {
    const prefFile = files.splice(preferencesFileIndex, 1)[0];
    files.push(prefFile);
  }

  // Remove the redundant fix file completely
  const fixedTablesIndex = files.findIndex(f => f.filename === '001_fixed_tables.sql');
  if (fixedTablesIndex !== -1) {
    files.splice(fixedTablesIndex, 1);
  }

  const billingEnumsIndex = files.findIndex(f => f.filename === '001_billing_enums.sql');
  if (billingEnumsIndex !== -1) {
    const billingEnumsFile = files.splice(billingEnumsIndex, 1)[0];
    files.unshift(billingEnumsFile); // put at the very beginning
  }

  return files;
}

// ─── Extract table names from all SQL files for the DROP script ────────────

function extractTableNames(sqlFiles) {
  const tables = [];
  for (const { fullPath } of sqlFiles) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    // Match CREATE TABLE IF NOT EXISTS <name> and CREATE TABLE <name>
    const matches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi);
    for (const m of matches) {
      const name = m[1].toLowerCase();
      if (!tables.includes(name)) {
        tables.push(name);
      }
    }
  }
  return tables;
}

function extractTypeNames(sqlFiles) {
  const types = new Set();
  for (const { fullPath } of sqlFiles) {
    const content = fs.readFileSync(fullPath, 'utf-8');
    // Match CREATE TYPE <name>
    const matches = content.matchAll(/CREATE\s+TYPE\s+(\w+)\s+AS\s+ENUM/gi);
    for (const m of matches) {
      types.add(m[1].toLowerCase());
    }
  }
  return [...types];
}

// ─── Generate 001_drop_all.sql ─────────────────────────────────────────────

function generateDropScript(sqlFiles) {
  const tables = extractTableNames(sqlFiles);
  const types = extractTypeNames(sqlFiles);

  let sql = `-- =============================================================================
-- Migration : 001_drop_all.sql
-- Generated : ${new Date().toISOString()}
-- Purpose   : Drop ALL tables, types, and functions from the database
--             to allow a clean re-creation from canonical schema.
--
-- ⚠️  WARNING: This DESTROYS all data. Use only for dev/staging resets.
-- =============================================================================

BEGIN;

`;

  // Drop tables in reverse order (to respect FK dependencies)
  const reversed = [...tables].reverse();
  sql += `-- ═══════════════════════════════════════════════\n`;
  sql += `-- DROP TABLES (reverse dependency order)\n`;
  sql += `-- ═══════════════════════════════════════════════\n\n`;
  for (const t of reversed) {
    sql += `DROP TABLE IF EXISTS ${t} CASCADE;\n`;
  }

  sql += `\n-- ═══════════════════════════════════════════════\n`;
  sql += `-- DROP ENUM TYPES\n`;
  sql += `-- ═══════════════════════════════════════════════\n\n`;
  for (const t of types) {
    sql += `DROP TYPE IF EXISTS ${t} CASCADE;\n`;
  }

  sql += `\n-- ═══════════════════════════════════════════════\n`;
  sql += `-- DROP FUNCTIONS\n`;
  sql += `-- ═══════════════════════════════════════════════\n\n`;
  sql += `DROP FUNCTION IF EXISTS set_updated_at() CASCADE;\n`;
  sql += `DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;\n`;
  sql += `DROP FUNCTION IF EXISTS flush_usage_counters() CASCADE;\n`;

  sql += `\nCOMMIT;\n`;

  return sql;
}

// ─── Generate 002_create_all.sql ───────────────────────────────────────────

function generateCreateScript(sqlFiles) {
  let sql = `-- =============================================================================
-- Migration : 002_create_all.sql
-- Generated : ${new Date().toISOString()}
-- Purpose   : Create ALL tables from canonical_migrations_draft in
--             dependency order. Each source file is included as-is, with
--             its own BEGIN/COMMIT removed (wrapped in a single outer TX).
--
-- Source     : canonical_migrations_draft/
-- =============================================================================

BEGIN;

`;

  for (const { folder, filename, fullPath } of sqlFiles) {
    const content = fs.readFileSync(fullPath, 'utf-8');

    // Strip the individual BEGIN; and COMMIT; statements so everything
    // runs in the single outer transaction.
    const stripped = content
      .replace(/^\s*BEGIN\s*;\s*$/gm, '')
      .replace(/^\s*COMMIT\s*;\s*$/gm, '')
      .trim();

    if (stripped.length === 0) continue;

    sql += `-- ═══════════════════════════════════════════════════════════════════════════\n`;
    sql += `-- Source: ${folder}/${filename}\n`;
    sql += `-- ═══════════════════════════════════════════════════════════════════════════\n\n`;
    sql += stripped;
    sql += `\n\n`;
  }

  sql += `COMMIT;\n`;
  return sql;
}

// ─── Main ──────────────────────────────────────────────────────────────────

const sqlFiles = collectSqlFiles(DRAFT_DIR);
console.log(`Found ${sqlFiles.length} SQL files across ${new Set(sqlFiles.map(f => f.folder)).size} modules.`);

const dropSql = generateDropScript(sqlFiles);
const createSql = generateCreateScript(sqlFiles);

const dropPath = path.join(OUT_DIR, '001_drop_all.sql');
const createPath = path.join(OUT_DIR, '002_create_all.sql');

fs.writeFileSync(dropPath, dropSql, 'utf-8');
fs.writeFileSync(createPath, createSql, 'utf-8');

console.log(`✅ Generated: ${dropPath}`);
console.log(`✅ Generated: ${createPath}`);
console.log(`\nDrop script: ${reversed(extractTableNames(sqlFiles)).length} tables, ${extractTypeNames(sqlFiles).length} types`);

function reversed(arr) { return [...arr].reverse(); }
