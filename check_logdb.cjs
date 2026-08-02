const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';`);
    console.log('Tables in logdb public schema:', res.rows.map(r => r.table_name));
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
