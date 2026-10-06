#!/usr/bin/env tsx
/**
 * End-to-end database recreation runner for PrimaryDB v2 and LogDB v2.
 *
 * Drops and recreates the public schema cleanly, then creates all tables,
 * functions, views, triggers, and seeds table-by-table directly from the
 * canonical modular schema folders:
 *   - database/primarydbv2/schema
 *   - database/logdbv2/schema
 *
 * Usage:
 *   npm run db:recreate:v2 -- --dry-run
 *   npm run db:recreate:v2 -- --yes
 *   npm run db:recreate:v2 -- --yes --only primary
 *   npm run db:recreate:v2 -- --yes --only logdb
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const bootstrapScript = path.resolve(__dirname, 'bootstrap-modular-db.ts');

const args = process.argv.slice(2);

// Always pass --recreate flag to bootstrap-modular-db
const forwardArgs = ['--import', 'tsx/esm', bootstrapScript, '--recreate'];

for (let i = 0; i < args.length; i += 1) {
  const a = args[i];
  if (a !== '--recreate' && a !== '--drop') {
    forwardArgs.push(a);
  }
}

try {
  execFileSync(process.execPath, forwardArgs, {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });
} catch (err: any) {
  process.exit(err.status ?? 1);
}
