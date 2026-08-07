const { Client } = require('pg');
const fs = require('fs');

async function runAudit() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();

  try {
    console.log('--- Inspecting PostgreSQL logdb database tables & columns ---');

    // 1. Fetch tables
    const tablesRes = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      ORDER BY table_name;
    `);
    const tables = tablesRes.rows.map(r => r.table_name);
    console.log(`Found ${tables.length} physical base tables in logdb.`);

    // 2. Fetch columns per table
    const columnsRes = await client.query(`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `);

    const schemaMap = {};
    for (const row of columnsRes.rows) {
      if (!schemaMap[row.table_name]) {
        schemaMap[row.table_name] = [];
      }
      schemaMap[row.table_name].push({
        column: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === 'YES',
        default: row.column_default
      });
    }

    // 3. Fetch Indexes
    const indexRes = await client.query(`
      SELECT tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
      ORDER BY tablename, indexname;
    `);

    const indexMap = {};
    for (const row of indexRes.rows) {
      if (!indexMap[row.tablename]) {
        indexMap[row.tablename] = [];
      }
      indexMap[row.tablename].push({
        name: row.indexname,
        def: row.indexdef
      });
    }

    // 4. Fetch Foreign Keys
    const fkRes = await client.query(`
      SELECT
        tc.table_name, 
        kcu.column_name, 
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
      FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public';
    `);

    const auditData = {
      totalTables: tables.length,
      tables,
      schemaMap,
      indexMap,
      foreignKeys: fkRes.rows
    };

    fs.writeFileSync('database_audit_result.json', JSON.stringify(auditData, null, 2));
    console.log('Saved detailed audit dump to database_audit_result.json');

  } catch (err) {
    console.error('Audit inspection error:', err);
  } finally {
    await client.end();
  }
}

runAudit();
