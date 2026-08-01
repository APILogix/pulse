/**
 * Query Engine errors. All extend the shared {@link AppError} so the global
 * Fastify error handler maps them to the right status + envelope.
 */
import { AppError } from '../../../shared/errors/app-error.js';

/** Client supplied an invalid filter/search/sort/field/cursor (HTTP 400). */
export class QueryValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'EXPLORER_QUERY_INVALID', 400, details);
  }
}

/** Requested resource / entity does not exist (HTTP 404). */
export class ExplorerNotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 'EXPLORER_NOT_FOUND', 404);
  }
}

/** Unknown explorer resource name (HTTP 404). */
export class UnknownResourceError extends AppError {
  constructor(name: string) {
    super(`Unknown explorer resource: ${name}`, 'EXPLORER_UNKNOWN_RESOURCE', 404, { name });
  }
}
