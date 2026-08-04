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
    /** Resolve role + plan retention and assemble the {@link QueryContext}. */
    async resolve(input) {
        const [role, planKey] = await Promise.all([
            this.resolveRole(input.organizationId, input.userId),
            this.resolvePlan(input.organizationId),
        ]);
        const retentionDays = PLAN_RETENTION_DAYS[planKey] ?? DEFAULT_RETENTION_DAYS;
        const retentionFloor = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
        const ctx = {
            organizationId: input.organizationId,
            role,
            plan: planKey,
            retentionFloor,
        };
        if (input.projectId !== undefined)
            ctx.projectId = input.projectId;
        if (input.environment !== undefined)
            ctx.environment = input.environment;
        return ctx;
    }
    /** Role from the org membership row (same source as `requireOrgAccess`). */
    async resolveRole(organizationId, userId) {
        const result = await this.pool.query(`SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [organizationId, userId]);
        return result.rows[0]?.role ?? 'member';
    }
    /**
     * Best-effort plan resolution. Retention is a refinement, not a gate, so a
     * schema mismatch or missing plan must never break exploration — it falls
     * back to the default retention window.
     */
    async resolvePlan(organizationId) {
        try {
            const result = await this.pool.query(`SELECT plan_key FROM organizations WHERE id = $1 LIMIT 1`, [organizationId]);
            const planKey = result.rows[0]?.plan_key;
            return typeof planKey === 'string' && planKey.length > 0 ? planKey.toLowerCase() : 'pro';
        }
        catch {
            return 'pro';
        }
    }
}
//# sourceMappingURL=context.js.map