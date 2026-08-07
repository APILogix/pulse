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
export interface ResolveContextInput {
    organizationId: string;
    userId: string;
    environment?: string | undefined;
}
export declare class ObservabilityContextResolver {
    private readonly pool;
    constructor(pool: Pool);
    /** Resolve role, visible projects, and plan retention for one request. */
    resolve(input: ResolveContextInput): Promise<QueryContext>;
    /** Role from the active org membership row (same source as `requireOrgAccess`). */
    private resolveRole;
    /**
     * Resolve project visibility from server-side membership only. The empty
     * array is intentional: it prevents an organization with no visible
     * projects from becoming an unscoped telemetry query.
     */
    private resolveAllowedProjectIds;
    /**
     * Best-effort plan resolution. Retention is a refinement, not a gate, so a
     * schema mismatch or missing plan must never break exploration — it falls
     * back to the default retention window.
     */
    private resolvePlan;
}
//# sourceMappingURL=context.d.ts.map