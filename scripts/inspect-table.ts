import { config } from 'dotenv';
config();
import { pool } from '../src/config/database.js';

async function inspect(tableNames: string[]) {
  const client = await pool.connect();
  try {
    for (const tableName of tableNames) {
      console.log(`\n==================================================`);
      console.log(`TABLE: ${tableName}`);
      console.log(`==================================================`);

      const colRes = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
      `, [tableName]);
      console.log(`COLUMNS (${colRes.rows.length}):`);
      for (const col of colRes.rows) {
        console.log(`  - ${col.column_name.padEnd(30)} ${col.data_type.padEnd(20)} ${col.is_nullable === 'YES' ? 'NULL' : 'NOT NULL'} ${col.column_default ? 'DEFAULT ' + col.column_default : ''}`);
      }

      const idxRes = await client.query(`
        SELECT
          i.relname AS index_name,
          ix.indisunique AS is_unique,
          ix.indisprimary AS is_primary,
          pg_get_indexdef(ix.indexrelid) AS index_def
        FROM pg_index ix
        JOIN pg_class t ON t.oid = ix.indrelid
        JOIN pg_class i ON i.oid = ix.indexrelid
        JOIN pg_namespace n ON n.oid = t.relnamespace
        WHERE n.nspname = 'public' AND t.relname = $1
        ORDER BY i.relname;
      `, [tableName]);
      console.log(`\nINDEXES (${idxRes.rows.length}):`);
      for (const idx of idxRes.rows) {
        console.log(`  - [${idx.is_primary ? 'PK' : idx.is_unique ? 'UQ' : 'IDX'}] ${idx.index_name}: ${idx.index_def}`);
      }

      const fkRes = await client.query(`
        SELECT
          tc.constraint_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1;
      `, [tableName]);
      console.log(`\nFOREIGN KEYS (${fkRes.rows.length}):`);
      for (const fk of fkRes.rows) {
        console.log(`  - ${fk.constraint_name}: ${fk.column_name} -> ${fk.foreign_table_name}(${fk.foreign_column_name}) ON DELETE ${fk.delete_rule}`);
      }

      const countRes = await client.query(`SELECT count(*) FROM "${tableName}"`);
      console.log(`\nACTUAL ROW COUNT: ${countRes.rows[0].count}`);
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const tables = process.argv.slice(2);
if (tables.length === 0) {
  console.log('Provide table names as arguments');
  process.exit(1);
}

inspect(tables).catch(err => {
  console.error(err);
  process.exit(1);
});
