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

    console.log('Running 002_create_all.sql...');
    const createSql = fs.readFileSync(path.resolve(__dirname, '../src/db/postgres/migrations/002_create_all.sql'), 'utf-8');
    await client.query(createSql);
    console.log('✅ Successfully recreated schema from canonical migrations.');

  } catch (err) {
    console.error('❌ Migration failed:', err);
  } finally {
    await client.end();
  }
}

runMigrations();
