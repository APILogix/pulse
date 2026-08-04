const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/apitool' });
  await client.connect();
  try {
    const failed = await client.query(`SELECT id, name, state, output FROM pgboss.job WHERE name = 'ingest.request' AND state = 'failed' LIMIT 5;`);
    console.dir(failed.rows, {depth: null});
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
