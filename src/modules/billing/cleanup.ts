import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';

const ORG_USAGE_ROLLUP_SQL = `
INSERT INTO usage_daily_counters (
  org_id,
  project_id,
  date,
  events_count,
  ai_analyses_count,
  updated_at
)
SELECT
  pu.org_id,
  pu.project_id,
  pu.period_start::date AS date,
  COALESCE(SUM(pu.value) FILTER (WHERE pu.counter_type = 'events_accepted'), 0)::bigint AS events_count,
  COALESCE(SUM(pu.value) FILTER (WHERE pu.counter_type = 'ai_analyses'), 0)::integer AS ai_analyses_count,
  NOW() AS updated_at
FROM project_usage pu
WHERE pu.period_start >= $1::timestamptz
  AND pu.period_start < $2::timestamptz
GROUP BY pu.org_id, pu.project_id, pu.period_start::date
ON CONFLICT (org_id, project_id, date)
DO UPDATE SET
  events_count = EXCLUDED.events_count,
  ai_analyses_count = EXCLUDED.ai_analyses_count,
  updated_at = NOW();
`;

export async function runBillingUsageDailyRollup(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
  const result = await db.query(ORG_USAGE_ROLLUP_SQL, [start.toISOString(), end.toISOString()]);
  log.info({ start, end, rows: result.rowCount ?? 0 }, 'billing usage daily rollup complete');
}

export async function runBillingCouponExpiryCleanup(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query(
    `UPDATE coupons
        SET is_active = FALSE, updated_at = NOW()
      WHERE is_active = TRUE
        AND valid_until IS NOT NULL
        AND valid_until < NOW()`,
  );
  log.info({ expired: result.rowCount ?? 0 }, 'billing coupon expiry cleanup complete');
}

export async function runBillingTrialExpiryCheck(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM organization_subscriptions
      WHERE status = 'trialing'
        AND trial_end IS NOT NULL
        AND trial_end < NOW()`,
  );
  log.info(
    { expiredTrials: Number(result.rows[0]?.count ?? 0) },
    'billing trial expiry scan complete; provider downgrade flow still needs service integration',
  );
}

export async function runBillingUsageLimitWarningSweep(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query<{ org_id: string; usage_percent: string }>(
    `WITH current_usage AS (
       SELECT
         s.org_id,
         p.event_limit_monthly,
         COALESCE(SUM(u.events_count), 0) AS events_used
       FROM organization_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN usage_daily_counters u
         ON u.org_id = s.org_id
        AND date_trunc('month', u.date::timestamp) = date_trunc('month', NOW())
       WHERE s.status IN ('trialing', 'active', 'past_due')
         AND p.event_limit_monthly > 0
       GROUP BY s.org_id, p.event_limit_monthly
     )
     SELECT
       org_id,
       ROUND((events_used::numeric / NULLIF(event_limit_monthly, 0)) * 100, 2)::text AS usage_percent
     FROM current_usage
     WHERE events_used >= event_limit_monthly * 0.8`,
  );
  log.info({ flaggedOrgs: result.rowCount ?? 0 }, 'billing usage limit warning sweep complete');
}

export async function runBillingSubscriptionRenewalReconciliation(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM organization_subscriptions
      WHERE status IN ('active', 'trialing', 'past_due')
        AND current_period_end < NOW()`,
  );
  log.info(
    { subscriptionsPastPeriodEnd: Number(result.rows[0]?.count ?? 0) },
    'billing renewal reconciliation scan complete; provider polling not implemented yet',
  );
}

export async function runBillingDunningRetry(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM organization_subscriptions
      WHERE status = 'past_due'`,
  );
  log.info(
    { pastDueSubscriptions: Number(result.rows[0]?.count ?? 0) },
    'billing dunning retry scan complete; retry orchestration not implemented yet',
  );
}

export async function runBillingPlanLimitEnforcementSweep(
  db: Pool,
  log: FastifyBaseLogger,
): Promise<void> {
  const result = await db.query<{ count: string }>(
    `WITH current_usage AS (
       SELECT
         s.org_id,
         p.event_limit_monthly,
         p.hard_cap,
         COALESCE(SUM(u.events_count), 0) AS events_used
       FROM organization_subscriptions s
       JOIN plans p ON p.id = s.plan_id
       LEFT JOIN usage_daily_counters u
         ON u.org_id = s.org_id
        AND date_trunc('month', u.date::timestamp) = date_trunc('month', NOW())
       WHERE s.status IN ('trialing', 'active', 'past_due')
       GROUP BY s.org_id, p.event_limit_monthly, p.hard_cap
     )
     SELECT COUNT(*)::text AS count
       FROM current_usage
      WHERE hard_cap = TRUE
        AND event_limit_monthly > 0
        AND events_used >= event_limit_monthly`,
  );
  log.info(
    { hardCapOrgsExceeded: Number(result.rows[0]?.count ?? 0) },
    'billing plan limit enforcement sweep complete',
  );
}
