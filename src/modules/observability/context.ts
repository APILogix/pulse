/**
 * QueryContext resolution (Phase 18 — permissions).
 *
 * Resolves the tenant + permission context once per request so controllers
 * never re-derive org/project/environment/role/plan/retention. Membership is
 * already asserted by `requireOrgAccess`; this adds the role, plan, and the
 * retention floor the engine clamps every time window to.
 *
 * Control-plane identity lives in the primary DB (`config/database.ts`); this
 * resolver reads it there and stays Redis-free (short-lived per-request use).
 */
import type { Pool } from 'pg';
import type { QueryContext } from './query-engine/index.js';

/** Retention window (days) the plan grants for raw event exploration. */
const PLAN_RETENTION_DAYS: Record<string, number> = {
  free: 7,
  starter: 30,
  pro: 90,
  business: 180,
  enterprise: 400,
};
const DEFAULT_RETENTION_DAYS = 90;

export interface ResolveContextInput {
  organizationId: string;
  userId: string;
  projectId?: string | undefined;
  environment?: string | undefined;
}

export class ObservabilityContextResolver {
  constructor(private readonly pool: Pool) {}

  /** Resolve role + plan retention and assemble the {@link QueryContext}. */
  async resolve(input: ResolveContextInput): Promise<QueryContext> {
    const [role, planKey] = await Promise.all([
      this.resolveRole(input.organizationId, input.userId),
      this.resolvePlan(input.organizationId),
    ]);

    const retentionDays = PLAN_RETENTION_DAYS[planKey] ?? DEFAULT_RETENTION_DAYS;
    const retentionFloor = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

    const ctx: QueryContext = {
      organizationId: input.organizationId,
      userId: input.userId,
      role,
      plan: planKey,
      retentionFloor,
    };
    if (input.projectId !== undefined) ctx.projectId = input.projectId;
    if (input.environment !== undefined) ctx.environment = input.environment;
    return ctx;
  }

  /** Role from the org membership row (same source as `requireOrgAccess`). */
  private async resolveRole(organizationId: string, userId: string): Promise<string> {
    const result = await this.pool.query<{ role: string }>(
      `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
      [organizationId, userId],
    );
    return result.rows[0]?.role ?? 'member';
  }

  /**
   * Best-effort plan resolution. Retention is a refinement, not a gate, so a
   * schema mismatch or missing plan must never break exploration — it falls
   * back to the default retention window.
   */
  private async resolvePlan(organizationId: string): Promise<string> {
    try {
      const result = await this.pool.query<{ plan_key: string | null }>(
        `SELECT plan_key FROM organizations WHERE id = $1 LIMIT 1`,
        [organizationId],
      );
      const planKey = result.rows[0]?.plan_key;
      return typeof planKey === 'string' && planKey.length > 0 ? planKey.toLowerCase() : 'pro';
    } catch {
      return 'pro';
    }
  }
}
