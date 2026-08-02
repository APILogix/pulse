const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/apitool' });
  await client.connect();
  try {
    const res = await client.query(`UPDATE pgboss.job SET state = 'created', started_on = null, completed_on = null WHERE name = 'ingest.request' AND state = 'failed';`);
    console.log('Retried jobs:', res.rowCount);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
