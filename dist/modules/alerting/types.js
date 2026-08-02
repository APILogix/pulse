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
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ENUMS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// COMMON PARAM / PAGINATION SCHEMAS
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export const UuidSchema = z.string().uuid();
export const OrgIdParamsSchema = z.object({ orgId: UuidSchema });
export const PaginationSchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
    sortBy: z.string().max(50).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// ERROR CLASSES
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
export class AlertError extends AppError {
    constructor(message, code = 'ALERT_ERROR', statusCode = 400, details) {
        super(message, code, statusCode, details);
    }
}
export class AlertNotFoundError extends AlertError {
    constructor(resource = 'Alert resource') {
        super(`${resource} not found`, 'ALERT_NOT_FOUND', 404);
    }
}
export class AlertConflictError extends AlertError {
    constructor(message) {
        super(message, 'ALERT_CONFLICT', 409);
    }
}
export class AlertValidationError extends AlertError {
    constructor(message, details) {
        super(message, 'ALERT_VALIDATION_ERROR', 422, details);
    }
}
export * from "./rules/rules.types.js";
export * from "./events/events.types.js";
export * from "./silences/silences.types.js";
export * from "./policies/policies.types.js";
export * from "./templates/templates.types.js";
export * from "./routing/routing.types.js";
export * from "./metrics/metrics.types.js";
//# sourceMappingURL=types.js.map