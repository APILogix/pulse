const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const tables = ['error_groups', 'error_group_history'];
    for (const table of tables) {
      console.log(`\n================ Columns for table: ${table} ================`);
      const res = await client.query(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = $1 
        ORDER BY ordinal_position;
      `, [table]);
      res.rows.forEach(r => console.log(`${r.column_name}: ${r.data_type} (nullable: ${r.is_nullable}, default: ${r.column_default})`));
    }
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
