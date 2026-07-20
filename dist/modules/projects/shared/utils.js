/**
 * Project utility functions.
 *
 * Flow:
 * - ProjectError + handleProjectError standardize every project/API-key
 *   failure envelope.
 * - Role helpers keep organization authorization comparisons consistent.
 * - Slug/prefix/API-key helpers generate stable public identifiers while only
 *   ever persisting the SHA-256 hash of a key.
 * - constantTimeEqualHex protects verification from timing leaks.
 *
 * Security: the raw API key exists only in the create/rotate response cycle.
 * We persist secret_hash (sha256 hex) for verification and public_key for
 * candidate narrowing. Keys carry >= 20 bytes (40 hex chars) of entropy.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ZodError } from "zod";
const ROLE_HIERARCHY = {
    owner: 100,
    admin: 80,
    developer: 60,
    security: 50,
    billing: 50,
    member: 40,
    viewer: 20,
};
// Status codes for every domain error the module raises. Centralized so routes
// and tests share one source of truth.
export const ProjectErrorCodes = {
    PROJECT_NOT_FOUND: 404,
    PROJECT_SLUG_EXISTS: 409,
    PROJECT_INVALID_TRANSITION: 400,
    PROJECT_LIMIT_EXCEEDED: 400,
    PROJECT_ARCHIVED: 409,
    INSUFFICIENT_PERMISSIONS: 403,
    ENVIRONMENT_NOT_FOUND: 404,
    ENVIRONMENT_EXISTS: 409,
    API_KEY_NOT_FOUND: 404,
    API_KEY_LIMIT_EXCEEDED: 400,
    API_KEY_REVOKED: 400,
    API_KEY_EXPIRED: 400,
    API_KEY_CONFLICT: 409,
    API_KEY_INVALID_STATE: 400,
    VALIDATION_ERROR: 422,
    INTERNAL_ERROR: 500,
};
export class ProjectError extends Error {
    code;
    statusCode;
    details;
    constructor(code, message, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = "ProjectError";
    }
}
function isHttpDomainError(error) {
    return error instanceof Error
        && typeof error.code === "string"
        && typeof error.statusCode === "number";
}
export function handleProjectError(error, reply) {
    if (error instanceof ProjectError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            },
        });
    }
    if (isHttpDomainError(error)) {
        return reply.code(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
                ...(error.details ? { details: error.details } : {}),
            },
        });
    }
    if (error instanceof ZodError) {
        return reply.code(422).send({
            success: false,
            error: {
                code: "VALIDATION_ERROR",
                message: "Validation failed",
                details: error.flatten(),
            },
        });
    }
    return reply.code(500).send({
        success: false,
        error: {
            code: "INTERNAL_ERROR",
            message: "Unexpected project module error",
        },
    });
}
export function hasRequiredRole(role, requiredRole) {
    return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[requiredRole];
}
export function slugifyProjectName(name) {
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
    return slug || `project-${randomBytes(3).toString("hex")}`;
}
/** Public prefix for keys minted in a given environment slug. */
export function environmentKeyPrefix(environment) {
    const slug = environment
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20);
    return `pk_${slug}_`;
}
export function buildApiPrefixes() {
    throw new Error("buildApiPrefixes is obsolete; project rows no longer store API prefixes");
}
export function validateStatusTransition(current, next) {
    const validTransitions = {
        active: ["paused", "archived"],
        paused: ["active", "archived"],
        archived: ["active"],
    };
    return validTransitions[current].includes(next);
}
export function hashApiKey(rawKey) {
    return createHash("sha256").update(rawKey).digest("hex");
}
/**
 * Mint a new API key.
 *
 * Format: `pk_{env_slug}_{8 hex}.{32 hex}` (>= 20 bytes of entropy). The
 * segment before the dot is the public identifier; the full string is hashed
 * for persistence.
 */
export function createApiKey(environment) {
    const envSlug = environment
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 20);
    const publicKey = `pk_${envSlug}_${randomBytes(4).toString("hex")}`;
    const secretSuffix = randomBytes(16).toString("hex");
    const fullKey = `${publicKey}.${secretSuffix}`;
    return {
        fullKey,
        publicKey,
        secretHash: hashApiKey(fullKey),
    };
}
export function extractApiKeyPrefix(rawKey) {
    const value = rawKey.trim();
    const dotIndex = value.indexOf(".");
    const prefix = dotIndex >= 0 ? value.slice(0, dotIndex) : value;
    if (!prefix.startsWith("pk_")) {
        return null;
    }
    return prefix.length >= 12 ? prefix : null;
}
export function constantTimeEqualHex(left, right) {
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}
/** Default permission set for a freshly minted key of a given type. */
export function defaultPermissionsForType(keyType) {
    switch (keyType) {
        case "read_only":
            return ["ingest:read", "events:read", "metrics:read"];
        case "write_only":
            return ["ingest:write"];
        case "temporary":
            return ["ingest:write", "ingest:read"];
        case "read_write":
        default:
            return ["ingest:write", "ingest:read", "events:read", "metrics:read", "config:read"];
    }
}
/**
 * Reserved project slugs that are blocked at the application layer to prevent
 * URL collisions, social-engineering subdomains, and confusion with platform
 * routes. The database partial index enforces uniqueness; this set adds the
 * reserved-name guard.
 */
const RESERVED_PROJECT_SLUGS = new Set([
    "admin", "administrator", "api", "apis", "app", "apps", "application", "dashboard",
    "login", "logout", "signin", "signout", "signup", "register", "auth", "authenticate",
    "settings", "config", "configuration", "preferences", "profile", "account",
    "projects", "project", "organizations", "organization", "org", "orgs", "billing",
    "usage", "support", "help", "docs", "documentation", "status", "health", "ping",
    "public", "static", "assets", "cdn", "webhook", "webhooks", "hook", "hooks",
    "console", "portal", "home", "index", "main", "root", "service", "services",
    "user", "users", "team", "teams", "invite", "invitation", "member", "members",
    "role", "roles", "permission", "permissions", "policy", "policies",
    "audit", "logs", "log", "analytics", "metrics", "events", "traces", "spans",
    "alerts", "alert", "connector", "connectors", "integration", "integrations",
    "sdk", "sdks", "release", "releases", "deployment", "deployments", "deploy",
    "environment", "environments", "env", "envs", "api-key", "api-keys", "apikey",
    "key", "keys", "secret", "secrets", "token", "tokens", "credential", "credentials",
    "internal", "localhost", "test", "testing", "staging", "stage", "production",
    "prod", "dev", "development", "demo", "sandbox", "beta", "alpha", "v1", "v2", "v3",
    "www", "mail", "email", "ftp", "sftp", "ssh", "smtp", "imap", "pop", "ns1", "ns2",
]);
export function isReservedProjectSlug(slug) {
    return RESERVED_PROJECT_SLUGS.has(slug.toLowerCase().trim());
}
//# sourceMappingURL=utils.js.map