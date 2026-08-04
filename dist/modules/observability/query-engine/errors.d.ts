/**
 * Query Engine errors. All extend the shared {@link AppError} so the global
 * Fastify error handler maps them to the right status + envelope.
 */
import { AppError } from '../../../shared/errors/app-error.js';
/** Client supplied an invalid filter/search/sort/field/cursor (HTTP 400). */
export declare class QueryValidationError extends AppError {
    constructor(message: string, details?: Record<string, unknown>);
}
/** Requested resource / entity does not exist (HTTP 404). */
export declare class ExplorerNotFoundError extends AppError {
    constructor(resource?: string);
}
/** Unknown explorer resource name (HTTP 404). */
export declare class UnknownResourceError extends AppError {
    constructor(name: string);
}
//# sourceMappingURL=errors.d.ts.map