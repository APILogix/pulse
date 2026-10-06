import { pool } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';

async function testPoolLifecycle() {
  console.log('=== POOL CONNECTION & EXECUTION BREAKDOWN ===');

  // Test 1: Primary DB
  console.log('\n--- Primary Pool (DATABASE_URL) ---');
  const t0 = Date.now();
  const client1 = await pool.connect();
  const t1 = Date.now();
  console.log(`1. Connection 1 acquisition: ${t1 - t0}ms`);

  const t2 = Date.now();
  await client1.query('SELECT 1');
  const t3 = Date.now();
  console.log(`2. Query 1 on Connection 1: ${t3 - t2}ms`);

  const t4 = Date.now();
  await client1.query('SELECT 1');
  const t5 = Date.now();
  console.log(`3. Query 2 on Connection 1 (warm): ${t5 - t4}ms`);

  client1.release();
  console.log('Connection 1 released back to pool');

  const t6 = Date.now();
  const client2 = await pool.connect();
  const t7 = Date.now();
  console.log(`4. Connection 2 acquisition (should reuse warm connection): ${t7 - t6}ms`);

  const t8 = Date.now();
  await client2.query('SELECT 1');
  const t9 = Date.now();
  console.log(`5. Query on Connection 2: ${t9 - t8}ms`);
  client2.release();

  // Test 2: Log DB Primary
  console.log('\n--- Log DB Primary Pool (LOG_DB_PRIMARY) ---');
  const primaryPool = logDB.getPrimaryPool();
  const lt0 = Date.now();
  const lclient1 = await primaryPool.connect();
  const lt1 = Date.now();
  console.log(`1. Log DB Connection 1 acquisition: ${lt1 - lt0}ms`);

  const lt2 = Date.now();
  await lclient1.query('SELECT 1');
  const lt3 = Date.now();
  console.log(`2. Query 1 on Log DB: ${lt3 - lt2}ms`);

  const lt4 = Date.now();
  await lclient1.query('SELECT 1');
  const lt5 = Date.now();
  console.log(`3. Query 2 on Log DB (warm): ${lt5 - lt4}ms`);

  lclient1.release();

  const lt6 = Date.now();
  const lclient2 = await primaryPool.connect();
  const lt7 = Date.now();
  console.log(`4. Log DB Connection 2 acquisition (reuse warm): ${lt7 - lt6}ms`);
  lclient2.release();

  await pool.end();
  await logDB.close();
  console.log('\n=== POOL TEST COMPLETE ===');
}

testPoolLifecycle().catch(console.error);
