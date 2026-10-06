#!/usr/bin/env tsx
/**
 * Create a new migration file pair (.up.sql and .down.sql) for PrimaryDB v2 or LogDB v2.
 *
 * Usage:
 *   npm run db:migration:create -- --name add_user_preferences
 *   npm run db:migration:create -- --name add_telemetry_index --db logdb
 *   npx tsx scripts/create-migration.ts --name <name> [--db primary|logdb]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PRIMARY_MIGRATIONS_DIR = path.resolve(__dirname, '../database/primarydbv2/migrations');
const LOGDB_MIGRATIONS_DIR = path.resolve(__dirname, '../database/logdbv2/migrations');

interface CliOptions {
  name: string;
  db: 'primary' | 'logdb';
}

function parseArgs(argv: string[]): CliOptions {
  let name = '';
  let db: 'primary' | 'logdb' = 'primary';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name' || arg === '-n') {
      name = argv[i + 1] || '';
      i += 1;
    } else if (arg === '--db' || arg === '-d') {
      const val = (argv[i + 1] || '').toLowerCase();
      if (val === 'log' || val === 'logdb') {
        db = 'logdb';
      } else {
        db = 'primary';
      }
      i += 1;
    } else if (!arg.startsWith('--') && !name) {
      name = arg;
    }
  }

  return { name, db };
}

function getNextMigrationNumber(dir: string): number {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    return 1;
  }

  const files = fs.readdirSync(dir);
  let maxSeq = 0;

  for (const file of files) {
    const match = file.match(/^(\d{6})_/);
    if (match) {
      const seq = parseInt(match[1], 10);
      if (seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return maxSeq + 1;
}

function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (!options.name) {
    console.error('ERROR: Migration name is required.');
    console.error('Usage: npm run db:migration:create -- --name <migration_name> [--db primary|logdb]');
    process.exit(1);
  }

  const cleanName = sanitizeName(options.name);
  if (!cleanName) {
    console.error('ERROR: Invalid migration name.');
    process.exit(1);
  }

  const targetDir = options.db === 'logdb' ? LOGDB_MIGRATIONS_DIR : PRIMARY_MIGRATIONS_DIR;
  const dbLabel = options.db === 'logdb' ? 'LogDB v2' : 'PrimaryDB v2';

  const nextSeq = getNextMigrationNumber(targetDir);
  const prefix = String(nextSeq).padStart(6, '0');

  const upFilename = `${prefix}_${cleanName}.up.sql`;
  const downFilename = `${prefix}_${cleanName}.down.sql`;

  const upPath = path.join(targetDir, upFilename);
  const downPath = path.join(targetDir, downFilename);

  const timestamp = new Date().toISOString();

  const upContent = `-- Migration: ${upFilename}
-- Database: ${dbLabel}
-- Created: ${timestamp}
-- Description: ${cleanName}

BEGIN;

-- Apply changes here:


COMMIT;
`;

  const downContent = `-- Migration Rollback: ${downFilename}
-- Database: ${dbLabel}
-- Rollback for: ${upFilename}
-- Created: ${timestamp}

BEGIN;

-- Revert changes here:


COMMIT;
`;

  fs.writeFileSync(upPath, upContent, 'utf8');
  fs.writeFileSync(downPath, downContent, 'utf8');

  console.log(`\nSuccessfully created ${dbLabel} migration:`);
  console.log(`  [UP]   ${upPath}`);
  console.log(`  [DOWN] ${downPath}\n`);
}

main().catch((err) => {
  console.error('Failed to create migration:', err);
  process.exit(1);
});
