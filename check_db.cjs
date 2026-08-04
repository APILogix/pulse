const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: 'postgresql://postgres:vikas1234@localhost:5432/apitool' });
  await client.connect();
  try {
    const failed = await client.query(`SELECT count(*) FROM pgboss.job WHERE state = 'failed';`);
    console.log('Failed pg-boss jobs:', failed.rows[0].count);
    
    const jobs = await client.query(`SELECT name, state, count(*) FROM pgboss.job GROUP BY name, state;`);
    console.log('Jobs by queue:', jobs.rows);
    
    const events = await client.query(`SELECT count(*) FROM events_requests;`);
    console.log('Events in events_requests:', events.rows[0].count);
  } catch (err) {
    console.error(err);
  } finally {
    await client.end();
  }
}
main();
