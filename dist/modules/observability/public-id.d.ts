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
export declare function isRequestPublicId(value: string): boolean;
/** Throws when the value is not a request public id. */
export declare function assertRequestPublicId(id: string): void;
/** Narrow check: the value must be a canonical error public id (ERR-...). */
export declare function isErrorPublicId(value: string): boolean;
/** Throws when the value is not an error public id. */
export declare function assertErrorPublicId(id: string): void;
/** Narrow check: the value must be a canonical error group public id (ISS-...). */
export declare function isErrorGroupPublicId(value: string): boolean;
/** Throws when the value is not an error group public id. */
export declare function assertErrorGroupPublicId(id: string): void;
/** Narrow check: the value must be a canonical trace public id (TRC-...). */
export declare function isTracePublicId(value: string): boolean;
/** Throws when the value is not a trace public id. */
export declare function assertTracePublicId(id: string): void;
//# sourceMappingURL=public-id.d.ts.map