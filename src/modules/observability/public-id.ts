/**
 * Observability public-id validation local to the module.
 *
 * The route `GET /organizations/:orgId/observability/:resource/:id` accepts the
 * id as either a UUID or a public id. For request-event detail we require the
 * caller to use the public id (REQ-...), so we expose a strict, module-local
 * validator that keeps the format check inside the observability boundary.
 */
import { isPublicId } from '../../shared/utils/public-id-generator.js';

export { isPublicId as isObservabilityPublicId };

/** Narrow check: the value must be a canonical request public id (REQ-...). */
export function isRequestPublicId(value: string): boolean {
  return isPublicId(value) && value.toUpperCase().startsWith('REQ-');
}

/** Throws when the value is not a request public id. */
export function assertRequestPublicId(id: string): void {
  if (!isRequestPublicId(id)) {
    throw new Error(`Invalid request public id: ${id}`);
  }
}

/** Narrow check: the value must be a canonical error public id (ERR-...). */
export function isErrorPublicId(value: string): boolean {
  return isPublicId(value) && value.toUpperCase().startsWith('ERR-');
}

/** Throws when the value is not an error public id. */
export function assertErrorPublicId(id: string): void {
  if (!isErrorPublicId(id)) {
    throw new Error(`Invalid error public id: ${id}`);
  }
}

/** Narrow check: the value must be a canonical error group public id (ISS-...). */
export function isErrorGroupPublicId(value: string): boolean {
  return isPublicId(value) && value.toUpperCase().startsWith('ISS-');
}

/** Throws when the value is not an error group public id. */
export function assertErrorGroupPublicId(id: string): void {
  if (!isErrorGroupPublicId(id)) {
    throw new Error(`Invalid error group public id: ${id}`);
  }
}

/** Narrow check: the value must be a canonical trace public id (TRC-...). */
export function isTracePublicId(value: string): boolean {
  return isPublicId(value) && value.toUpperCase().startsWith('TRC-');
}

/** Throws when the value is not a trace public id. */
export function assertTracePublicId(id: string): void {
  if (!isTracePublicId(id)) {
    throw new Error(`Invalid trace public id: ${id}`);
  }
}

