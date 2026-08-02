/**
 * Enterprise error base classes.
 *
 * All module-specific errors extend AppError for consistent handling,
 * structured logging, and Fastify error mapping.
 */
export class AppError extends Error {
    statusCode;
    code;
    isOperational;
    details;
    constructor(message, code, statusCode, details, isOperational = true) {
        super(message);
        this.name = this.constructor.name;
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.isOperational = isOperational;
        Error.captureStackTrace(this, this.constructor);
    }
}
export class NotFoundError extends AppError {
    constructor(resource) {
        super(`${resource} not found`, 'NOT_FOUND', 404);
    }
}
export class ConflictError extends AppError {
    constructor(message, details) {
        super(message, 'CONFLICT', 409, details);
    }
}
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', code = 'UNAUTHORIZED') {
        super(message, code, 401);
    }
}
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', code = 'FORBIDDEN') {
        super(message, code, 403);
    }
}
export class ValidationError extends AppError {
    constructor(message, details) {
        super(message, 'VALIDATION_ERROR', 400, details);
    }
}
export class RateLimitError extends AppError {
    constructor(message = 'Rate limit exceeded', retryAfter) {
        super(message, 'RATE_LIMITED', 429, retryAfter ? { retryAfter } : undefined);
    }
}
export class ServiceUnavailableError extends AppError {
    constructor(message = 'Service temporarily unavailable') {
        super(message, 'SERVICE_UNAVAILABLE', 503);
    }
}
export class InternalError extends AppError {
    constructor(message = 'Internal server error', details) {
        super(message, 'INTERNAL_ERROR', 500, details, false);
    }
}
//# sourceMappingURL=app-error.js.map