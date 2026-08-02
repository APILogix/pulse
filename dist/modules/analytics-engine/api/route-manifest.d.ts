/**
 * Route manifest for /analytics/v2.
 *
 * Kept dependency-free on purpose: tests and documentation checks import this
 * without pulling in Fastify, the database pools, or the auth middleware.
 *
 * Source of truth: docs/analytics/08-dashboard-api-contracts.md §3.
 */
/** Routes registered under BOTH `/org/:orgId` and `/projects/:projectId`. */
export declare const ANALYTICS_V2_SCOPED_ROUTES: readonly ["/requests/summary", "/requests/series", "/requests/status-distribution", "/requests/latency-histogram", "/endpoints", "/endpoints/slowest", "/errors/summary", "/errors/groups", "/logs/summary", "/traces/summary", "/services", "/overview"];
/** Routes registered once, outside the scoped prefixes. */
export declare const ANALYTICS_V2_GLOBAL_ROUTES: readonly ["/org/:orgId/projects/health", "/system/health"];
export type AnalyticsV2ScopedRoute = (typeof ANALYTICS_V2_SCOPED_ROUTES)[number];
export type AnalyticsV2GlobalRoute = (typeof ANALYTICS_V2_GLOBAL_ROUTES)[number];
/** Fully-qualified paths, for contract assertions. */
export declare function analyticsV2Paths(prefix?: string): string[];
//# sourceMappingURL=route-manifest.d.ts.map