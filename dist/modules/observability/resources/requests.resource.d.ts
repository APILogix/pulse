/**
 * Requests explorer resource (Phase 5). Backed by `events_requests`.
 *
 * Exposes the full request column set from the architecture doc plus latency
 * statistics and traffic summary. Filtering leans on the composite
 * `idx_events_requests_tenant_env_time`, `_route_time`, and `_user_time`
 * indexes; the generated `is_error`/`is_slow` columns power error timelines.
 */
import type { ExplorerResource } from '../query-engine/field-registry.js';
export declare const requestsResource: ExplorerResource;
//# sourceMappingURL=requests.resource.d.ts.map