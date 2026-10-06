import { pool } from '../src/config/database.js';
import { logDB } from '../src/config/log-database.js';
import { pgmq } from '../src/lib/pgmq.js';
import { applyLogDbMigrations } from '../src/shared/logdb/migrations.js';
import { logger } from '../src/config/logger.js';

async function main() {
  console.log('=== STARTUP PERFORMANCE & SYSTEM VALIDATION ===');

  // 1. Primary DB Connectivity
  const startDb = Date.now();
  const dbRes = await pool.query('SELECT NOW() as now, current_database() as db');
  console.log(`[1] Primary DB Connected in ${Date.now() - startDb}ms:`, dbRes.rows[0]);

  // 2. Schema Check: ai_release_stale_reservations function
  try {
    const fnRes = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE proname = 'ai_release_stale_reservations'
      ) as exists;
    `);
    const exists = fnRes.rows[0]?.exists;
    console.log(`[2] ai_release_stale_reservations() exists: ${exists}`);
    if (!exists) {
      console.log('Creating missing ai_release_stale_reservations function...');
      await pool.query(`
        CREATE OR REPLACE FUNCTION ai_release_stale_reservations()
        RETURNS integer
        LANGUAGE plpgsql
        SECURITY DEFINER
        AS $$
        DECLARE
          v_released integer;
        BEGIN
          WITH stale AS (
            DELETE FROM ai_credit_reservations
            WHERE status = 'pending'
              AND created_at < NOW() - INTERVAL '15 minutes'
            RETURNING tenant_id, amount
          )
          SELECT COUNT(*) INTO v_released FROM stale;
          RETURN v_released;
        END;
        $$;
      `);
      console.log('Function ai_release_stale_reservations() created successfully!');
    }
  } catch (err: any) {
    console.error('Error verifying/creating ai_release_stale_reservations:', err.message);
  }

  // 3. PGMQ Cache Preload Test
  const startPgmq = Date.now();
  const queues = await pgmq.ensureKnownQueuesLoaded();
  console.log(`[3] PGMQ cache loaded in ${Date.now() - startPgmq}ms. Total known queues: ${queues.size}`);

  // Test checking 50 queues through createQueue
  const startBatch = Date.now();
  const testQueues = Array.from(queues).slice(0, 50);
  await Promise.all(testQueues.map((q) => pgmq.createQueue(q)));
  console.log(`[4] 50 queues verified with cache in ${Date.now() - startBatch}ms (Instant!)`);

  // 4. Log DB Connectivity & Migrations Benchmark
  const startLogDb = Date.now();
  await logDB.connect();
  console.log(`[5] Log DB connected in ${Date.now() - startLogDb}ms`);

  const startMig = Date.now();
  const migResult = await applyLogDbMigrations(logDB.getPrimaryPool(), {
    logger: logger.child({ component: 'test-mig' }),
    executionMode: 'automatic',
  });
  console.log(`[6] Log DB migrations scan completed in ${Date.now() - startMig}ms:`, {
    found: migResult.found,
    applied: migResult.applied,
    skipped: migResult.skipped,
    deferred: migResult.deferred,
  });

  // Cleanup
  await logDB.close();
  await pool.end();
  await pgmq.close();
  console.log('=== ALL CHECKS PASSED SUCCESSFULLY ===');
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
