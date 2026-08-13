import { ERROR_CODES } from './error-codes.js';

/**
 * Enterprise error base classes.
 *
 * All module-specific errors extend AppError for consistent handling,
 * structured logging, and Fastify error mapping.
 */
export abstract class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;
  public readonly details?: Record<string, unknown> | undefined;

  constructor(
    message: string,
    code: string = ERROR_CODES.INTERNAL_ERROR.code,
    statusCode: number = 500,
    details?: Record<string, unknown>,
    isOperational = true
  ) {
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
  constructor(resource: string) {
    super(
      `${resource} not found`,
      ERROR_CODES.NOT_FOUND.code,
      ERROR_CODES.NOT_FOUND.status
    );
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      ERROR_CODES.RESOURCE_CONFLICT.code,
      ERROR_CODES.RESOURCE_CONFLICT.status,
      details
    );
  }
}

export class UnauthorizedError extends AppError {
  constructor(
    message: string = ERROR_CODES.AUTHENTICATION_REQUIRED.message,
    code: string = ERROR_CODES.AUTHENTICATION_REQUIRED.code
  ) {
    super(message, code, ERROR_CODES.AUTHENTICATION_REQUIRED.status);
  }
}

export class ForbiddenError extends AppError {
  constructor(
    message: string = ERROR_CODES.FORBIDDEN.message,
    code: string = ERROR_CODES.FORBIDDEN.code
  ) {
    super(message, code, ERROR_CODES.FORBIDDEN.status);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      ERROR_CODES.VALIDATION_ERROR.code,
      ERROR_CODES.VALIDATION_ERROR.status,
      details
    );
  }
}

export class RateLimitError extends AppError {
  constructor(
    message: string = ERROR_CODES.RATE_LIMIT_EXCEEDED.message,
    retryAfterSeconds?: number
  ) {
    super(
      message,
      ERROR_CODES.RATE_LIMIT_EXCEEDED.code,
      ERROR_CODES.RATE_LIMIT_EXCEEDED.status,
      retryAfterSeconds ? { retryAfterSeconds } : undefined
    );
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(
      message,
      ERROR_CODES.QUOTA_EXCEEDED.code,
      ERROR_CODES.QUOTA_EXCEEDED.status,
      details
    );
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = ERROR_CODES.SERVICE_UNAVAILABLE.message) {
    super(
      message,
      ERROR_CODES.SERVICE_UNAVAILABLE.code,
      ERROR_CODES.SERVICE_UNAVAILABLE.status
    );
  }
}

export class InternalError extends AppError {
  constructor(message: string = ERROR_CODES.INTERNAL_ERROR.message, details?: Record<string, unknown>) {
    super(
      message,
      ERROR_CODES.INTERNAL_ERROR.code,
      ERROR_CODES.INTERNAL_ERROR.status,
      details,
      false
    );
  }
}
