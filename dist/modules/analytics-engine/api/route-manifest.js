/**
 * Route manifest for /analytics/v2.
 *
 * Kept dependency-free on purpose: tests and documentation checks import this
 * without pulling in Fastify, the database pools, or the auth middleware.
 *
 * Source of truth: docs/analytics/08-dashboard-api-contracts.md §3.
 */
/** Routes registered under BOTH `/org/:orgId` and `/projects/:projectId`. */
export const ANALYTICS_V2_SCOPED_ROUTES = [
    '/requests/summary',
    '/requests/series',
    '/requests/status-distribution',
    '/requests/latency-histogram',
    '/endpoints',
    '/endpoints/slowest',
    '/errors/summary',
    '/errors/groups',
    '/logs/summary',
    '/traces/summary',
    '/services',
    '/overview',
];
/** Routes registered once, outside the scoped prefixes. */
export const ANALYTICS_V2_GLOBAL_ROUTES = [
    '/org/:orgId/projects/health',
    '/system/health',
];
/** Fully-qualified paths, for contract assertions. */
export function analyticsV2Paths(prefix = '/analytics/v2') {
    const scoped = ANALYTICS_V2_SCOPED_ROUTES.flatMap((route) => [
        `${prefix}/org/:orgId${route}`,
        `${prefix}/projects/:projectId${route}`,
    ]);
    const global = ANALYTICS_V2_GLOBAL_ROUTES.map((route) => `${prefix}${route}`);
    return [...scoped, ...global];
}
//# sourceMappingURL=route-manifest.js.map