import { pool } from '../src/config/database.js';

async function main() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    INSERT INTO schema_migrations (filename)
    VALUES ('000001_create_schema.up.sql')
    ON CONFLICT (filename) DO NOTHING;
  `);
  const res = await pool.query('SELECT filename, applied_at FROM schema_migrations');
  console.log('Schema migrations recorded:', res.rows);
  await pool.end();
}

main().catch(async (err) => {
  console.error('Error recording baseline:', err);
  await pool.end();
  process.exit(1);
});
