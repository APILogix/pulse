/**
 * Enterprise error base classes.
 *
 * All module-specific errors extend AppError for consistent handling,
 * structured logging, and Fastify error mapping.
 */
export declare abstract class AppError extends Error {
    readonly statusCode: number;
    readonly code: string;
    readonly isOperational: boolean;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, code: string, statusCode: number, details?: Record<string, unknown>, isOperational?: boolean);
}
export declare class NotFoundError extends AppError {
    constructor(resource: string);
}
export declare class ConflictError extends AppError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class UnauthorizedError extends AppError {
    constructor(message?: string, code?: string);
}
export declare class ForbiddenError extends AppError {
    constructor(message?: string, code?: string);
}
export declare class ValidationError extends AppError {
    constructor(message: string, details?: Record<string, unknown>);
}
export declare class RateLimitError extends AppError {
    constructor(message?: string, retryAfter?: number);
}
export declare class ServiceUnavailableError extends AppError {
    constructor(message?: string);
}
export declare class InternalError extends AppError {
    constructor(message?: string, details?: Record<string, unknown>);
}
//# sourceMappingURL=app-error.d.ts.map