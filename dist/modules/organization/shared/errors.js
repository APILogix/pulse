export class OrganizationError extends Error {
    code;
    statusCode;
    constructor(message, code, statusCode = 400) {
        super(message);
        this.code = code;
        this.name = "OrganizationError";
        this.statusCode = statusCode;
    }
}
export class ConflictError extends OrganizationError {
    constructor(message) {
        super(message, "CONFLICT", 409);
    }
}
export class NotFoundError extends OrganizationError {
    constructor(resource) {
        super(`${resource} not found`, "NOT_FOUND", 404);
    }
}
export class ForbiddenError extends OrganizationError {
    constructor(message = "Access denied") {
        super(message, "FORBIDDEN", 403);
    }
}
export class ValidationError extends OrganizationError {
    constructor(message) {
        super(message, "VALIDATION_ERROR", 422);
    }
}
export class OrgStatusError extends OrganizationError {
    constructor(status) {
        super(`Organization is ${status}. This action is not permitted.`, "ORG_STATUS_INVALID", 403);
    }
}
//# sourceMappingURL=errors.js.map