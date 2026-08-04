const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:vikas1234@localhost:5432/logdb'
});

async function run() {
  try {
    const res = await pool.query('SELECT count(*) FROM events_requests');
    console.log('Total events_requests:', res.rows[0].count);
    const res2 = await pool.query('SELECT count(*) FROM events_metrics');
    console.log('Total events_metrics:', res2.rows[0].count);
    
    // Check if the columns exist
    const cols = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='events_requests' AND column_name='application_name'
    `);
    console.log('application_name column exists in events_requests:', cols.rows.length > 0);
  } catch (err) {
    console.error('Error querying:', err.message);
  } finally {
    await pool.end();
  }
}

run();
