/**
 * Requests explorer resource (Phase 5). Backed by `events_requests`.
 *
 * Exposes the full request column set from the architecture doc plus latency
 * statistics and traffic summary. Ingestion keeps this table intentionally
 * light on synchronous indexes; explorers should prefer tenant/time-bounded
 * scans and rollups unless a query earns a dedicated index with EXPLAIN proof.
 * The generated `is_error`/`is_slow` columns power error timelines.
 */
import type { ExplorerResource } from '../query-engine/field-registry.js';
export declare const requestsResource: ExplorerResource;
//# sourceMappingURL=requests.resource.d.ts.map