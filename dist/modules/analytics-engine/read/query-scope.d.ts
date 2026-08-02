/**
 * Query parsing + validation for the /analytics/v2 read API.
 *
 * Contract: docs/analytics/08-dashboard-api-contracts.md §1
 *
 * Everything the client can influence is validated and normalised here, so the
 * repositories receive a trusted, fully-resolved scope. Sort columns are checked
 * against a per-route allowlist because they are interpolated into SQL.
 */
import { type AnalyticsQueryScope } from '../types.js';
export declare class AnalyticsQueryError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: Record<string, unknown> | undefined;
    constructor(code: string, message: string, statusCode?: number, details?: Record<string, unknown> | undefined);
}
export interface RawQuery {
    from?: string | undefined;
    to?: string | undefined;
    range?: string | undefined;
    window?: string | undefined;
    environment?: string | undefined;
    compare?: string | undefined;
    service?: string | undefined;
    release?: string | undefined;
    limit?: string | undefined;
    cursor?: string | undefined;
    sort?: string | undefined;
    q?: string | undefined;
    format?: string | undefined;
}
export interface ParseScopeOptions {
    organizationId: string;
    projectId?: string | null;
    /** Allowed sort columns for the route; empty disables sorting. */
    sortable?: readonly string[];
    defaultSort?: {
        column: string;
        direction: 'asc' | 'desc';
    };
    defaultLimit?: number;
    maxLimit?: number;
    now?: Date;
}
/** Validated environment, or the cross-environment sentinel. */
export declare function parseEnvironment(value: string | undefined): string;
export declare function parseSort(value: string | undefined, sortable: readonly string[], fallback?: {
    column: string;
    direction: 'asc' | 'desc';
}): {
    column: string;
    direction: 'asc' | 'desc';
} | undefined;
/**
 * Resolves the full query scope.
 *
 * `from`/`to` are floored to the selected window before being returned, which is
 * what makes cache keys stable (the v1 API's implicit `to = new Date()` produced
 * a unique key per millisecond).
 */
export declare function parseScope(raw: RawQuery, options: ParseScopeOptions): AnalyticsQueryScope;
/** The project_id value to filter rollups by, honouring the org-wide sentinel. */
export declare function projectFilter(scope: AnalyticsQueryScope): string;
/** Stable cache key. Range is already window-floored by parseScope's callers. */
export declare function cacheKeyFor(route: string, scope: AnalyticsQueryScope, extra?: string): string;
export declare function isCsvRequested(raw: RawQuery): boolean;
//# sourceMappingURL=query-scope.d.ts.map