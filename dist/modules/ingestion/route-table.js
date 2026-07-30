/**
 * The canonical typed-ingestion routes. One entry per SDK event family. Order
 * is only significant for deterministic registration/iteration.
 */
export const TYPED_INGEST_ROUTES = [
    { path: "/v1/errors", type: "error", routeKey: "errors" },
    { path: "/v1/requests", type: "request", routeKey: "requests" },
    { path: "/v1/traces", type: "trace", routeKey: "traces" },
    { path: "/v1/spans", type: "span", routeKey: "spans" },
    { path: "/v1/metrics", type: "metric", routeKey: "metrics" },
    { path: "/v1/logs", type: "log", routeKey: "logs" },
    { path: "/v1/profiles", type: "profile", routeKey: "profiles" },
    { path: "/v1/events", type: "message", routeKey: "events" },
    { path: "/v1/checkins", type: "cron_checkin", routeKey: "crons" },
    { path: "/v1/replays", type: "replay", routeKey: "replays" },
];
/** Fast reverse lookup: public path suffix -> accepted SDK event type. */
export const TYPED_INGEST_ROUTE_BY_PATH = new Map(TYPED_INGEST_ROUTES.map((route) => [route.path, route.type]));
/** All public path suffixes exposed as typed ingestion endpoints. */
export const TYPED_INGEST_PATHS = TYPED_INGEST_ROUTES.map((route) => route.path);
/** Transport route keys in the same deterministic order as route registration. */
export const TYPED_INGEST_ROUTE_KEYS = TYPED_INGEST_ROUTES.map((route) => route.routeKey);
//# sourceMappingURL=route-table.js.map