const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb' });
  await client.connect();
  try {
    const res = await client.query(`SELECT count(*) FROM events_requests;`);
    console.log('Rows in events_requests:', res.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
