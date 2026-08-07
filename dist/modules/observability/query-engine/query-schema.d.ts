/**
 * HTTP → DSL translation. Validates raw query parameters (all strings on the
 * wire) and produces a typed {@link ExplorerQuery}. This is the only place raw
 * request input becomes a query object; the engine trusts what comes out.
 */
import { z } from 'zod';
import type { ExplorerQuery, SortClause, TimeRange } from './types.js';
export declare const RANGE_MS: Record<string, number>;
/** Raw, wire-level query parameters shared by every explorer list endpoint. */
export declare const RawExplorerQuerySchema: z.ZodObject<{
    search: z.ZodOptional<z.ZodString>;
    from: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    to: z.ZodOptional<z.ZodCoercedDate<unknown>>;
    range: z.ZodOptional<z.ZodEnum<{
        "1h": "1h";
        "15m": "15m";
        "6h": "6h";
        "24h": "24h";
        "7d": "7d";
        "30d": "30d";
        "90d": "90d";
    }>>;
    environment: z.ZodOptional<z.ZodString>;
    sort: z.ZodOptional<z.ZodString>;
    cursor: z.ZodOptional<z.ZodString>;
    direction: z.ZodDefault<z.ZodEnum<{
        forward: "forward";
        backward: "backward";
    }>>;
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    filters: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
/** Reject tenant and projection controls before endpoint-specific handling. */
export declare function assertPublicExplorerQuery(input: unknown): void;
export type RawExplorerQuery = z.infer<typeof RawExplorerQuerySchema>;
/** Resolve explicit from/to or a named range into a concrete window. */
export declare function resolveTimeRange(raw: {
    from?: Date;
    to?: Date;
    range?: string;
}): TimeRange;
/**
 * Build a validated {@link ExplorerQuery} from raw request query params.
 * `defaultSort` comes from the resource so each explorer keeps its natural
 * ordering (usually time DESC).
 */
export declare function buildExplorerQuery(rawInput: unknown, defaultSort: SortClause): ExplorerQuery;
//# sourceMappingURL=query-schema.d.ts.map