#!/usr/bin/env tsx
/**
 * Rebuild aggregated schema files and mirror modular schemas for both PrimaryDB v2 and LogDB v2.
 *
 * Runs:
 *   - scripts/rebuild-primary-schema-file.ts
 *   - scripts/rebuild-log-schema-file.ts
 *
 * Usage:
 *   npm run db:rebuild
 *   npm run db:rebuild:v2
 */
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rebuildPrimary = path.resolve(__dirname, 'rebuild-primary-schema-file.ts');
const rebuildLog = path.resolve(__dirname, 'rebuild-log-schema-file.ts');

console.log('='.repeat(60));
console.log('Rebuilding PrimaryDB v2 & LogDB v2 Schemas');
console.log('='.repeat(60));

try {
  console.log('\n[1/2] Rebuilding PrimaryDB v2...');
  execFileSync(process.execPath, ['--import', 'tsx/esm', rebuildPrimary], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });

  console.log('\n[2/2] Rebuilding LogDB v2...');
  execFileSync(process.execPath, ['--import', 'tsx/esm', rebuildLog], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
  });

  console.log('\n' + '='.repeat(60));
  console.log('✔ Successfully rebuilt all v2 database schemas!');
  console.log('='.repeat(60) + '\n');
} catch (err) {
  console.error('\n✖ Schema rebuild failed:', err);
  process.exit(1);
}
