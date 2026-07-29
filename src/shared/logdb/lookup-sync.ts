import type { QueryResultRow } from 'pg';
import { pool } from '../../config/database.js';
import { logDB } from '../../config/log-database.js';
import { logger } from '../../config/logger.js';

const lookupLogger = logger.child({ component: 'logdb-lookup-sync' });

interface OrganizationLookupSourceRow extends QueryResultRow {
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  deleted_at: Date | null;
  plan_id: string | null;
  plan_key: string | null;
  plan_name: string | null;
  plan_tier: string | null;
  subscription_id: string | null;
  subscription_status: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
}

const ORGANIZATION_LOOKUP_SOURCE_SQL = `
  SELECT
    o.id AS organization_id,
    o.name,
    o.slug,
    o.status,
    o.deleted_at,
    p.id AS plan_id,
    p.key AS plan_key,
    p.name AS plan_name,
    p.tier AS plan_tier,
    s.id AS subscription_id,
    s.status AS subscription_status,
    s.current_period_start,
    s.current_period_end
  FROM organizations o
  LEFT JOIN LATERAL (
    SELECT *
    FROM organization_subscriptions os
    WHERE os.organization_id = o.id
      AND os.deleted_at IS NULL
      AND os.status IN ('trialing', 'active', 'past_due')
    ORDER BY os.created_at DESC
    LIMIT 1
  ) s ON TRUE
  LEFT JOIN plans p
    ON p.id = s.plan_id
   AND p.deleted_at IS NULL
  WHERE o.id = $1
  LIMIT 1`;

const ORGANIZATION_LOOKUP_UPSERT_SQL = `
  INSERT INTO organization_lookup (
    organization_id,
    name,
    slug,
    plan_key,
    metadata,
    synced_at
  )
  VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
  ON CONFLICT (organization_id) DO UPDATE SET
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    plan_key = EXCLUDED.plan_key,
    metadata = organization_lookup.metadata || EXCLUDED.metadata,
    synced_at = NOW()`;

export async function syncOrganizationLookupToLogDb(
  organizationId: string,
  reason: string,
): Promise<boolean> {
  const source = await pool.query<OrganizationLookupSourceRow>(
    ORGANIZATION_LOOKUP_SOURCE_SQL,
    [organizationId],
  );
  const row = source.rows[0];
  if (!row) {
    lookupLogger.warn({ organizationId, reason }, 'Organization lookup sync skipped: source row not found');
    return false;
  }

  const metadata = {
    source: 'primary_db',
    reason,
    status: row.status,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    plan: {
      id: row.plan_id,
      key: row.plan_key,
      name: row.plan_name,
      tier: row.plan_tier,
    },
    subscription: {
      id: row.subscription_id,
      status: row.subscription_status,
      currentPeriodStart: row.current_period_start?.toISOString() ?? null,
      currentPeriodEnd: row.current_period_end?.toISOString() ?? null,
    },
  };

  await logDB.queryWithRetry(
    ORGANIZATION_LOOKUP_UPSERT_SQL,
    [
      row.organization_id,
      row.name,
      row.slug,
      row.plan_key,
      JSON.stringify(metadata),
    ],
    { operation: 'write' },
  );

  lookupLogger.info(
    {
      organizationId,
      reason,
      planKey: row.plan_key,
      subscriptionStatus: row.subscription_status,
    },
    'Organization lookup synced to Log DB',
  );

  return true;
}

export function syncOrganizationLookupToLogDbBestEffort(
  organizationId: string,
  reason: string,
): void {
  void syncOrganizationLookupToLogDb(organizationId, reason).catch((err) => {
    lookupLogger.warn(
      { err, organizationId, reason },
      'Organization lookup sync failed; primary transaction remains committed',
    );
  });
}


// ─────────────────────────────────────────────────────────────────────────────
// Project / Environment / API-key lookup snapshots.
//
// These mirror `organization_lookup`: denormalized, best-effort Log DB snapshots
// synced from the primary DB AFTER a successful mutation. They let the
// analytics/telemetry side attribute events to a project, environment, or API
// key WITHOUT a cross-database join or a foreign key into the primary DB (see
// docs/distributed-ingestion-routing-master-prompt.md — "Log DB lookup
// snapshot"). The primary DB stays the single source of truth; a stale or
// missing snapshot never blocks ingestion, and each sync is fire-and-forget.
// ─────────────────────────────────────────────────────────────────────────────

interface ProjectLookupSourceRow extends QueryResultRow {
  project_id: string;
  organization_id: string;
  name: string;
  slug: string;
  status: string;
  deleted_at: Date | null;
}

const PROJECT_LOOKUP_SOURCE_SQL = `
  SELECT
    p.id AS project_id,
    p.org_id AS organization_id,
    p.name,
    p.slug,
    p.status,
    p.deleted_at
  FROM projects p
  WHERE p.id = $1
  LIMIT 1`;

const PROJECT_LOOKUP_UPSERT_SQL = `
  INSERT INTO project_lookup (
    project_id,
    organization_id,
    name,
    slug,
    metadata,
    synced_at
  )
  VALUES ($1, $2, $3, $4, $5::jsonb, NOW())
  ON CONFLICT (project_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    metadata = project_lookup.metadata || EXCLUDED.metadata,
    synced_at = NOW()`;

export async function syncProjectLookupToLogDb(
  projectId: string,
  reason: string,
): Promise<boolean> {
  const source = await pool.query<ProjectLookupSourceRow>(
    PROJECT_LOOKUP_SOURCE_SQL,
    [projectId],
  );
  const row = source.rows[0];
  if (!row) {
    lookupLogger.warn({ projectId, reason }, 'Project lookup sync skipped: source row not found');
    return false;
  }

  const metadata = {
    source: 'primary_db',
    reason,
    status: row.status,
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };

  await logDB.queryWithRetry(
    PROJECT_LOOKUP_UPSERT_SQL,
    [row.project_id, row.organization_id, row.name, row.slug, JSON.stringify(metadata)],
    { operation: 'write' },
  );

  lookupLogger.info({ projectId, reason, status: row.status }, 'Project lookup synced to Log DB');
  return true;
}

export function syncProjectLookupToLogDbBestEffort(projectId: string, reason: string): void {
  void syncProjectLookupToLogDb(projectId, reason).catch((err) => {
    lookupLogger.warn(
      { err, projectId, reason },
      'Project lookup sync failed; primary transaction remains committed',
    );
  });
}

interface EnvironmentLookupSourceRow extends QueryResultRow {
  environment_id: string;
  organization_id: string;
  project_id: string;
  name: string;
  slug: string;
  type: string;
  is_default: boolean;
  is_active: boolean;
  deleted_at: Date | null;
}

const ENVIRONMENT_LOOKUP_SOURCE_SQL = `
  SELECT
    e.id AS environment_id,
    e.organization_id,
    e.project_id,
    e.name,
    e.slug,
    e.type,
    e.is_default,
    e.is_active,
    e.deleted_at
  FROM project_environments e
  WHERE e.id = $1
  LIMIT 1`;

const ENVIRONMENT_LOOKUP_UPSERT_SQL = `
  INSERT INTO environment_lookup (
    environment_id,
    organization_id,
    project_id,
    name,
    slug,
    metadata,
    synced_at
  )
  VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
  ON CONFLICT (environment_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    project_id = EXCLUDED.project_id,
    name = EXCLUDED.name,
    slug = EXCLUDED.slug,
    metadata = environment_lookup.metadata || EXCLUDED.metadata,
    synced_at = NOW()`;

export async function syncEnvironmentLookupToLogDb(
  environmentId: string,
  reason: string,
): Promise<boolean> {
  const source = await pool.query<EnvironmentLookupSourceRow>(
    ENVIRONMENT_LOOKUP_SOURCE_SQL,
    [environmentId],
  );
  const row = source.rows[0];
  if (!row) {
    lookupLogger.warn({ environmentId, reason }, 'Environment lookup sync skipped: source row not found');
    return false;
  }

  const metadata = {
    source: 'primary_db',
    reason,
    type: row.type,
    isDefault: row.is_default,
    isActive: row.is_active,
    deletedAt: row.deleted_at?.toISOString() ?? null,
  };

  await logDB.queryWithRetry(
    ENVIRONMENT_LOOKUP_UPSERT_SQL,
    [
      row.environment_id,
      row.organization_id,
      row.project_id,
      row.name,
      row.slug,
      JSON.stringify(metadata),
    ],
    { operation: 'write' },
  );

  lookupLogger.info({ environmentId, reason }, 'Environment lookup synced to Log DB');
  return true;
}

export function syncEnvironmentLookupToLogDbBestEffort(environmentId: string, reason: string): void {
  void syncEnvironmentLookupToLogDb(environmentId, reason).catch((err) => {
    lookupLogger.warn(
      { err, environmentId, reason },
      'Environment lookup sync failed; primary transaction remains committed',
    );
  });
}

interface ApiKeyLookupSourceRow extends QueryResultRow {
  api_key_id: string;
  organization_id: string;
  project_id: string;
  environment_id: string | null;
  key_prefix: string | null;
  name: string | null;
  status: string | null;
}

const API_KEY_LOOKUP_SOURCE_SQL = `
  SELECT
    k.id AS api_key_id,
    k.organization_id,
    k.project_id,
    k.environment_id,
    k.public_key AS key_prefix,
    k.name,
    k.status
  FROM project_api_keys k
  WHERE k.id = $1
  LIMIT 1`;

const API_KEY_LOOKUP_UPSERT_SQL = `
  INSERT INTO api_key_lookup (
    api_key_id,
    organization_id,
    project_id,
    environment_id,
    key_prefix,
    name,
    status,
    synced_at
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
  ON CONFLICT (api_key_id) DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    project_id = EXCLUDED.project_id,
    environment_id = EXCLUDED.environment_id,
    key_prefix = EXCLUDED.key_prefix,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    synced_at = NOW()`;

export async function syncApiKeyLookupToLogDb(
  apiKeyId: string,
  reason: string,
): Promise<boolean> {
  const source = await pool.query<ApiKeyLookupSourceRow>(
    API_KEY_LOOKUP_SOURCE_SQL,
    [apiKeyId],
  );
  const row = source.rows[0];
  if (!row) {
    lookupLogger.warn({ apiKeyId, reason }, 'API key lookup sync skipped: source row not found');
    return false;
  }

  await logDB.queryWithRetry(
    API_KEY_LOOKUP_UPSERT_SQL,
    [
      row.api_key_id,
      row.organization_id,
      row.project_id,
      row.environment_id,
      row.key_prefix,
      row.name,
      row.status,
    ],
    { operation: 'write' },
  );

  lookupLogger.info({ apiKeyId, reason, status: row.status }, 'API key lookup synced to Log DB');
  return true;
}

export function syncApiKeyLookupToLogDbBestEffort(apiKeyId: string, reason: string): void {
  void syncApiKeyLookupToLogDb(apiKeyId, reason).catch((err) => {
    lookupLogger.warn(
      { err, apiKeyId, reason },
      'API key lookup sync failed; primary transaction remains committed',
    );
  });
}
