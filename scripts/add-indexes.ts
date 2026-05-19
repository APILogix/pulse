/**
 * Database index migration script.
 *
 * Creates performance-critical indexes for high-throughput queries.
 * Run once during deployment: npx tsx scripts/add-indexes.ts
 */
import { pool } from '../src/config/database.js';
import { logger } from '../src/config/logger.js';

const migrationLogger = logger.child({ component: 'index-migration' });

const INDEXES = [
  // API key lookup (critical for ingestion auth path)
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_hash
   ON project_api_keys (key_hash) WHERE is_active = true`,

  // Project lookup by org + status
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_projects_org_status
   ON projects (org_id, status)`,

  // Events time-series queries (analytics, replay)
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_events_project_timestamp
   ON events (project_id, timestamp DESC)`,

  // Error events by fingerprint (error grouping)
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_events_fingerprint
   ON error_events (project_id, fingerprint)`,

  // Error events by timestamp (time-range queries)
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_error_events_timestamp
   ON error_events (project_id, timestamp DESC)`,

  // Organization membership lookup
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_members_user
   ON organization_members (user_id, status)`,

  // Organization slug uniqueness check
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_org_slug
   ON organizations (slug) WHERE deleted_at IS NULL`,

  // Audit logs by org + time
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_logs_org_time
   ON audit_logs (org_id, created_at DESC)`,

  // User sessions by user + status
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sessions_user_active
   ON user_sessions (user_id) WHERE status = 'active'`,

  // Request events by project + timestamp
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_request_events_project_time
   ON request_events (project_id, timestamp DESC)`,

  // API keys by project + environment
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_api_keys_project_env
   ON project_api_keys (project_id, environment, is_active)`,

  // Organization invitations by token
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invitations_token
   ON organization_invitations (token_hash) WHERE status = 'pending'`,
];

async function runMigration() {
  migrationLogger.info('Starting index migration');

  for (let i = 0; i < INDEXES.length; i++) {
    const sql = INDEXES[i]!;
    const indexName = sql.match(/IF NOT EXISTS (\w+)/)?.[1] || `index_${i}`;

    try {
      migrationLogger.info({ index: indexName, progress: `${i + 1}/${INDEXES.length}` }, 'Creating index');
      await pool.query(sql);
      migrationLogger.info({ index: indexName }, 'Index created successfully');
    } catch (error) {
      migrationLogger.error({ index: indexName, error }, 'Failed to create index');
      throw error;
    }
  }

  migrationLogger.info('Index migration completed');
  await pool.end();
}

runMigration().catch((error) => {
  migrationLogger.fatal({ error }, 'Index migration failed');
  process.exit(1);
});
