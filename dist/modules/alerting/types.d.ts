/**
 * Alerting module â€” types, Zod schemas, DB row types, DTOs, and errors.
 *
 * Conventions (matching connectors/organization modules):
 *   - Zod schemas drive request validation and enum parity with Postgres.
 *   - DB rows are snake_case; response DTOs are camelCase.
 *   - Module errors extend the shared AppError for uniform HTTP mapping.
 *   - Enums match migrations2/003_alerting_create_core_schema.up.sql exactly.
 */
import { z } from 'zod';
import { AppError } from '../../shared/errors/app-error.js';
export declare const UuidSchema: z.ZodString;
export declare const OrgIdParamsSchema: z.ZodObject<{
    orgId: z.ZodString;
}, z.core.$strip>;
export declare const PaginationSchema: z.ZodObject<{
    limit: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    offset: z.ZodDefault<z.ZodCoercedNumber<unknown>>;
    sortBy: z.ZodOptional<z.ZodString>;
    sortOrder: z.ZodDefault<z.ZodEnum<{
        asc: "asc";
        desc: "desc";
    }>>;
}, z.core.$strip>;
export interface RequestMeta {
    actorUserId: string;
    actorIp: string;
    actorUserAgent: string | null;
    requestId: string;
}
export declare class AlertError extends AppError {
    constructor(message: string, code?: string, statusCode?: number, details?: Record<string, unknown>);
}
export declare class AlertNotFoundError extends AlertError {
    constructor(resource?: string);
}
export declare class AlertConflictError extends AlertError {
    constructor(message: string);
}
export declare class AlertValidationError extends AlertError {
    constructor(message: string, details?: Record<string, unknown>);
}
export * from "./rules/rules.types.js";
export * from "./events/events.types.js";
export * from "./silences/silences.types.js";
export * from "./policies/policies.types.js";
export * from "./templates/templates.types.js";
export * from "./routing/routing.types.js";
export * from "./metrics/metrics.types.js";
//# sourceMappingURL=types.d.ts.map