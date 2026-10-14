import { connectDB, pool } from '../src/config/database.js';
import { connectLogDB, logDB } from '../src/config/log-database.js';

async function verify() {
  console.log('Connecting to Primary DB...');
  await connectDB();
  const primaryRes = await pool.query('SELECT count(*) FROM billing_features;');
  console.log('Primary DB verified, billing_features count:', primaryRes.rows[0].count);

  console.log('Connecting to Log DB...');
  await connectLogDB();
  const logRes = await logDB.queryWithRetry('SELECT count(*) FROM logdb_schema_notes;', [], { operation: 'read' });
  console.log('Log DB verified, logdb_schema_notes count:', logRes.rows[0].count);

  await pool.end();
  await logDB.close();
  console.log('All database verifications finished successfully!');
}

verify().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
