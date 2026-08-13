/**
 * Run all SQL files inside a specified subfolder of canonical_migrations_draft.
 *
 * Usage:
 *   npx tsx scripts/run-canonical-folder.ts <folder_name>
 *   npm run db:migrate:folder <folder_name>
 *
 * Examples:
 *   npx tsx scripts/run-canonical-folder.ts 11_billing
 *   npx tsx scripts/run-canonical-folder.ts 01_auth
 *   npx tsx scripts/run-canonical-folder.ts 11_billing/seeder
 */
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';
import { applyMigrationSql } from './lib/migrations.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFT_BASE_DIR = path.resolve(__dirname, '../src/db/postgres/canonical_migrations_draft');

async function listAvailableFolders(): Promise<string[]> {
  try {
    const entries = await fs.readdir(DRAFT_BASE_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const folderArg = process.argv[2]?.trim();

  if (!folderArg) {
    const available = await listAvailableFolders();
    logger.error('Missing target folder argument!');
    logger.info('Usage: npx tsx scripts/run-canonical-folder.ts <folder_name>');
    logger.info(`Available folders in canonical_migrations_draft:\n  - ${available.join('\n  - ')}`);
    process.exit(1);
  }

  // Support path resolution relative to canonical_migrations_draft base dir
  let targetDir = path.isAbsolute(folderArg)
    ? folderArg
    : path.resolve(DRAFT_BASE_DIR, folderArg);

  // Check if directory exists
  try {
    const stat = await fs.stat(targetDir);
    if (!stat.isDirectory()) {
      logger.error(`Specified path is not a directory: ${targetDir}`);
      process.exit(1);
    }
  } catch {
    logger.error(`Directory not found: ${targetDir}`);
    const available = await listAvailableFolders();
    logger.info(`Available folders in canonical_migrations_draft:\n  - ${available.join('\n  - ')}`);
    process.exit(1);
  }

  const relativeName = path.relative(DRAFT_BASE_DIR, targetDir) || folderArg;
  logger.info(`Scanning folder: ${relativeName} (${targetDir})`);

  const entries = await fs.readdir(targetDir, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql') && !e.name.endsWith('.down.sql'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  if (sqlFiles.length === 0) {
    logger.warn(`No .sql files found in folder '${relativeName}'`);
    return;
  }

  logger.info(`Found ${sqlFiles.length} SQL file(s) in '${relativeName}':`);
  for (const f of sqlFiles) {
    logger.info(`  - ${f}`);
  }

  for (const file of sqlFiles) {
    const filePath = path.join(targetDir, file);
    const sql = (await fs.readFile(filePath, 'utf8')).replace(/^\uFEFF/, '');

    const client = await pool.connect();
    try {
      logger.info({ file }, `Executing SQL file: ${file}...`);
      await applyMigrationSql(client, file, sql);
      logger.info({ file }, `Successfully executed: ${file}`);
    } catch (err) {
      logger.error({ err, file }, `Failed executing SQL file: ${file}`);
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info(`All ${sqlFiles.length} SQL files in '${relativeName}' executed successfully!`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    logger.fatal({ err }, 'Script execution failed');
    await pool.end();
    process.exit(1);
  });
