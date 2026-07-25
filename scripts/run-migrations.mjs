import fs from 'fs';
import path from 'path';
import pkg from 'pg';
const { Client } = pkg;
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load variables from the local .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runMigrations() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌ ERROR: DATABASE_URL is not set in your .env file.');
    process.exit(1);
  }

  const client = new Client({ connectionString });

  try {
    console.log(`Connecting to Postgres DB...`);
    await client.connect();

    console.log('Running 001_drop_all.sql...');
    const dropSql = fs.readFileSync(path.resolve(__dirname, '../src/db/postgres/migrations/001_drop_all.sql'), 'utf-8');
    await client.query(dropSql);
    console.log('✅ Successfully dropped all tables and types.');

    const migrationFiles = [
      '002_create_all_ordered.sql',
      '003_project_module_refactor.sql',
    ];

    for (const file of migrationFiles) {
      console.log(`Running ${file}...`);
      const sql = fs.readFileSync(path.resolve(__dirname, '../src/db/postgres/migrations', file), 'utf-8');
      await client.query(sql);
    }
    console.log('Successfully recreated schema and applied project module refactor.');
  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await client.end();
  }
}

runMigrations();
