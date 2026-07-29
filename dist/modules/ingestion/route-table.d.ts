/**
 * Data-driven ingestion route table.
 *
 * Single source of truth for the public, per-SDK-signal write endpoints. The
 * route registration in `routes.ts` iterates this table instead of hand-writing
 * one handler per event type, and the SDK config compiler advertises the SAME
 * path suffixes via `ROUTE_INGEST_PATHS` (schema-v1.ts). Keeping both sides
 * driven from an explicit table is what guarantees the acceptance rule:
 *
 *   "SDK config advertises only routes that exist on the backend."
 *
 * Design decisions (see docs/distributed-ingestion-routing-master-prompt.md):
 *   - Every one of the ten `SdkEventType` families gets exactly ONE dedicated
 *     POST route, so a typed endpoint can strictly reject foreign event types.
 *   - `/v1/events` is the transport route the SDK uses for custom/captured
 *     messages, so it maps to the `message` family. It is a typed route, not a
 *     mixed batch endpoint — mixed batches use the legacy `POST /v1/ingest`.
 *   - `/v1/spans` is exposed even though the schema-v1 `ROUTE_INGEST_PATHS`
 *     set does not advertise a spans transport (spans normally travel inside a
 *     trace envelope); the dedicated route lets SDKs stream spans directly and
 *     keeps "each event type has a dedicated POST route" true.
 *
 * This module imports `SdkEventType` as a TYPE ONLY, so it has zero runtime
 * dependencies and can be imported by lightweight unit tests without pulling in
 * env parsing, the queue layer, or a database pool.
 */
import type { SdkEventType } from "./pipeline/event-normalizer.js";
export interface TypedIngestRoute {
    /**
     * Public path suffix registered under the ingestion module prefix (`/api`),
     * e.g. the suffix `/v1/errors` becomes `POST /api/v1/errors` at runtime.
     */
    readonly path: string;
    /** The single SDK event family this endpoint accepts. */
    readonly type: SdkEventType;
}
/**
 * The canonical typed-ingestion routes. One entry per SDK event family. Order
 * is only significant for deterministic registration/iteration.
 */
export declare const TYPED_INGEST_ROUTES: readonly TypedIngestRoute[];
/** Fast reverse lookup: public path suffix -> accepted SDK event type. */
export declare const TYPED_INGEST_ROUTE_BY_PATH: ReadonlyMap<string, SdkEventType>;
/** All public path suffixes exposed as typed ingestion endpoints. */
export declare const TYPED_INGEST_PATHS: readonly string[];
//# sourceMappingURL=route-table.d.ts.map