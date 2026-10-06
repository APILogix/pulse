import { logDB } from '../src/config/log-database.js';

async function test() {
  console.log('--- Testing logDB Read vs Write Routing ---');
  try {
    const startRead = Date.now();
    const r = await logDB.queryWithRetry('SELECT count(*) FROM events_requests', [], { operation: 'read' });
    console.log(`[READ] Success in ${Date.now() - startRead}ms:`, r.rows);
  } catch (e: any) {
    console.error('[READ] Failed:', e.message);
  }

  try {
    const startWrite = Date.now();
    const w = await logDB.queryWithRetry('SELECT count(*) FROM events_requests', [], { operation: 'write' });
    console.log(`[WRITE] Success in ${Date.now() - startWrite}ms:`, w.rows);
  } catch (e: any) {
    console.error('[WRITE] Failed:', e.message);
  }

  await logDB.close();
}

test().catch(console.error);
