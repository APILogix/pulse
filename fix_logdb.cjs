const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const res = await client.query(`DELETE FROM logdb_migrations WHERE filename = '03_observability/005_create_sdk_event_tables_if_missing.up.sql';`);
    console.log('Deleted rows:', res.rowCount);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
