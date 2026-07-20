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
import { FEATURE_FLAGS, type FeatureFlagContext, type FeatureFlagRow, type SetFlagInput } from './types.js';
export { FEATURE_FLAGS };
export type { FeatureFlagContext, FeatureFlagRow, SetFlagInput };
interface CachedFlagValue {
    enabled: boolean;
}
/** In-process flag cache with explicit invalidation (mirrors lrucashe.ts). */
export declare const flagCache: LRUCache<string, CachedFlagValue> & {
    invalidate(key: string, ctx?: FeatureFlagContext): void;
};
/**
 * Whether a flag is enabled for the given context. Most specific existing row
 * wins (project > organization > platform); no row anywhere → false.
 */
export declare function isEnabled(key: string, ctx?: FeatureFlagContext): Promise<boolean>;
/**
 * Upsert a flag value. The unique index is
 * `uq_feature_flags_key_scope ON (key, scope, scope_id) NULLS NOT DISTINCT`,
 * so a plain ON CONFLICT arbiter is awkward across Postgres versions — do
 * INSERT ... ON CONFLICT DO NOTHING, then UPDATE when the row already exists
 * (single transaction; scope_id matched with IS NOT DISTINCT FROM so the
 * platform-scope NULL compares correctly).
 */
export declare function setFlag(input: SetFlagInput): Promise<void>;
//# sourceMappingURL=service.d.ts.map