/**
 * Project utility functions.
 *
 * Flow:
 * - Domain errors and handler helpers standardize project API failures.
 * - Role helpers keep organization authorization comparisons consistent.
 * - Slug/API-key helpers generate stable public identifiers while storing only
 *   hashed secrets.
 * - Constant-time comparison protects API-key verification from timing leaks.
 */
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { ZodError } from "zod";
const ROLE_HIERARCHY = {
    owner: 5,
    admin: 4,
    billing: 3,
    member: 2,
    viewer: 1,
};
export class ProjectError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode = 400) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.name = "ProjectError";
    }
}
export function handleProjectError(error, reply) {
    // The routes call this from a shared wrapper so every project endpoint returns
    // the same error envelope for domain, validation, and unexpected failures.
    if (error instanceof ProjectError) {
        return reply.code(error.statusCode).send({
            success: false,
            error: {
                code: error.code,
                message: error.message,
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
    // Slugs are restricted to URL-safe lowercase tokens and receive a random
    // fallback if the project name contains no usable characters.
    const slug = name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 48);
    return slug || `project-${randomBytes(3).toString("hex")}`;
}
export function buildApiPrefixes(slug) {
    const suffix = slug.replace(/[^a-z0-9]/g, "").slice(0, 8) ||
        randomBytes(4).toString("hex");
    return {
        productionApiPrefix: `pk_live_`,
        developmentApiPrefix: `pk_dev_`,
    };
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
export function createApiKey(environment) {
    // The full key is returned once. The prefix is public metadata for candidate
    // lookup and the hash is the only value persisted for verification.
    const prefix = environment === "production" ? "pk_live_" : "pk_dev_";
    const rawKey = `${prefix}${randomBytes(20).toString("hex")}`;
    return {
        fullKey: rawKey,
        keyPrefix: rawKey.slice(0, 16),
        keyHash: hashApiKey(rawKey),
    };
}
export function extractApiKeyPrefix(rawKey) {
    const value = rawKey.trim();
    if (!value.startsWith("pk_live_") && !value.startsWith("pk_dev_")) {
        return null;
    }
    return value.length >= 16 ? value.slice(0, 16) : null;
}
export function constantTimeEqualHex(left, right) {
    // Length mismatch is rejected before timingSafeEqual because the Node API
    // requires buffers of equal length.
    const leftBuffer = Buffer.from(left, "hex");
    const rightBuffer = Buffer.from(right, "hex");
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }
    return timingSafeEqual(leftBuffer, rightBuffer);
}
//# sourceMappingURL=utils.js.map