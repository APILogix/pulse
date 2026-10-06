/** Retention window (days) the plan grants for raw event exploration. */
const PLAN_RETENTION_DAYS = {
    free: 7,
    starter: 30,
    pro: 90,
    business: 180,
    enterprise: 400,
};
const DEFAULT_RETENTION_DAYS = 90;
export class ObservabilityContextResolver {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    /** Resolve role, visible projects, and plan retention for one request. */
    async resolve(input) {
        const [role, planKey, allowedProjectIds] = await Promise.all([
            this.resolveRole(input.organizationId, input.userId),
            this.resolvePlan(input.organizationId),
            this.resolveAllowedProjectIds(input.organizationId, input.userId),
        ]);
        const retentionDays = PLAN_RETENTION_DAYS[planKey] ?? DEFAULT_RETENTION_DAYS;
        const retentionFloor = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const ctx = {
            organizationId: input.organizationId,
            userId: input.userId,
            role,
            plan: planKey,
            retentionFloor,
            allowedProjectIds,
        };
        if (input.environment !== undefined)
            ctx.environment = input.environment;
        return ctx;
    }
    /** Role from the active org membership row (same source as `requireOrgAccess`). */
    async resolveRole(organizationId, userId) {
        const result = await this.pool.query(`SELECT role
         FROM organization_members
        WHERE org_id = $1 AND user_id = $2 AND status = 'active'
        LIMIT 1`, [organizationId, userId]);
        return result.rows[0]?.role ?? 'member';
    }
    /**
     * Resolve project visibility from server-side membership only. The empty
     * array is intentional: it prevents an organization with no visible
     * projects from becoming an unscoped telemetry query.
     */
    async resolveAllowedProjectIds(organizationId, userId) {
        const result = await this.pool.query(`SELECT p.id
         FROM projects p
        WHERE p.org_id = $1
          AND p.deleted_at IS NULL
          AND (
            EXISTS (
              SELECT 1
                FROM organization_members om
               WHERE om.org_id = p.org_id
                 AND om.user_id = $2
                 AND om.status = 'active'
                 AND om.role IN ('owner', 'admin')
            )
            OR EXISTS (
              SELECT 1
                FROM project_members pm
               WHERE pm.project_id = p.id
                 AND pm.organization_id = p.org_id
                 AND pm.user_id = $2
                 AND pm.status = 'active'
            )
          )
        ORDER BY p.id ASC`, [organizationId, userId]);
        return result.rows.map((row) => row.id);
    }
    /**
     * Best-effort plan resolution. Retention is a refinement, not a gate, so a
     * schema mismatch or missing plan must never break exploration — it falls
     * back to the default retention window.
     */
    async resolvePlan(organizationId) {
        try {
            const result = await this.pool.query(`SELECT plan_key FROM v_subscription_summary WHERE organization_id = $1 LIMIT 1`, [organizationId]);
            const planKey = result.rows[0]?.plan_key;
            return typeof planKey === 'string' && planKey.length > 0 ? planKey.toLowerCase() : 'pro';
        }
        catch {
            return 'pro';
        }
    }
}
//# sourceMappingURL=context.js.map