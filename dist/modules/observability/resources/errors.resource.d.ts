/**
 * Errors explorer resource (Phase 6). Backed by `events_errors`.
 * Uses `idx_events_errors_fingerprint_time` for grouping/triage filters.
 *
 * Fields are defined explicitly against the `events_errors` schema in
 * `database/migrations/logdb/03_observability_v2/002_events_errors.sql`. We do
 * NOT spread `commonFields` here because that set assumes columns (tenant_id,
 * duration_ms, name, endpoint, attributes) that do not exist on this table.
 */
import type { ExplorerResource } from '../query-engine/field-registry.js';
export declare const errorsResource: ExplorerResource;
//# sourceMappingURL=errors.resource.d.ts.map