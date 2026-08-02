export type OrgStatus = "active" | "trialing" | "suspended" | "locked" | "archived" | "delinquent";
export declare class OrganizationError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare class ConflictError extends OrganizationError {
    constructor(message: string);
}
export declare class NotFoundError extends OrganizationError {
    constructor(resource: string);
}
export declare class ForbiddenError extends OrganizationError {
    constructor(message?: string);
}
export declare class ValidationError extends OrganizationError {
    constructor(message: string);
}
export declare class OrgStatusError extends OrganizationError {
    constructor(status: OrgStatus);
}
//# sourceMappingURL=errors.d.ts.map