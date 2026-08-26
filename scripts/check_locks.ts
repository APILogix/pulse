import { logDB } from '../src/config/log-database.js';

async function checkLocks() {
  const client = await logDB.getPrimaryPool().connect();
  try {
    const res = await client.query(`
      SELECT pid, state, query, wait_event_type, wait_event, age(clock_timestamp(), query_start) as duration
      FROM pg_stat_activity
      WHERE pid <> pg_backend_pid()
        AND datname = current_database();
    `);
    console.log('Active queries / locks:', res.rows);
  } finally {
    client.release();
    await logDB.close();
  }
}
checkLocks().catch(console.error);
