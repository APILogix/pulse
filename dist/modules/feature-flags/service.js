/**
 * Feature flag service.
 *
 * Resolution order for isEnabled(): project scope → organization scope →
 * platform scope. The most specific row that EXISTS wins; when no row exists
 * at any scope the flag is OFF (absence falls through to the next scope, not
 * to "enabled").
 *
 * Reads are cached in-process (LRU, 30s TTL — same pattern as
 * config/lrucashe.ts) so hot paths (per-event batch processing) do not hit
 * Postgres every time. setFlag() invalidates the affected entries explicitly.
 */
import { LRUCache } from 'lru-cache';
import { pool } from '../../config/database.js';
import { FEATURE_FLAGS, } from './types.js';
export { FEATURE_FLAGS };
const FLAG_CACHE_TTL_MS = 30_000;
function flagCacheKey(key, ctx) {
    return `${key}:${ctx.organizationId ?? 'org'}:${ctx.projectId ?? 'none'}`;
}
/** In-process flag cache with explicit invalidation (mirrors lrucashe.ts). */
export const flagCache = new LRUCache({
    max: 20000,
    ttl: FLAG_CACHE_TTL_MS,
    updateAgeOnGet: false,
    allowStale: false,
    // Exposed as flagCache.invalidate(...) below.
});
/**
 * Drop cached resolutions for a flag. With `ctx`, only that exact context;
 * without it, every cached context for the flag (LRUCache has no prefix
 * delete, so scan keys — bounded by `max`, same trade-off as lrucashe.ts).
 */
flagCache.invalidate = (key, ctx) => {
    if (ctx) {
        flagCache.delete(flagCacheKey(key, ctx));
        return;
    }
    const prefix = `${key}:`;
    for (const k of flagCache.keys()) {
        if (k.startsWith(prefix))
            flagCache.delete(k);
    }
};
/**
 * Whether a flag is enabled for the given context. Most specific existing row
 * wins (project > organization > platform); no row anywhere → false.
 */
export async function isEnabled(key, ctx = {}) {
    const cacheKey = flagCacheKey(key, ctx);
    const cached = flagCache.get(cacheKey);
    if (cached !== undefined)
        return cached.enabled;
    const r = await pool.query(`SELECT scope, enabled
     FROM feature_flags
     WHERE key = $1
       AND (
         scope = 'platform'
         OR (scope = 'organization' AND scope_id = $2::uuid)
         OR (scope = 'project' AND scope_id = $3::uuid)
       )`, [key, ctx.organizationId ?? null, ctx.projectId ?? null]);
    const byScope = new Map(r.rows.map((row) => [row.scope, row.enabled]));
    const enabled = byScope.get('project') ?? byScope.get('organization') ?? byScope.get('platform') ?? false;
    flagCache.set(cacheKey, { enabled });
    return enabled;
}
/**
 * Upsert a flag value. The unique index is
 * `uq_feature_flags_key_scope ON (key, scope, scope_id) NULLS NOT DISTINCT`,
 * so a plain ON CONFLICT arbiter is awkward across Postgres versions — do
 * INSERT ... ON CONFLICT DO NOTHING, then UPDATE when the row already exists
 * (single transaction; scope_id matched with IS NOT DISTINCT FROM so the
 * platform-scope NULL compares correctly).
 */
export async function setFlag(input) {
    const scopeId = input.scope === 'platform' ? null : input.scopeId ?? null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const inserted = await client.query(`INSERT INTO feature_flags (key, scope, scope_id, enabled, payload, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING
       RETURNING id`, [
            input.key,
            input.scope,
            scopeId,
            input.enabled,
            JSON.stringify(input.payload ?? {}),
            input.description ?? null,
        ]);
        if (!inserted.rows[0]) {
            await client.query(`UPDATE feature_flags
         SET enabled = $4,
             payload = COALESCE($5::jsonb, payload),
             description = COALESCE($6, description)
         WHERE key = $1 AND scope = $2 AND scope_id IS NOT DISTINCT FROM $3`, [
                input.key,
                input.scope,
                scopeId,
                input.enabled,
                input.payload !== undefined ? JSON.stringify(input.payload) : null,
                input.description ?? null,
            ]);
        }
        await client.query('COMMIT');
    }
    catch (e) {
        await client.query('ROLLBACK');
        throw e;
    }
    finally {
        client.release();
    }
    flagCache.invalidate(input.key);
}
//# sourceMappingURL=service.js.map