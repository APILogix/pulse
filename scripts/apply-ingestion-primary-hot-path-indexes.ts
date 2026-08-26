/**
 * Apply primary-DB indexes used by the ingestion admission hot path.
 *
 * These are separate from the Log DB migrations because pg-boss and API key
 * resolution use DATABASE_URL, while telemetry event writes use LOG_DB_PRIMARY.
 */
import { pool, closeDatabase } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';

const migrationLogger = logger.child({ component: 'ingestion-primary-hot-path-indexes' });

const indexes = [
  {
    name: 'idx_project_api_keys_public_key',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_api_keys_public_key
      ON project_api_keys(public_key)
      WHERE deleted_at IS NULL
    `,
  },
  {
    name: 'idx_org_subscriptions_live_latest',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_subscriptions_live_latest
      ON organization_subscriptions(organization_id, created_at DESC)
      WHERE status IN ('trialing','active','past_due')
        AND deleted_at IS NULL
    `,
  },
  {
    name: 'idx_project_api_key_rotations_grace_lookup',
    sql: `
      CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_project_api_key_rotations_grace_lookup
      ON project_api_key_rotations(old_key_id, grace_ends_at DESC)
      WHERE state = 'grace_period'
        AND grace_ends_at IS NOT NULL
    `,
  },
] as const;

async function main(): Promise<void> {
  migrationLogger.info({ count: indexes.length }, 'Applying ingestion primary hot-path indexes');
  try {
    for (const index of indexes) {
      migrationLogger.info({ index: index.name }, 'Creating index concurrently');
      await pool.query(index.sql);
      migrationLogger.info({ index: index.name }, 'Index ready');
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((err) => {
  migrationLogger.fatal({ err }, 'Failed to apply ingestion primary hot-path indexes');
  process.exit(1);
});
