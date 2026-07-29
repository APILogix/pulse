/**
 * The canonical typed-ingestion routes. One entry per SDK event family. Order
 * is only significant for deterministic registration/iteration.
 */
export const TYPED_INGEST_ROUTES = [
    { path: "/v1/errors", type: "error" },
    { path: "/v1/requests", type: "request" },
    { path: "/v1/traces", type: "trace" },
    { path: "/v1/spans", type: "span" },
    { path: "/v1/metrics", type: "metric" },
    { path: "/v1/logs", type: "log" },
    { path: "/v1/profiles", type: "profile" },
    { path: "/v1/events", type: "message" },
    { path: "/v1/checkins", type: "cron_checkin" },
    { path: "/v1/replays", type: "replay" },
];
/** Fast reverse lookup: public path suffix -> accepted SDK event type. */
export const TYPED_INGEST_ROUTE_BY_PATH = new Map(TYPED_INGEST_ROUTES.map((route) => [route.path, route.type]));
/** All public path suffixes exposed as typed ingestion endpoints. */
export const TYPED_INGEST_PATHS = TYPED_INGEST_ROUTES.map((route) => route.path);
//# sourceMappingURL=route-table.js.map