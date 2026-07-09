export type OrgStatus = 
  | "active"
  | "trialing"
  | "suspended"
  | "locked"
  | "archived"
  | "delinquent";

export class OrganizationError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode = 400) {
    super(message);
    this.code = code;
    this.name = "OrganizationError";
    this.statusCode = statusCode;
  }
}

export class ConflictError extends OrganizationError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
  }
}

export class NotFoundError extends OrganizationError {
  constructor(resource: string) {
    super(`${resource} not found`, "NOT_FOUND", 404);
  }
}

export class ForbiddenError extends OrganizationError {
  constructor(message = "Access denied") {
    super(message, "FORBIDDEN", 403);
  }
}

export class ValidationError extends OrganizationError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", 422);
  }
}

export class OrgStatusError extends OrganizationError {
  constructor(status: OrgStatus) {
    super(
      `Organization is ${status}. This action is not permitted.`,
      "ORG_STATUS_INVALID",
      403,
    );
  }
}
