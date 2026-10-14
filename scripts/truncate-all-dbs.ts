#!/usr/bin/env tsx
/**
 * Truncate both Primary DB and Log DB in one command.
 * 
 * Usage:
 *   npm run db:truncate:all -- --dry-run
 *   TRUNCATE_ALL_DBS=true npm run db:truncate:all -- --yes
 * 
 * This script combines truncate-primary-db.ts and reset-logdb.ts
 * to fully clear both databases for testing/development.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface TruncateOptions {
  dryRun: boolean;
  yes: boolean;
}

function parseArgs(): TruncateOptions {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    yes: args.includes('--yes'),
  };
}

function printHelp(): void {
  console.log(`
Truncate BOTH Primary DB and Log DB for complete data reset.

Usage:
  npm run db:truncate:all -- --dry-run    # Preview what would be truncated
  TRUNCATE_ALL_DBS=true npm run db:truncate:all -- --yes    # Actually truncate

Environment Variables:
  TRUNCATE_ALL_DBS  Must be "true" when using --yes
  DATABASE_URL      Primary DB connection string
  LOG_DB_PRIMARY    Log DB connection string

WARNING: This will delete ALL data from both databases!
`);
}

async function runScript(scriptPath: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const scriptName = path.basename(scriptPath);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Running: ${scriptName}`);
    console.log('='.repeat(60));

    const child = spawn('tsx', [scriptPath, ...args], {
      stdio: 'inherit',
      env: { ...process.env, ...env },
      shell: true,
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to start ${scriptName}: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${scriptName} exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

async function main(): Promise<void> {
  const options = parseArgs();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    process.exit(0);
  }

  // Safety check
  if (!options.dryRun && (!options.yes || process.env.TRUNCATE_ALL_DBS !== 'true')) {
    throw new Error(
      'Refusing to truncate databases unless --yes and TRUNCATE_ALL_DBS=true are both set.\n' +
      'Use --dry-run to preview, or set TRUNCATE_ALL_DBS=true and pass --yes to proceed.'
    );
  }

  console.log('\n');
  console.log('╔' + '═'.repeat(58) + '╗');
  console.log('║' + ' TRUNCATE ALL DATABASES '.padStart(41).padEnd(58) + '║');
  console.log('╚' + '═'.repeat(58) + '╝');
  console.log();
  console.log(`Mode: ${options.dryRun ? 'DRY-RUN (preview only)' : 'LIVE (destructive)'}`);
  console.log();

  const scriptArgs = options.dryRun ? ['--dry-run'] : ['--yes'];

  try {
    // 1. Truncate Primary DB
    await runScript(
      path.join(__dirname, 'truncate-primary-db.ts'),
      scriptArgs,
      options.dryRun ? {} : { PRIMARY_DB_TRUNCATE: 'true' }
    );

    // 2. Reset Log DB (drop and recreate)
    await runScript(
      path.join(__dirname, 'reset-logdb.ts'),
      options.dryRun ? ['--dry-run'] : ['--yes', '--drop-only'],
      {}
    );

    console.log('\n');
    console.log('╔' + '═'.repeat(58) + '╗');
    console.log('║' + ' SUCCESS '.padStart(34).padEnd(58) + '║');
    console.log('╚' + '═'.repeat(58) + '╝');
    console.log();
    
    if (options.dryRun) {
      console.log('Dry-run complete. No data was modified.');
      console.log('To actually truncate, run:');
      console.log('  TRUNCATE_ALL_DBS=true npm run db:truncate:all -- --yes');
    } else {
      console.log('All databases truncated successfully!');
      console.log();
      console.log('Next steps:');
      console.log('  1. Run migrations if needed: npm run db:migrate');
      console.log('  2. Run log DB migrations: npm run db:migrate:logdb');
      console.log('  3. Seed data if needed: npm run db:seed');
    }
    console.log();
  } catch (error) {
    console.error('\n');
    console.error('╔' + '═'.repeat(58) + '╗');
    console.error('║' + ' FAILED '.padStart(34).padEnd(58) + '║');
    console.error('╚' + '═'.repeat(58) + '╝');
    console.error();
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
